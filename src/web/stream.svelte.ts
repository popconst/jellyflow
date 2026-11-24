// A film's, an episode's or a track's stream from Jellyfin, into a <video>
// or an <audio>. It's asked for with this browser's profile (and, for a
// film, the audio and burned-in subtitles chosen); Jellyfin says whether
// the file comes as it is or converted, as HLS, which hls.js plays where the
// browser doesn't itself (everywhere but Safari). Its owner plays it once
// it's in. A film's play session goes back to Jellyfin as it plays, so any
// of its apps resumes where it was stopped.

import type Hls from 'hls.js'
import { ticks, type DeviceProfile, type Jellyfin, type MediaSource, type Playing } from '../core/jellyfin.ts'
import { playMethod } from '../core/playback.ts'
import { nativeHls } from './caps.ts'

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

export interface Options {
  /** Which of the file's versions, if it has several (a film's) */
  mediaSourceId?: string | undefined
  /** Where playing is: given (a film's), Jellyfin is told as it goes; else nothing is reported */
  where?: (() => Position) | undefined
  /** It can't be played after all: Jellyfin said no, or what it sent breaks */
  failed?: ((why: string) => void) | undefined
}

export class Stream {
  /** How Jellyfin sends it, once asked */
  source = $state.raw<MediaSource | undefined>()
  /** Why it can't play, if it can't */
  error = $state<string | undefined>()

  private readonly client: Jellyfin
  private readonly itemId: string
  private readonly options: Options
  private hls: Hls | undefined
  /** Ends what the last attach left listening on the element */
  private attached: AbortController | undefined
  /** Jellyfin's id for this play session; and whether it's begun (shown its first picture), ended */
  private session: string | undefined
  private begun = false
  private ended = false
  private reportedAt = 0

  constructor(client: Jellyfin, itemId: string, options: Options = {}) {
    this.client = client
    this.itemId = itemId
    this.options = options
  }

  /**
   * Asks Jellyfin for it with `choice` and puts it in `media`, to play from
   * `at`; the stream it replaces ends. False if it can't be played, or it
   * was stopped meanwhile
   */
  async open(media: HTMLMediaElement, at: number, choice: Choice): Promise<boolean> {
    this.error = undefined
    const before = this.transcoding()
    let source: MediaSource
    try {
      const info = await this.client.playbackInfo(this.itemId, choice.profile, {
        mediaSourceId: this.options.mediaSourceId,
        audio: choice.audio,
        subtitles: choice.burnIn,
      })
      const first = info.MediaSources[0]
      if (info.ErrorCode || !first) {
        throw new Error(info.ErrorCode === 'NotAllowed' ? 'Jellyfin doesn’t allow this user to play it' : `Jellyfin can’t stream it here (${info.ErrorCode ?? 'no stream'})`)
      }
      source = first
      this.source = source
      this.session = info.PlaySessionId
    } catch (e) {
      this.fail(e instanceof Error ? e.message : String(e))
      return false
    }
    if (before) this.endStream(before)
    if (this.ended) {
      // stopped while Jellyfin was asked: what it began for this isn't wanted
      const now = this.transcoding()
      if (now) this.endStream(now)
      return false
    }
    this.begun = false
    return this.attach(media, source, at)
  }

  /** Puts what Jellyfin sends in `media`: the file as it is (a film's into a <video>, a track's into an <audio>), or HLS */
  private async attach(media: HTMLMediaElement, source: MediaSource, at: number): Promise<boolean> {
    this.attached?.abort()
    this.hls?.destroy()
    this.hls = undefined
    const { signal } = (this.attached = new AbortController())
    media.addEventListener('error', () => media.error && this.fail(`Couldn’t play it (${media.error.message || `error ${media.error.code}`})`), { signal })
    if (!source.TranscodingUrl || nativeHls()) {
      media.src = source.TranscodingUrl
        ? this.client.resolve(source.TranscodingUrl)
        : this.client.fileUrl(media instanceof HTMLVideoElement ? 'Videos' : 'Audio', this.itemId, source.Id)
      if (at > 0) media.addEventListener('loadedmetadata', () => (media.currentTime = at), { once: true, signal })
      return true
    }
    // the full build: the light one fails on Dolby Vision streams' SUPPLEMENTAL-CODECS
    const { default: HlsJs } = await import('hls.js')
    if (this.ended || signal.aborted) return false
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
      this.fail(`Couldn’t play it: ${data.details}`)
    })
    hls.loadSource(this.client.resolve(source.TranscodingUrl))
    hls.attachMedia(media)
    this.hls = hls
    return true
  }

  /** The picture has started: Jellyfin is told it's begun (once a stream), if it's to be told */
  started(): void {
    if (this.begun || !this.options.where) return
    this.begun = true
    this.report('start')
  }

  /** A pause or a play on; or time going by, told every so often */
  progress(event: 'pause' | 'unpause' | 'timeupdate'): void {
    if (!this.begun || (event === 'timeupdate' && Date.now() - this.reportedAt < REPORT_EVERY)) return
    this.report('progress', event)
  }

  /** Playing ends: Jellyfin keeps where it was (if it was told it began) and ends its stream; `then`, once it has */
  stop(media: HTMLMediaElement | undefined, then?: () => void, keepalive = false): void {
    if (this.ended) return
    this.ended = true
    const playing = this.begun ? this.snapshot() : undefined
    if (playing) {
      void this.client
        .report('stopped', playing, keepalive)
        .catch(() => undefined)
        .then(() => then?.())
    } else {
      const session = this.transcoding()
      if (session) this.endStream(session)
    }
    this.attached?.abort()
    this.hls?.destroy()
    this.hls = undefined
    if (media) {
      media.removeAttribute('src')
      media.load()
    }
  }

  /** It can't play: why, for its owner to say (the first reason, while it's wanted) */
  private fail(why: string): void {
    if (this.error || this.ended) return
    this.error = why
    this.options.failed?.(why)
  }

  private report(event: 'start' | 'progress', name?: string): void {
    const playing = this.snapshot(name)
    if (!playing) return
    this.reportedAt = Date.now()
    void this.client.report(event, playing).catch(() => undefined)
  }

  /** What's playing, for a report; nothing if it isn't reported */
  private snapshot(event?: string): Playing | undefined {
    const now = this.options.where?.()
    if (!now) return undefined
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

  /** The play session, if Jellyfin is converting or repackaging the file for it: a stream to end once it isn't wanted */
  private transcoding(): string | undefined {
    return this.source?.TranscodingUrl ? this.session : undefined
  }

  /** Ends a stream Jellyfin is packaging */
  private endStream(id: string): void {
    void this.client.endStream(id).catch(() => undefined)
  }
}
