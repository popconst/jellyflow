import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Item, MediaSource } from './jellyfin.ts'
import { toMovie } from './movies.ts'
import {
  audioTarget,
  audioTracks,
  conversion,
  deviceProfile,
  pickAudio,
  pickSubtitles,
  playMethod,
  subtitleTracks,
  type Caps,
} from './playback.ts'
import { filterTitles, left, progress } from './titles.ts'
import { linesAt, parseVtt } from './vtt.ts'

const film = (id: string, name: string, sort: string, year: number, genres: string[], extra: Partial<Item> = {}): Item => ({
  Id: id,
  Name: name,
  Type: 'Movie',
  SortName: sort,
  ProductionYear: year,
  Genres: genres,
  RunTimeTicks: 100 * 60 * 10_000_000,
  ...extra,
})

test('films: searchable by title, year and genre, with where they were stopped', () => {
  const movies = [
    film('w', 'Winnie the Pooh', 'Winnie the Pooh', 2011, ['Animation', 'Family']),
    film('l', 'The Lion King', 'Lion King', 1994, ['Animation', 'Drama'], {
      UserData: { PlaybackPositionTicks: 25 * 60 * 10_000_000 },
    }),
    film('c', 'Cars', 'Cars', 2006, ['Animation', 'Comedy'], { OfficialRating: 'G', CommunityRating: 7.3 }),
  ].map(toMovie)
  assert.deepEqual(
    filterTitles(movies, 'animation 199').map((m) => m.id),
    ['l'],
  )
  assert.deepEqual(
    filterTitles(movies, 'POOH').map((m) => m.id),
    ['w'],
  )
  assert.equal(filterTitles(movies, '').length, 3)
  const lion = movies[1]!
  assert.equal(lion.resume, 1500)
  assert.equal(progress(lion), 0.25)
  assert.equal(left(lion), 75 * 60)
  assert.equal(movies[2]!.rating, 'G')
  assert.equal(movies[2]!.sortTitle, 'Cars')
})

const chrome: Caps = { video: ['h264', 'hevc'], audio: ['aac', 'mp3', 'opus', 'flac'] }
const safari: Caps = { video: ['h264', 'hevc'], audio: ['aac', 'mp3', 'alac', 'flac', 'ac3', 'eac3'] }

test('profile: video copied, audio copied where it plays, else converted without loss', () => {
  const p = deviceProfile(chrome)
  const hls = p.TranscodingProfiles[0]!
  assert.equal(hls.Protocol, 'hls')
  assert.equal(hls.Container, 'mp4')
  assert.equal(hls.VideoCodec, 'h264,hevc')
  // the first audio codec is what anything else is converted to
  assert.equal(hls.AudioCodec, 'flac,aac,mp3,opus')
  assert.equal(hls.MaxAudioChannels, '8')
  assert.deepEqual(p.DirectPlayProfiles[0]?.Container, 'mp4,m4v')
  assert.ok(p.SubtitleProfiles.some((s) => s.Format === 'vtt' && s.Method === 'External'))
  assert.ok(p.SubtitleProfiles.some((s) => s.Format === 'pgssub' && s.Method === 'Encode'))
  // only Dolby Vision with nothing under it is converted
  const ranges = p.CodecProfiles[0]?.Conditions[0]?.Value.split('|') ?? []
  assert.ok(ranges.includes('DOVIWithHDR10Plus') && ranges.includes('SDR') && !ranges.includes('DOVI'))
  // Safari plays Dolby itself: copied, not converted
  assert.equal(deviceProfile(safari).TranscodingProfiles[0]?.AudioCodec, 'alac,aac,mp3,flac,ac3,eac3')
  assert.equal(audioTarget({ video: ['h264'], audio: ['aac', 'mp3'] }), 'aac')
})

test('play method: repackaged only, or converted', () => {
  assert.deepEqual(
    conversion({ TranscodingUrl: '/videos/x/master.m3u8?VideoCodec=hevc,h264&AudioCodec=flac,aac&TranscodeReasons=ContainerNotSupported,AudioCodecNotSupported' }),
    { repackaged: true, video: false, audio: 'flac' },
  )
  assert.deepEqual(conversion({ TranscodingUrl: '/videos/x/master.m3u8?TranscodeReasons=SubtitleCodecNotSupported&AudioCodec=flac' }), {
    repackaged: true,
    video: true,
    audio: undefined,
  })
  assert.equal(playMethod({}), 'DirectPlay')
  assert.equal(playMethod({ TranscodingUrl: '/videos/x/master.m3u8?TranscodeReasons=ContainerNotSupported' }), 'DirectStream')
  assert.equal(
    playMethod({ TranscodingUrl: '/videos/x/master.m3u8?a=1&TranscodeReasons=ContainerNotSupported,AudioCodecNotSupported' }),
    'Transcode',
  )
})

const source: MediaSource = {
  DefaultAudioStreamIndex: 1,
  MediaStreams: [
    { Type: 'Video', Index: 0, Codec: 'hevc' },
    { Type: 'Audio', Index: 1, Codec: 'eac3', Language: 'eng', Channels: 6, IsDefault: true },
    { Type: 'Audio', Index: 2, Codec: 'ac3', Language: 'rum', Channels: 6 },
    { Type: 'Audio', Index: 3, Codec: 'dts', Profile: 'DTS-HD MA', Language: 'eng', Channels: 8, Title: 'Commentary' },
    { Type: 'Audio', Index: 8, Codec: 'ac3', Language: 'rum', Channels: 6, Title: 'DD5.1 @ 384 kbps, DVD RO' },
    { Type: 'Subtitle', Index: 4, Codec: 'subrip', Language: 'eng', IsTextSubtitleStream: true, IsForced: true },
    { Type: 'Subtitle', Index: 5, Codec: 'subrip', Language: 'eng', IsTextSubtitleStream: true, Title: 'SDH' },
    { Type: 'Subtitle', Index: 6, Codec: 'subrip', Language: 'rum', IsTextSubtitleStream: true },
    { Type: 'Subtitle', Index: 7, Codec: 'PGSSUB', Language: 'eng', IsTextSubtitleStream: false },
  ],
}

test('tracks: named plainly, the last choice of language kept from film to film', () => {
  const audio = audioTracks(source)
  assert.deepEqual(
    audio.map((t) => t.label),
    [
      'English · Dolby Digital+ 5.1',
      'Romanian · Dolby Digital 5.1',
      'English · Commentary · DTS-HD MA 7.1',
      'Romanian · Dolby Digital 5.1',
    ],
  )
  const subs = subtitleTracks(source)
  assert.deepEqual(
    subs.map((t) => t.label),
    ['English · Forced', 'English · SDH', 'Romanian', 'English (burned in)'],
  )
  assert.equal(subs[3]?.burnIn, true)

  // nothing chosen before: the default audio, and only forced subtitles in its language
  assert.equal(pickAudio(audio, {})?.index, 1)
  assert.equal(pickSubtitles(subs, {}, 'eng')?.index, 4)
  assert.equal(pickSubtitles(subs, {}, 'rum'), undefined)
  // Romanian last time: Romanian again, with Romanian subtitles if they were on
  assert.equal(pickAudio(audio, { audio: 'rum' })?.index, 2)
  assert.equal(pickSubtitles(subs, { audio: 'rum', subtitles: 'rum' }, 'rum')?.index, 6)
  // English subtitles on: the full ones, not the forced
  assert.equal(pickSubtitles(subs, { subtitles: 'eng' }, 'eng')?.index, 5)
  // a language the film doesn't have: the default
  assert.equal(pickAudio(audio, { audio: 'fre' })?.index, 1)
})

test('subtitles: WebVTT read into plain cues, found by time', () => {
  const cues = parseVtt(
    [
      'WEBVTT',
      '',
      'NOTE a comment',
      '',
      '1',
      '00:00:01.000 --> 00:00:03.500 align:middle line:90%',
      '<i>Hello</i> &amp; welcome',
      '',
      '00:02.000 --> 00:04.000',
      '<v Pooh>Oh, bother.</v>',
      'Second line',
      '',
      '01:00:00.000 --> 01:00:01.000',
      'Late',
    ].join('\r\n'),
  )
  assert.equal(cues.length, 3)
  assert.deepEqual(cues[0], { start: 1, end: 3.5, lines: ['Hello & welcome'] })
  assert.deepEqual(linesAt(cues, 0.5), [])
  assert.deepEqual(linesAt(cues, 2.5), ['Hello & welcome', 'Oh, bother.', 'Second line'])
  assert.deepEqual(linesAt(cues, 3.6), ['Oh, bother.', 'Second line'])
  assert.deepEqual(linesAt(cues, 3600.5), ['Late'])
  assert.deepEqual(linesAt(cues, 4000), [])
})
