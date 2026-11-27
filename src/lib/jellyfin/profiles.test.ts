import assert from 'node:assert/strict'
import { test } from 'node:test'
import { audioTarget, conversion, deviceProfile, musicProfile, pickQuality, playMethod, qualities, type Caps } from './profiles.ts'
import type { MediaSource } from './types.ts'

const NAME = 'jellyflow'

const chrome: Caps = { video: ['h264', 'hevc'], audio: ['aac', 'mp3', 'opus', 'flac'], files: ['flac', 'mp3', 'aac', 'opus', 'vorbis'] }
const safari: Caps = { video: ['h264', 'hevc'], audio: ['aac', 'mp3', 'alac', 'flac', 'ac3', 'eac3'], files: ['flac', 'mp3', 'aac', 'alac'] }

test('profile: video copied, audio copied where it plays, else converted without loss', () => {
  const p = deviceProfile(chrome, NAME)
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
  assert.equal(deviceProfile(safari, NAME).TranscodingProfiles[0]?.AudioCodec, 'alac,aac,mp3,flac,ac3,eac3')
  assert.equal(audioTarget({ video: ['h264'], audio: ['aac', 'mp3'], files: [] }), 'aac')
})

test('music profile: files the browser plays as they are, the rest converted to FLAC (AAC where a stream can’t carry it)', () => {
  // Chrome: no ALAC file, so ALAC comes converted
  const p = musicProfile(chrome, NAME)
  assert.deepEqual(
    p.DirectPlayProfiles.map((d) => `${d.AudioCodec} in ${d.Container}`),
    ['flac in flac', 'mp3 in mp3', 'aac in m4a,m4b,mp4,aac', 'opus in ogg,opus,webm', 'vorbis in ogg,oga,webm'],
  )
  assert.ok(p.DirectPlayProfiles.every((d) => d.Type === 'Audio'))
  const hls = p.TranscodingProfiles[0]!
  assert.equal(hls.Type, 'Audio')
  assert.equal(`${hls.Protocol} ${hls.Container} ${hls.AudioCodec}`, 'hls mp4 flac')
  assert.equal(hls.VideoCodec, undefined)
  // Safari plays ALAC files as they are
  assert.ok(musicProfile(safari, NAME).DirectPlayProfiles.some((d) => d.AudioCodec === 'alac' && d.Container.includes('m4a')))
  // a stream without lossless sound: AAC
  assert.equal(musicProfile({ video: [], audio: ['aac', 'mp3'], files: ['mp3'] }, NAME).TranscodingProfiles[0]?.AudioCodec, 'aac')
})

test('quality: the file as it is, or Jellyfin’s choices from its size down; the last one chosen, within reach', () => {
  const fourK: MediaSource = { MediaStreams: [{ Type: 'Video', Width: 3840, Height: 1606 }] }
  const hd: MediaSource = { MediaStreams: [{ Type: 'Video', Width: 1828, Height: 1080 }] }
  const all = qualities(fourK)
  assert.deepEqual(
    all.slice(0, 4).map((q) => q.label),
    ['Original · 4K', '4K · 120 Mbps', '4K · 80 Mbps', '1080p · 60 Mbps'],
  )
  assert.deepEqual(
    all.slice(-3).map((q) => q.label),
    ['480p · 1.5 Mbps', '480p · 720 kbps', '360p · 420 kbps'],
  )
  const some = qualities(hd)
  assert.equal(some[1]?.label, '1080p · 60 Mbps')
  assert.equal(pickQuality(some, undefined), some[0])
  // 20 Mbps chosen on a 4K film: the same on this one; 80 Mbps: the best this one has under it
  assert.equal(pickQuality(some, 20_000_000).label, '1080p · 20 Mbps')
  assert.equal(pickQuality(some, 80_000_000).label, '1080p · 60 Mbps')
  // asked for: at most that bitrate, at most that height
  const p = deviceProfile(chrome, NAME, pickQuality(some, 8_000_000))
  assert.equal(p.MaxStreamingBitrate, 8_000_000)
  assert.deepEqual(p.CodecProfiles[1]?.Conditions[0], { Condition: 'LessThanEqual', Property: 'Height', Value: '720', IsRequired: false })
  assert.equal(deviceProfile(chrome, NAME).CodecProfiles.length, 1)
  // that low, the sound comes as AAC; from 10 Mbps up, still lossless
  assert.equal(p.TranscodingProfiles[0]?.AudioCodec.split(',')[0], 'aac')
  assert.equal(deviceProfile(chrome, NAME, pickQuality(some, 10_000_000)).TranscodingProfiles[0]?.AudioCodec.split(',')[0], 'flac')
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

test("the profiles go under the app's name", () => {
  assert.equal(deviceProfile(chrome, 'myapp').Name, 'myapp')
  assert.equal(musicProfile(chrome, 'myapp').Name, 'myapp')
})
