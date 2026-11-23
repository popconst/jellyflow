// Watching: what's open in the player (a film or an episode) and from where,
// the audio and subtitle languages chosen last (for the next one), and what
// this browser plays, for Jellyfin to send it untouched wherever it can.

import type { Item } from '../core/jellyfin.ts'
import type { Caps, Preference } from '../core/playback.ts'
import { player } from './player.svelte.ts'
import { store, stored } from './state.svelte.ts'

const PREFERENCE = 'jellyflow.watch'
/** The picture quality chosen last, on this browser (a phone on a slow link keeps its own): bits per second, none for the file's own */
const QUALITY = 'jellyflow.quality'

/** What the player plays: a film, or an episode of a series */
export interface Showing {
  /** The film's or the episode's id */
  id: string
  /** The film's title, or the series' */
  title: string
  /** Under it: the year and rating, or "S1:E3 · The Wager" */
  sub: string
  /** For the lock screen: the film's or the episode's own title, and what it's from */
  name: string
  from: string
  seconds: number
  /** The film's or the series' poster: the seek bar's colours, the lock screen's picture */
  poster: { id: string; tag: string | undefined }
  /** With its streams (audio, subtitles) */
  item: Item
  /** The second to start at */
  start: number
  /** The episode after this one, if there is one */
  next?: (() => Promise<Showing | undefined>) | undefined
  /** Watching it ended: Jellyfin now has where it stopped */
  stopped?: (() => void) | undefined
}

/** Safari (macOS, iOS) plays HLS itself, and better than a script can there: lock screen, AirPlay, Dolby */
export function nativeHls(): boolean {
  return navigator.vendor.startsWith('Apple') && document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== ''
}

/**
 * What this browser plays, by Jellyfin's codec names. Asked of Media Source
 * Extensions where hls.js will play the stream, of the <video> where Safari
 * plays it itself: the two can differ.
 */
export function browserCaps(): Caps {
  const video = document.createElement('video')
  const native = nativeHls()
  const Source = (globalThis as { ManagedMediaSource?: typeof MediaSource }).ManagedMediaSource ?? globalThis.MediaSource
  const plays = (type: string) => (native ? video.canPlayType(type) !== '' : (Source?.isTypeSupported(type) ?? false))
  const check = (codecs: Record<string, string>) => Object.keys(codecs).filter((c) => plays(codecs[c] ?? ''))
  return {
    video: check({
      h264: 'video/mp4; codecs="avc1.640028"',
      // Main 10: what films come in
      hevc: 'video/mp4; codecs="hvc1.2.4.L153.B0"',
      av1: 'video/mp4; codecs="av01.0.08M.10"',
      vp9: 'video/mp4; codecs="vp09.02.10.10"',
    }),
    audio: check({
      aac: 'audio/mp4; codecs="mp4a.40.2"',
      mp3: 'audio/mp4; codecs="mp4a.6B"',
      opus: 'audio/mp4; codecs="opus"',
      flac: 'audio/mp4; codecs="flac"',
      alac: 'audio/mp4; codecs="alac"',
      ac3: 'audio/mp4; codecs="ac-3"',
      eac3: 'audio/mp4; codecs="ec-3"',
    }),
  }
}

class Watch {
  /** What's playing, full window: while it is, the keys and the media keys are the player's */
  showing = $state.raw<Showing | undefined>()
  preference = $state<Preference>(stored<Preference>(PREFERENCE) ?? {})
  quality = $state<number | undefined>(stored<number>(QUALITY))

  /** Plays it; the music stops for it (from one episode to the next, it stays stopped) */
  open(showing: Showing): void {
    if (!this.showing) player.pause()
    this.showing = showing
  }

  /** Back to the app: the media keys and the tab's title are the music's again */
  close(): void {
    this.showing = undefined
    player.claimMediaKeys()
  }

  /** Remembers a choice for the next film */
  prefer(choice: Preference): void {
    this.preference = { ...this.preference, ...choice }
    store(PREFERENCE, this.preference)
  }

  /** … and the picture quality, by its bitrate (undefined: the file as it is) */
  preferQuality(bitrate: number | undefined): void {
    this.quality = bitrate
    store(QUALITY, bitrate)
  }
}

export const watch = new Watch()
