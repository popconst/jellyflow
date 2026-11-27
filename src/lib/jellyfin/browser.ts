// What this browser plays, by Jellyfin's codec names, for Jellyfin to send
// it untouched wherever it can: music files as they are, films (and music
// it has to convert) as HLS with fragmented MP4. The browser's half of the
// lib (it asks the DOM): imported from here, never from index.ts, which
// Node uses too.

import type { Caps } from './profiles.ts'

/** Safari (macOS, iOS) plays HLS itself, and better than a script can there: lock screen, AirPlay, Dolby */
export function nativeHls(): boolean {
  return navigator.vendor.startsWith('Apple') && document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== ''
}

/** Music files' codecs, each with the type to ask the <audio> about */
const MUSIC_FILES: Record<string, string> = {
  flac: 'audio/flac',
  mp3: 'audio/mpeg',
  aac: 'audio/mp4; codecs="mp4a.40.2"',
  alac: 'audio/mp4; codecs="alac"',
  opus: 'audio/ogg; codecs="opus"',
  vorbis: 'audio/ogg; codecs="vorbis"',
}

/**
 * What this browser plays. A stream's codecs are asked of Media Source
 * Extensions where hls.js will play it, of the <video> where Safari plays
 * it itself: the two can differ. Music files' are asked of an <audio>.
 */
export function browserCaps(): Caps {
  const video = document.createElement('video')
  const audio = document.createElement('audio')
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
    files: Object.keys(MUSIC_FILES).filter((codec) => audio.canPlayType(MUSIC_FILES[codec] ?? '') !== ''),
  }
}
