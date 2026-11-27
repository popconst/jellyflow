// What to ask Jellyfin for, for films and for music: this browser's device
// profiles (from what it plays, Caps: browser.ts finds out), the picture
// qualities to choose from, and what Jellyfin then does to the file. The
// rule is to send the file's own streams untouched wherever the browser
// plays them, and to convert only what it can't: the picture never (both
// kinds of browser play H.264 and HEVC) but for Dolby Vision with nothing
// under it, or a lower quality chosen for a slow link; the sound to FLAC or
// ALAC, which keep exactly what the original track holds (Dolby and DTS
// tracks are decoded, not compressed again; lossless ones stay lossless),
// or to AAC at the lowest qualities.

import type { DeviceProfile, MediaSource } from './types.ts'

/** What the browser plays, as Jellyfin names codecs: found by asking it (canPlayType, MediaSource.isTypeSupported) */
export interface Caps {
  /** In a stream (HLS, fragmented MP4): h264, hevc, av1, vp9 */
  video: string[]
  /** … and its sound: aac, mp3, opus, flac, alac, ac3, eac3 */
  audio: string[]
  /** Music files, as they are: flac, mp3, aac, opus, vorbis; alac in Safari */
  files: string[]
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

/** A picture quality to ask Jellyfin for: the file as it is, or re-encoded to fit a bitrate (for a slow link) */
export interface Quality {
  /** Bits per second at most */
  bitrate: number
  /** The picture's height at most; none for the file's own */
  height?: number | undefined
  label: string
}

/** The file as it is */
const ORIGINAL: Quality = { bitrate: MAX_BITRATE, label: 'Original' }

/** Below this many bits per second, lossless sound (a few Mbps for 5.1) would take too much of the stream: AAC instead */
const LOSSLESS_FROM = 10_000_000

/** Jellyfin's own player's choices: height, bits per second */
const LADDER: [number, number][] = [
  [2160, 120_000_000],
  [2160, 80_000_000],
  [1080, 60_000_000],
  [1080, 40_000_000],
  [1080, 20_000_000],
  [1080, 15_000_000],
  [1080, 10_000_000],
  [720, 8_000_000],
  [720, 6_000_000],
  [720, 4_000_000],
  [480, 3_000_000],
  [480, 1_500_000],
  [480, 720_000],
  [360, 420_000],
]

/** "4K", "1080p" */
function sizeName(height: number): string {
  return height >= 2160 ? '4K' : `${height}p`
}

/** "20 Mbps", "1.5 Mbps", "720 kbps" */
function rateName(bitrate: number): string {
  return bitrate >= 1_000_000 ? `${bitrate / 1_000_000} Mbps` : `${bitrate / 1000} kbps`
}

/** The file's picture as qualities name it, by its width (a wide film is less tall): 2160 for 4K, 1080, 720, … */
function pictureSize(source: MediaSource): number | undefined {
  const width = source.MediaStreams?.find((s) => s.Type === 'Video')?.Width
  if (!width) return undefined
  return width >= 3200 ? 2160 : width >= 1800 ? 1080 : width >= 1200 ? 720 : width >= 800 ? 480 : 360
}

/** What a file can be watched in: as it is, then Jellyfin's choices from its own size down */
export function qualities(source: MediaSource): Quality[] {
  const size = pictureSize(source)
  return [
    { ...ORIGINAL, label: size ? `Original · ${sizeName(size)}` : ORIGINAL.label },
    ...LADDER.filter(([height]) => !size || height <= size).map(([height, bitrate]) => ({
      height,
      bitrate,
      label: `${sizeName(height)} · ${rateName(bitrate)}`,
    })),
  ]
}

/** The quality to start with: the file's own, or the best one within the bitrate chosen last time (on this browser) */
export function pickQuality(choices: Quality[], bitrate: number | undefined): Quality {
  const original = choices[0] ?? ORIGINAL
  if (!bitrate) return original
  return choices.find((q) => q !== original && q.bitrate <= bitrate) ?? choices.at(-1) ?? original
}

/** What to convert audio the browser can't play into: lossless if it can be, else AAC */
export function audioTarget(caps: Caps): string {
  return caps.audio.find((c) => c === 'flac' || c === 'alac') ?? 'aac'
}

/** The containers music files of each codec come in, as Jellyfin names them */
const MUSIC_FILES: Record<string, string> = {
  flac: 'flac',
  mp3: 'mp3',
  aac: 'm4a,m4b,mp4,aac',
  alac: 'm4a,m4b,mp4',
  opus: 'ogg,opus,webm',
  vorbis: 'ogg,oga,webm',
}

/**
 * This browser's profile for music, under the app's `name`. Files it plays
 * as they are (FLAC, MP3 and AAC everywhere, ALAC in Safari) come as they
 * are; any other (ALAC in Chrome and Firefox) is converted on the fly into
 * HLS with fragmented MP4, to FLAC where the browser plays that in a
 * stream, which loses nothing.
 */
export function musicProfile(caps: Caps, name: string): DeviceProfile {
  return {
    Name: name,
    MaxStreamingBitrate: MAX_BITRATE,
    MaxStaticBitrate: MAX_BITRATE,
    DirectPlayProfiles: caps.files.flatMap((codec) => {
      const containers = MUSIC_FILES[codec]
      return containers ? [{ Type: 'Audio', Container: containers, AudioCodec: codec }] : []
    }),
    TranscodingProfiles: [
      {
        Type: 'Audio',
        Container: 'mp4',
        Protocol: 'hls',
        Context: 'Streaming',
        AudioCodec: audioTarget(caps),
        MaxAudioChannels: '8',
        MinSegments: 1,
        BreakOnNonKeyFrames: true,
      },
    ],
    ContainerProfiles: [],
    CodecProfiles: [],
    SubtitleProfiles: [],
  }
}

/**
 * This browser's profile for films and episodes, under the app's `name`.
 * Files it plays as they are (MP4) stream as they are; anything else (MKV) is repackaged on the fly into HLS
 * with fragmented MP4: video copied, audio copied where the browser plays
 * it, else converted to the first codec of the list. Text subtitles come as
 * WebVTT for the player to draw; picture ones (Blu-ray PGS, DVD) can only be
 * burned into the picture, which re-encodes it. A lower `quality` than the
 * file's has Jellyfin re-encode the picture to fit it (and, at the lowest,
 * the sound to AAC).
 */
export function deviceProfile(caps: Caps, name: string, quality: Quality = ORIGINAL): DeviceProfile {
  const video = caps.video.join(',')
  const target = quality.bitrate < LOSSLESS_FROM && caps.audio.includes('aac') ? 'aac' : audioTarget(caps)
  const audio = [target, ...caps.audio.filter((c) => c !== target)].join(',')
  const smaller = quality.height
    ? [{ Type: 'Video', Codec: video, Conditions: [{ Condition: 'LessThanEqual', Property: 'Height', Value: String(quality.height), IsRequired: false }] }]
    : []
  return {
    Name: name,
    MaxStreamingBitrate: quality.bitrate,
    MaxStaticBitrate: quality.bitrate,
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
      ...smaller,
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
