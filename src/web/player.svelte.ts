// Playing: a queue of tracks through one <audio>, with the OS's media keys
// and now-playing panel (Media Session). Each track is asked of Jellyfin
// with what this browser plays: files it plays come as they are, any other
// (ALAC outside Safari) converted on the fly to FLAC, losing nothing. The
// queue, the track and where in it are remembered: after a reload it's all
// back at the same second, and if it was playing it plays on: at once where
// the browser allows it (Brave: allow autoplay for the site), else from the
// first key press or click.
// From the first play on, the sound goes through a Web Audio graph (straight
// to the speakers, nothing changed) that the visualiser can listen to.

import { streamed } from '../core/details.ts'
import type { Jellyfin } from '../core/jellyfin.ts'
import type { Track } from '../core/library.ts'
import { musicProfile } from '../core/playback.ts'
import { browserCaps } from './caps.ts'
import { app, store, stored } from './state.svelte.ts'
import { Stream } from './stream.svelte.ts'

const SAVED = 'jellyflow.player'
/** While playing, where it's at is saved this often (ms) */
const SAVE_EVERY = 2000

interface Saved {
  queue: Track[]
  index: number
  time: number
  /** Whether it was playing: then it plays on after the reload */
  playing?: boolean
}

class Player {
  queue = $state.raw<Track[]>([])
  index = $state(-1)
  /** Not playing, nor about to as soon as the track's in */
  paused = $state(true)
  time = $state(0)
  duration = $state(0)
  current = $derived<Track | undefined>(this.queue[this.index])
  /** The sound as a Web Audio node, for the visualiser to tap; there once something's played */
  source = $state.raw<AudioNode | undefined>()
  /** After a reload: it was playing, and plays on at the first key press or click (the browser wouldn't start it) */
  waiting = $state(false)
  /** The track in the <audio>, as Jellyfin sends it */
  private stream = $state.raw<Stream | undefined>()
  /**
   * The track's format as it comes: "FLAC · 16-bit / 44.1 kHz · stereo", or
   * converted by Jellyfin because this browser doesn't play its file, "ALAC
   * → FLAC · …"; and a word on that (once Jellyfin has said how it sends it)
   */
  quality = $derived.by((): { text: string; hiRes: boolean; note?: string } | undefined => {
    const source = this.stream?.source
    if (source) return streamed(source)
    const t = this.current
    return t?.quality ? { text: t.quality, hiRes: t.hiRes } : undefined
  })

  private audio = new Audio()
  /** What Jellyfin is told this browser plays */
  private readonly profile = musicProfile(browserCaps())
  /** Settles once the track's in the <audio>: true if it can play */
  private ready = Promise.resolve(false)
  /** The second to start the track at, until it's loaded: where it was before a reload */
  private resumeAt = 0
  private savedAt = 0
  /** Playing on after a reload, held back until the first key press or click */
  private held: (() => void) | undefined

  constructor() {
    // Jellyfin allows it (CORS), and without it Web Audio would only hear silence
    this.audio.crossOrigin = 'anonymous'
    this.audio.addEventListener('timeupdate', () => {
      this.time = this.audio.currentTime
      if (Date.now() - this.savedAt > SAVE_EVERY) this.save()
    })
    this.audio.addEventListener('loadedmetadata', () => (this.resumeAt = 0))
    this.audio.addEventListener('durationchange', () => (this.duration = this.audio.duration || 0))
    this.audio.addEventListener('play', () => (this.paused = false))
    this.audio.addEventListener('pause', () => {
      this.paused = true
      this.save()
    })
    addEventListener('pagehide', () => this.save())
    this.audio.addEventListener('ended', () => this.next())
    this.claimMediaKeys()
    this.restore()
  }

  /** The OS's media keys and now-playing panel are the music's (again, after a film) */
  claimMediaKeys(): void {
    if (!('mediaSession' in navigator)) return
    const session = navigator.mediaSession
    session.setActionHandler('play', () => this.toggle())
    session.setActionHandler('pause', () => this.toggle())
    session.setActionHandler('nexttrack', () => this.next())
    session.setActionHandler('previoustrack', () => this.prev())
    session.setActionHandler('seekto', (d) => d.seekTime !== undefined && this.seek(d.seekTime))
    for (const action of ['seekbackward', 'seekforward'] as const) session.setActionHandler(action, null)
    const track = this.current
    const client = app.client
    if (track && client) this.nowPlaying(track, client)
    else {
      session.metadata = null
      document.title = 'jellyflow'
    }
  }

  /** Stops the music where it is (a film is starting): it doesn't play on by itself either */
  pause(): void {
    this.release()
    this.halt()
  }

  /** What was playing before the reload, paused where it was */
  private restore(): void {
    const saved = stored<Saved>(SAVED)
    const track = saved?.queue[saved.index]
    if (!saved || !track) return
    this.queue = saved.queue
    this.index = saved.index
    this.time = this.resumeAt = saved.time
    this.load(track, false)
    if (saved.playing) void this.playOn()
  }

  /**
   * After a reload: plays on if the browser lets it start sound by itself.
   * The sound goes through Web Audio, so that has to be running too, or the
   * track would run on in silence. Browsers only allow it where the site may
   * autoplay (Brave: site settings → Autoplay → Allow); otherwise it waits
   * for the first key press or click. Held from the start, so it's
   * remembered as playing meanwhile (another reload plays on too).
   */
  private async playOn(): Promise<void> {
    this.hold()
    this.wire()
    const context = this.source?.context as AudioContext | undefined
    if (context && context.state !== 'running') {
      // a refused resume() never settles: give it a moment, then look
      await Promise.race([context.resume(), new Promise((r) => setTimeout(r, 300))])
    }
    if (!this.held || (context && context.state !== 'running')) return
    // the track has to be in first
    if (!(await this.ready) || !this.held) return
    try {
      await this.audio.play()
      this.release()
    } catch {
      // still held
    }
  }

  /**
   * Plays on at the first key press or click, once that's done what it does:
   * Space, the play button or Enter on this track play on by themselves (and
   * would pause it again or start it over if this went first)
   */
  private hold(): void {
    if (this.held) return
    const first = () => {
      setTimeout(() => {
        if (this.held !== first) return
        this.release()
        this.go()
      })
    }
    this.held = first
    this.waiting = true
    addEventListener('keydown', first, true)
    addEventListener('pointerdown', first, true)
  }

  private release(): void {
    if (!this.held) return
    removeEventListener('keydown', this.held, true)
    removeEventListener('pointerdown', this.held, true)
    this.held = undefined
    this.waiting = false
  }

  private save(): void {
    this.savedAt = Date.now()
    const time = this.audio.src ? this.audio.currentTime : this.time
    const playing = !this.paused || this.held !== undefined
    store(SAVED, { queue: this.queue, index: this.index, time: this.resumeAt || time, playing } satisfies Saved)
  }

  /** Replaces the queue and plays from `from`; the track waiting to play on after a reload plays on where it was */
  play(tracks: Track[], from = 0): void {
    const resume = this.held && tracks[from]?.id === this.current?.id
    this.queue = tracks
    if (!resume) return this.start(from)
    this.index = from
    this.toggle()
  }

  /** Adds to the end of the queue; plays nothing new */
  add(tracks: Track[]): void {
    this.queue = [...this.queue, ...tracks]
    this.save()
  }

  toggle(): void {
    this.release()
    const track = this.current
    if (!track) {
      if (this.queue.length) this.start(0)
      return
    }
    // restored before the login was there: load it now
    if (!this.stream) this.load(track, true)
    else if (this.paused) this.go()
    else this.halt()
  }

  /** Plays, through Web Audio: at once, or as soon as the track's in */
  private go(): void {
    this.paused = false
    this.wire()
    const ready = this.ready
    void ready.then((ok) => {
      if (ok && ready === this.ready && !this.paused) void this.audio.play().catch(() => (this.paused = this.audio.paused))
    })
  }

  private halt(): void {
    this.paused = true
    this.audio.pause()
  }

  /**
   * The Web Audio graph: the <audio> straight to the speakers, at the
   * device's rate as before. Made on the first play, which is a key press or
   * a click: browsers only let sound start from one.
   */
  private wire(): void {
    if (this.source) {
      void (this.source.context as AudioContext).resume()
      return
    }
    try {
      const context = new AudioContext({ latencyHint: 'playback' })
      const source = context.createMediaElementSource(this.audio)
      source.connect(context.destination)
      this.source = source
    } catch {
      // no Web Audio: it plays as it is, without a visualiser
    }
  }

  next(): void {
    if (this.index + 1 < this.queue.length) this.start(this.index + 1)
    else {
      this.halt()
      this.index = -1
      document.title = 'jellyflow'
      this.save()
    }
  }

  /** The track before; or this one from the start, if it's been playing a while */
  prev(): void {
    if (this.audio.currentTime > 3 || this.index <= 0) this.seek(0)
    else this.start(this.index - 1)
  }

  seek(time: number): void {
    this.audio.currentTime = time
  }

  private start(index: number): void {
    const track = this.queue[index]
    if (!track) return
    this.release()
    this.index = index
    this.time = this.resumeAt = 0
    this.load(track, true)
    this.save()
  }

  /** Puts `track` in the player, as Jellyfin sends it to this browser, playing or not; shows it as now playing */
  private load(track: Track, play: boolean): void {
    const client = app.client
    if (!client) return
    this.stream?.stop(this.audio)
    const stream = new Stream(client, track.id, { failed: () => this.failed(stream) })
    this.stream = stream
    this.audio.preload = play ? 'auto' : 'metadata'
    this.ready = stream.open(this.audio, this.resumeAt, { profile: this.profile })
    if (play) this.go()
    this.nowPlaying(track, client)
  }

  /** The track playing (`stream`) can't be played: said so, and on to the next */
  private failed(stream: Stream): void {
    if (stream !== this.stream || !this.current) return
    app.say(`Couldn't play ${this.current.title}`)
    this.next()
  }

  /** The tab's title and the OS's now-playing panel */
  private nowPlaying(track: Track, client: Jellyfin): void {
    document.title = `${track.title} · ${track.artist}`
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.imageTag
        ? [{ src: client.imageUrl(track.albumId, track.imageTag, 512), sizes: '512x512', type: 'image/jpeg' }]
        : [],
    })
  }
}

export const player = new Player()
