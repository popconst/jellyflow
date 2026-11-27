import assert from 'node:assert/strict'
import { test } from 'node:test'
import { audioTracks, pickAudio, pickSubtitles, subtitleTracks } from './tracks.ts'
import type { MediaSource } from './types.ts'

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
