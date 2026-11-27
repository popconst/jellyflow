import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Item, MediaSource } from '../lib/jellyfin/index.ts'
import { details, duration, khz, links, quality, streamed } from './details.ts'
import { VERSION } from './jellyflow.ts'
import { albumsFrom, filter, TrackTitles } from './library.ts'

const album = (id: string, name: string, artist: string, path: string, year?: number): Item => ({
  Id: id,
  Name: name,
  Type: 'MusicAlbum',
  AlbumArtist: artist,
  Path: path,
  ...(year ? { ProductionYear: year } : {}),
})

const library = [
  album('k', 'Kill ’Em All', 'Metallica', '/media/music/Metallica/1983 - Kill ’Em All', 2016),
  album('r', 'Ride the Lightning', 'Metallica', '/media/music/Metallica/1984 - Ride the Lightning', 1984),
  album('g', 'Gold', 'ABBA', '/media/music/ABBA/1992 - Gold', 1992),
  album('n', '"Heroes"', 'David Bowie', '/media/music/David Bowie/Heroes'),
  album('p', 'Road trip', 'Mix', '/media/music/Mix/Playlists/Road trip', 2020),
]

test('albums: by original year from the folder, untagged years last, playlists left out', () => {
  const albums = albumsFrom(library)
  assert.deepEqual(
    albums.map((a) => a.id),
    ['k', 'r', 'g', 'n'],
  )
  assert.equal(albums[0]?.year, '1983')
  assert.equal(albums[0]?.editionYear, '2016')
})

test('search: words in any order, by album or else by one track', () => {
  const albums = albumsFrom(library)
  const titles = new TrackTitles()
  titles.add([
    { Id: '1', Name: 'Fight Fire with Fire', Type: 'Audio', AlbumId: 'r' },
    { Id: '2', Name: 'Dancing Queen', Type: 'Audio', AlbumId: 'g' },
  ])
  const ids = (q: string) => filter(albums, q, titles).map((f) => [albums[f.index]?.id, f.track])
  assert.deepEqual(ids('metallica 1983'), [['k', undefined]])
  assert.deepEqual(ids('abba queen'), [['g', 'Dancing Queen']])
  assert.deepEqual(ids('fire metallica'), [['r', 'Fight Fire with Fire']])
  assert.equal(ids('').length, 4)
  assert.deepEqual(ids('nothing like this'), [])
})

test('details: quality lines, years, links', () => {
  const track = (codec: string, bits: number, rate: number, disc = 1): Item => ({
    Id: codec + rate,
    Name: 't',
    Type: 'Audio',
    ParentIndexNumber: disc,
    RunTimeTicks: 1_800_000_000,
    Artists: ['ABBA'],
    MediaSources: [{ Container: codec, MediaStreams: [{ Type: 'Audio', Codec: codec, BitDepth: bits, SampleRate: rate, Channels: 2 }] }],
  })
  assert.deepEqual(quality(track('flac', 24, 96000)), { text: 'FLAC · 24-bit / 96 kHz · stereo', hiRes: true })
  assert.deepEqual(quality(track('mp3', 16, 44100)), { text: 'MP3 · 44.1 kHz · stereo', hiRes: false })
  // as Jellyfin sends it: the file as it is, or converted on the fly, from what to what
  const alac: MediaSource = { Container: 'mov,mp4,m4a,3gp,3g2,mj2', MediaStreams: [{ Type: 'Audio', Codec: 'alac', BitDepth: 24, SampleRate: 96000, Channels: 2 }] }
  const to = (codec: string): MediaSource => ({ ...alac, TranscodingUrl: `/audio/a/master.m3u8?AudioCodec=${codec}&SegmentContainer=mp4&TranscodeReasons=AudioCodecNotSupported` })
  assert.deepEqual(streamed(alac), { text: 'ALAC · 24-bit / 96 kHz · stereo', hiRes: true, note: 'Streamed as the file is, not transcoded' })
  assert.deepEqual(streamed(to('flac')), {
    text: 'ALAC → FLAC · 24-bit / 96 kHz · stereo',
    hiRes: true,
    note: 'Converted on the fly from ALAC to FLAC, losing nothing: this browser doesn’t play ALAC',
  })
  assert.deepEqual(streamed(to('aac')), {
    text: 'ALAC → AAC · 24-bit / 96 kHz · stereo',
    hiRes: false,
    note: 'Converted on the fly from ALAC to AAC: this browser doesn’t play ALAC',
  })
  assert.equal(khz(22050), '22.05 kHz')
  const [kill] = albumsFrom(library)
  assert.ok(kill)
  const d = details(kill, [track('flac', 16, 44100), track('flac', 16, 44100, 2), track('mp3', 16, 44100, 2)])
  assert.equal(d.year, '1983 (this edition 2016)')
  assert.equal(d.discs, 2)
  assert.equal(duration(d.seconds), '9:00')
  assert.deepEqual(
    d.quality.map((q) => [q.text, q.tracks]),
    [
      ['FLAC · 16-bit / 44.1 kHz · stereo', 2],
      ['MP3 · 44.1 kHz · stereo', 1],
    ],
  )
  assert.deepEqual(d.trackArtists, ['ABBA'])
  assert.equal(links(kill)[0]?.url, 'https://www.discogs.com/search/?q=Metallica%20Kill%20%E2%80%99Em%20All')
  assert.equal(duration(3723), '1:02:03')
})

test('the version Jellyfin is told is the package version', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
  assert.equal(VERSION, pkg.version)
})
