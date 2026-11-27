// A film's audio and subtitle tracks, to choose from: named plainly
// ("Romanian · Dolby Digital 5.1", "English · SDH"), and the ones to start
// with, in the languages chosen last time.

import type { MediaSource, MediaStream } from './types.ts'

/** An audio or subtitle track of a film's, to choose */
export interface MediaTrack {
  /** The stream's index in the file: what Jellyfin is asked for */
  index: number
  label: string
  language: string | undefined
  /** Subtitles drawn into the picture: choosing them re-encodes the video */
  burnIn: boolean
  isDefault: boolean
  forced: boolean
}

const languages = new Intl.DisplayNames(['en'], { type: 'language' })

/** "eng" → "English"; undefined when there's none to name */
function languageName(code: string | undefined): string | undefined {
  if (!code || code === 'und' || code === 'zxx' || code === 'mis') return undefined
  try {
    const name = languages.of(code)
    return name && name !== code ? name : code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

const CODECS: Record<string, string> = {
  aac: 'AAC',
  ac3: 'Dolby Digital',
  eac3: 'Dolby Digital+',
  truehd: 'Dolby TrueHD',
  dts: 'DTS',
  flac: 'FLAC',
  alac: 'ALAC',
  mp3: 'MP3',
  opus: 'Opus',
  vorbis: 'Vorbis',
  pcm_s16le: 'PCM',
  pcm_s24le: 'PCM',
}

function channels(n: number | undefined): string | undefined {
  if (!n) return undefined
  return n === 1 ? 'mono' : n === 2 ? 'stereo' : `${n - 1}.1`
}

/** The track's own name, if it says more than its language and codec ("Commentary", "SDH") */
function ownTitle(s: MediaStream, language: string | undefined): string | undefined {
  const title = s.Title?.trim()
  if (!title) return undefined
  const plain = title.toLowerCase()
  if (language && plain === language.toLowerCase()) return undefined
  if (/^(stereo|mono|[57]\.1|surround)$/i.test(plain)) return undefined
  // a description of the sound ("DD5.1 @ 384 kbps"): the codec and channels say it already
  if (/\b(dd\+?|ddp|dts|ac-?3|e-?ac-?3|aac|flac|truehd|atmos|kbps|[257]\.[01])\b/i.test(plain)) return undefined
  return title
}

/** "Romanian · Dolby Digital 5.1", "English · Commentary · AAC stereo" */
function audioLabel(s: MediaStream): string {
  const language = languageName(s.Language)
  const codec = s.Codec === 'dts' && s.Profile ? s.Profile : (CODECS[s.Codec ?? ''] ?? s.Codec?.toUpperCase())
  const sound = [codec, channels(s.Channels)].filter(Boolean).join(' ')
  return [language ?? 'Unknown language', ownTitle(s, language), sound].filter(Boolean).join(' · ')
}

/** "English", "English · SDH", "Romanian · Forced" */
function subtitleLabel(s: MediaStream): string {
  const language = languageName(s.Language)
  const title = ownTitle(s, language)
  const forced = s.IsForced && !/forced/i.test(title ?? '') ? 'Forced' : undefined
  return [language ?? 'Unknown language', title, forced].filter(Boolean).join(' · ')
}

function isPicture(s: MediaStream): boolean {
  return s.IsTextSubtitleStream === false || /pgs|dvd_?sub|dvb_?sub|vobsub/i.test(s.Codec ?? '')
}

export function audioTracks(source: MediaSource): MediaTrack[] {
  return (source.MediaStreams ?? [])
    .filter((s) => s.Type === 'Audio' && s.Index !== undefined)
    .map((s) => ({
      index: s.Index ?? 0,
      label: audioLabel(s),
      language: s.Language,
      burnIn: false,
      isDefault: s.Index === source.DefaultAudioStreamIndex || Boolean(s.IsDefault),
      forced: false,
    }))
}

export function subtitleTracks(source: MediaSource): MediaTrack[] {
  return (source.MediaStreams ?? [])
    .filter((s) => s.Type === 'Subtitle' && s.Index !== undefined)
    .map((s) => ({
      index: s.Index ?? 0,
      label: subtitleLabel(s) + (isPicture(s) ? ' (burned in)' : ''),
      language: s.Language,
      burnIn: isPicture(s),
      isDefault: Boolean(s.IsDefault),
      forced: Boolean(s.IsForced),
    }))
}

/** What was chosen last time, for the next film: audio in this language, subtitles in that one or none */
export interface Preference {
  audio?: string | undefined
  /** undefined: subtitles off */
  subtitles?: string | undefined
}

/** The audio to start with: in the language chosen last time if the film has it, else the file's default */
export function pickAudio(tracks: MediaTrack[], pref: Preference): MediaTrack | undefined {
  return (
    (pref.audio && tracks.find((t) => t.language === pref.audio)) ||
    tracks.find((t) => t.isDefault) ||
    tracks[0]
  )
}

/**
 * The subtitles to start with: in the language chosen last time (text ones,
 * full rather than forced-only); else, with them off, only forced ones in
 * the audio's language (signs and foreign dialogue), the way players do
 */
export function pickSubtitles(tracks: MediaTrack[], pref: Preference, audioLanguage: string | undefined): MediaTrack | undefined {
  const text = tracks.filter((t) => !t.burnIn)
  if (pref.subtitles) {
    const inLanguage = text.filter((t) => t.language === pref.subtitles)
    return inLanguage.find((t) => !t.forced) ?? inLanguage[0]
  }
  return audioLanguage ? text.find((t) => t.forced && t.language === audioLanguage) : undefined
}
