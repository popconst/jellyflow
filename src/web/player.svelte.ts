// Playing: a queue of tracks through one <audio>, with the OS's media keys
// and now-playing panel (Media Session). The queue, the track and where in it
// are remembered: after a reload it's all back at the same second, and if it
// was playing it plays on: at once where the browser allows it (Brave: allow
// autoplay for the site), else from the first key press or click.
// From the first play on, the sound goes through a Web Audio graph (straight
// to the speakers, nothing changed) that the visualiser can listen to.

import type { Track } from '../core/library.ts'
import { app, store, stored } from './state.svelte.ts'

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
  paused = $state(true)
  time = $state(0)
  duration = $state(0)
  current = $derived<Track | undefined>(this.queue[this.index])
  /** The sound as a Web Audio node, for the visualiser to tap; there once something's played */
  source = $state.raw<AudioNode | undefined>()

  private audio = new Audio()
  /** Where to seek to once the track's loaded: the second it was at before a reload */
  private resumeAt = 0
  private savedAt = 0
  /** Playing on after a reload, held back until the first key press or click */
  private held: ((e: Event) => void) | undefined

  constructor() {
    // Jellyfin allows it (CORS), and without it Web Audio would only hear silence
    this.audio.crossOrigin = 'anonymous'
    this.audio.addEventListener('timeupdate', () => {
      this.time = this.audio.currentTime
      if (Date.now() - this.savedAt > SAVE_EVERY) this.save()
    })
    this.audio.addEventListener('loadedmetadata', () => {
      if (this.resumeAt > 0) this.audio.currentTime = this.resumeAt
      this.resumeAt = 0
    })
    this.audio.addEventListener('durationchange', () => (this.duration = this.audio.duration || 0))
    this.audio.addEventListener('play', () => (this.paused = false))
    this.audio.addEventListener('pause', () => {
      this.paused = true
      this.save()
    })
    addEventListener('pagehide', () => this.save())
    this.audio.addEventListener('ended', () => this.next())
    this.audio.addEventListener('error', () => {
      if (!this.current) return
      app.say(`Couldn't play ${this.current.title}`)
      this.next()
    })
    if ('mediaSession' in navigator) {
      const session = navigator.mediaSession
      session.setActionHandler('play', () => this.toggle())
      session.setActionHandler('pause', () => this.toggle())
      session.setActionHandler('nexttrack', () => this.next())
      session.setActionHandler('previoustrack', () => this.prev())
      session.setActionHandler('seekto', (d) => d.seekTime !== undefined && this.seek(d.seekTime))
    }
    this.restore()
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
   * track would run on in silence; if either is refused, it waits for the
   * first key press or click.
   */
  private async playOn(): Promise<void> {
    this.wire()
    const context = this.source?.context as AudioContext | undefined
    if (context && context.state !== 'running') {
      // a refused resume() never settles: give it a moment, then look
      await Promise.race([context.resume(), new Promise((r) => setTimeout(r, 300))])
    }
    if (context && context.state !== 'running') return this.hold()
    try {
      await this.audio.play()
    } catch {
      this.hold()
    }
  }

  /** Plays on at the first key press or click (Space plays by itself: it's play / pause) */
  private hold(): void {
    if (this.held) return
    const go = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key === ' ') return
      this.release()
      this.wire()
      void this.audio.play().catch(() => undefined)
    }
    this.held = go
    addEventListener('keydown', go, true)
    addEventListener('pointerdown', go, true)
  }

  private release(): void {
    if (!this.held) return
    removeEventListener('keydown', this.held, true)
    removeEventListener('pointerdown', this.held, true)
    this.held = undefined
  }

  private save(): void {
    this.savedAt = Date.now()
    const time = this.audio.src ? this.audio.currentTime : this.time
    const playing = !this.audio.paused || this.held !== undefined
    store(SAVED, { queue: this.queue, index: this.index, time: this.resumeAt || time, playing } satisfies Saved)
  }

  /** Replaces the queue and plays from `from` */
  play(tracks: Track[], from = 0): void {
    this.queue = tracks
    this.start(from)
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
    if (!this.audio.src) this.load(track, true)
    else if (this.audio.paused) {
      this.wire()
      void this.audio.play().catch(() => undefined)
    } else this.audio.pause()
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
      this.audio.pause()
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

  /** Puts `track` in the player, playing or not; shows it as now playing */
  private load(track: Track, play: boolean): void {
    const client = app.client
    if (!client) return
    this.audio.preload = play ? 'auto' : 'metadata'
    this.audio.src = client.streamUrl(track.id)
    if (play) {
      this.wire()
      void this.audio.play().catch(() => undefined)
    }
    document.title = `${track.title} · ${track.artist}`
    if ('mediaSession' in navigator) {
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
}

export const player = new Player()
