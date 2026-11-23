// A film's or an episode's stream from Jellyfin, into a <video>: asked for
// with this browser's profile and the audio (and burned-in subtitles)
// chosen; played by hls.js, or by the browser itself where it plays HLS
// (Safari) or the file as it is. The play session goes back to Jellyfin as
// it plays, so any of its apps resumes where it was stopped.

import type Hls from 'hls.js'
import { ticks, type DeviceProfile, type Jellyfin, type MediaSource, type Playing } from '../core/jellyfin.ts'
import { playMethod } from '../core/playback.ts'
import { nativeHls } from './watch.svelte.ts'

/** Where it's at goes to Jellyfin this often while it plays (ms) */
const REPORT_EVERY = 10_000

/** What to ask Jellyfin for: this browser's profile (at the quality chosen), the audio track, picture subtitles to burn in */
export interface Choice {
  profile: DeviceProfile
  audio?: number | undefined
  burnIn?: number | undefined
}

/** Where watching is, for Jellyfin's reports */
export interface Position {
  seconds: number
  paused: boolean
  audio?: number | undefined
  subtitles?: number | undefined
}

export class Stream {
  /** How Jellyfin sends it, once asked */
  source = $state.raw<MediaSource | undefined>()
  /** Why it can't play, if it can't */
  error = $state<string | undefined>()

  private readonly client: Jellyfin
  private readonly itemId: string
  private readonly mediaSourceId: string | undefined
  private readonly where: () => Position
  /** hls.js (the full build: the light one fails on Dolby Vision streams' SUPPLEMENTAL-CODECS), fetched while Jellyfin prepares the stream */
  private readonly hlsJs = nativeHls() ? undefined : import('hls.js')
  private hls: Hls | undefined
  /** Jellyfin's id for this play session; and whether it's begun (shown its first picture), ended */
  private session: string | undefined
  private begun = false
  private ended = false
  private reportedAt = 0

  constructor(client: Jellyfin, itemId: string, mediaSourceId: string | undefined, where: () => Position) {
    this.client = client
    this.itemId = itemId
    this.mediaSourceId = mediaSourceId
    this.where = where
  }

  /** Asks Jellyfin for it with `choice` and plays it in `video` from `at`; the stream it replaces ends. False if it can't */
  async open(video: HTMLVideoElement, at: number, choice: Choice): Promise<boolean> {
    this.error = undefined
    const before = this.session
    try {
      const info = await this.client.playbackInfo(this.itemId, choice.profile, {
        mediaSourceId: this.mediaSourceId,
        audio: choice.audio,
        subtitles: choice.burnIn,
      })
      const source = info.MediaSources[0]
      if (info.ErrorCode || !source) {
        throw new Error(info.ErrorCode === 'NotAllowed' ? 'Jellyfin doesn’t allow this user to play it' : `Jellyfin can’t stream it here (${info.ErrorCode ?? 'no stream'})`)
      }
      this.source = source
      this.session = info.PlaySessionId
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e)
      return false
    }
    if (before) this.endStream(before)
    this.begun = false
    const url = this.source.TranscodingUrl ? this.client.resolve(this.source.TranscodingUrl) : this.client.videoUrl(this.itemId, this.source.Id)
    await this.attach(video, url, at, Boolean(this.source.TranscodingUrl))
    return true
  }

  private async attach(video: HTMLVideoElement, url: string, at: number, isHls: boolean): Promise<void> {
    this.hls?.destroy()
    this.hls = undefined
    if (!isHls || nativeHls()) {
      video.src = url
      if (at > 0) video.addEventListener('loadedmetadata', () => (video.currentTime = at), { once: true })
    } else {
      const { default: HlsJs } = await (this.hlsJs ?? import('hls.js'))
      const hls = new HlsJs({
        startPosition: at,
        // Jellyfin starts its packager on a seek: the first piece can take a while
        fragLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 30_000,
            maxLoadTimeMs: 120_000,
            timeoutRetry: { maxNumRetry: 4, retryDelayMs: 500, maxRetryDelayMs: 4000 },
            errorRetry: { maxNumRetry: 6, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
          },
        },
        maxBufferLength: 60,
        backBufferLength: 90,
        debug: import.meta.env.DEV && localStorage.getItem('jellyflow.debug') === 'hls',
      })
      let recovered = false
      hls.on(HlsJs.Events.ERROR, (_event, data) => {
        if (!data.fatal) return
        if (data.type === HlsJs.ErrorTypes.MEDIA_ERROR && !recovered) {
          recovered = true
          hls.recoverMediaError()
          return
        }
        this.error = `Couldn’t play it: ${data.details}`
      })
      hls.loadSource(url)
      hls.attachMedia(video)
      this.hls = hls
    }
    void video.play().catch(() => undefined)
  }

  /** The picture has started: Jellyfin is told it's begun (once a stream) */
  started(): void {
    if (this.begun) return
    this.begun = true
    this.report('start')
  }

  /** A pause or a play on; or time going by, told every so often */
  progress(event: 'pause' | 'unpause' | 'timeupdate'): void {
    if (!this.begun || (event === 'timeupdate' && Date.now() - this.reportedAt < REPORT_EVERY)) return
    this.report('progress', event)
  }

  /** Watching ends: Jellyfin keeps where it was and ends its stream; `then`, once it has */
  stop(video: HTMLVideoElement | undefined, then?: () => void, keepalive = false): void {
    if (this.ended) return
    this.ended = true
    if (this.begun) {
      void this.client
        .report('stopped', this.snapshot(), keepalive)
        .catch(() => undefined)
        .then(() => then?.())
    } else if (this.session) this.endStream(this.session)
    this.hls?.destroy()
    this.hls = undefined
    if (video) {
      video.removeAttribute('src')
      video.load()
    }
  }

  private report(event: 'start' | 'progress', name?: string): void {
    this.reportedAt = Date.now()
    void this.client.report(event, this.snapshot(name)).catch(() => undefined)
  }

  /** What's playing, for a report */
  private snapshot(event?: string): Playing {
    const now = this.where()
    return {
      ItemId: this.itemId,
      MediaSourceId: this.source?.Id,
      PlaySessionId: this.session,
      PositionTicks: ticks(now.seconds),
      IsPaused: now.paused,
      CanSeek: true,
      PlayMethod: this.source ? playMethod(this.source) : 'DirectStream',
      AudioStreamIndex: now.audio,
      SubtitleStreamIndex: now.subtitles ?? -1,
      ...(event ? { EventName: event } : {}),
    }
  }

  /** Ends a stream Jellyfin is packaging, once it's no longer wanted */
  private endStream(id: string): void {
    void this.client.endStream(id).catch(() => undefined)
  }
}
