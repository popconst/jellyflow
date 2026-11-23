// Playing films: what to ask Jellyfin for, and the choice of audio and
// subtitles. The rule is to send the file's own streams untouched wherever
// the browser plays them, and to convert only what it can't: video never
// (both kinds of browser play H.264 and HEVC), audio to FLAC or ALAC, which
// keep exactly what the original track holds (Dolby and DTS tracks are
// decoded, not compressed again; lossless ones stay lossless).

import type { DeviceProfile, MediaSource, MediaStream } from './jellyfin.ts'

/** What the browser plays, as Jellyfin names codecs: found by asking it (canPlayType, MediaSource.isTypeSupported) */
export interface Caps {
  /** h264, hevc, av1, vp9 */
  video: string[]
  /** aac, mp3, opus, flac, alac, ac3, eac3 */
  audio: string[]
}

/** HEVC pictures browsers show right: Dolby Vision only where there's an HDR10 (or SDR, HLG) one under it */
const PICTURES = [
  'SDR',
  'HDR10',
  'HDR10Plus',
  'HLG',
  'DOVIWithHDR10',
  'DOVIWithHDR10Plus',
  'DOVIWithHLG',
  'DOVIWithSDR',
  'DOVIWithEL',
  'DOVIWithELHDR10Plus',
]

/** As much as Jellyfin takes: never a reason to re-encode */
const MAX_BITRATE = 400_000_000

/** What to convert audio the browser can't play into: lossless if it can be, else AAC */
export function audioTarget(caps: Caps): string {
  return caps.audio.find((c) => c === 'flac' || c === 'alac') ?? 'aac'
}

/**
 * This browser's profile for Jellyfin. Files it plays as they are (MP4)
 * stream as they are; anything else (MKV) is repackaged on the fly into HLS
 * with fragmented MP4: video copied, audio copied where the browser plays
 * it, else converted to the first codec of the list. Text subtitles come as
 * WebVTT for the player to draw; picture ones (Blu-ray PGS, DVD) can only be
 * burned into the picture, which re-encodes it.
 */
export function deviceProfile(caps: Caps): DeviceProfile {
  const video = caps.video.join(',')
  const target = audioTarget(caps)
  const audio = [target, ...caps.audio.filter((c) => c !== target)].join(',')
  return {
    Name: 'jellyflow',
    MaxStreamingBitrate: MAX_BITRATE,
    MaxStaticBitrate: MAX_BITRATE,
    DirectPlayProfiles: [{ Type: 'Video', Container: 'mp4,m4v', VideoCodec: video, AudioCodec: caps.audio.join(',') }],
    TranscodingProfiles: [
      {
        Type: 'Video',
        Container: 'mp4',
        Protocol: 'hls',
        Context: 'Streaming',
        VideoCodec: video,
        AudioCodec: audio,
        MaxAudioChannels: '8',
        MinSegments: 1,
        BreakOnNonKeyFrames: true,
      },
    ],
    ContainerProfiles: [],
    // Dolby Vision without an HDR10 (or SDR, HLG) picture underneath (profile 5) shows green and
    // purple in browsers: Jellyfin converts only that, to HDR10; everything else is copied
    CodecProfiles: [
      {
        Type: 'Video',
        Codec: 'hevc',
        Conditions: [{ Condition: 'EqualsAny', Property: 'VideoRangeType', Value: PICTURES.join('|'), IsRequired: false }],
      },
    ],
    SubtitleProfiles: [
      { Format: 'vtt', Method: 'External' },
      { Format: 'pgssub', Method: 'Encode' },
      { Format: 'dvdsub', Method: 'Encode' },
      { Format: 'dvbsub', Method: 'Encode' },
    ],
  }
}

/** What Jellyfin does to the file for this browser: picture re-encoded or not, sound converted to what (if it is) */
export interface Conversion {
  /** Repackaged into a stream (MKV → HLS), streams untouched or not */
  repackaged: boolean
  video: boolean
  /** The codec the sound is converted to; undefined if it's untouched */
  audio: string | undefined
}

/** Read from the stream's URL: why Jellyfin isn't sending the file as it is, and what it sends instead */
export function conversion(source: MediaSource): Conversion {
  if (!source.TranscodingUrl) return { repackaged: false, video: false, audio: undefined }
  const params = new URL(source.TranscodingUrl, 'http://x').searchParams
  const reasons = (params.get('TranscodeReasons') ?? '').split(',').filter(Boolean)
  const video = reasons.some((r) => /^(Video|RefFrames|Anamorphic|Interlaced|Subtitle|ContainerBitrate|UnknownVideo)/.test(r))
  const audio = reasons.some((r) => /^(Audio|SecondaryAudio|UnknownAudio)/.test(r))
  return { repackaged: true, video, audio: audio ? (params.get('AudioCodec') ?? 'aac').split(',')[0] : undefined }
}

/** How the stream Jellyfin chose plays, for its reports */
export function playMethod(source: MediaSource): 'DirectPlay' | 'DirectStream' | 'Transcode' {
  const c = conversion(source)
  return !c.repackaged ? 'DirectPlay' : c.video || c.audio ? 'Transcode' : 'DirectStream'
}

/** An audio or subtitle track to choose */
export interface Track {
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

export function audioTracks(source: MediaSource): Track[] {
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

export function subtitleTracks(source: MediaSource): Track[] {
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
export function pickAudio(tracks: Track[], pref: Preference): Track | undefined {
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
export function pickSubtitles(tracks: Track[], pref: Preference, audioLanguage: string | undefined): Track | undefined {
  const text = tracks.filter((t) => !t.burnIn)
  if (pref.subtitles) {
    const inLanguage = text.filter((t) => t.language === pref.subtitles)
    return inLanguage.find((t) => !t.forced) ?? inLanguage[0]
  }
  return audioLanguage ? text.find((t) => t.forced && t.language === audioLanguage) : undefined
}
