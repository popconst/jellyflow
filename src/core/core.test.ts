import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { details, duration, khz, links, quality } from './details.ts'
import type { Item } from './jellyfin.ts'
import { compareNames, folderName, VERSION } from './jellyfin.ts'
import { Keys } from './keys.ts'
import { albumsFrom, filter, TrackTitles } from './library.ts'
import { Motion } from './motion.ts'

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

test('keys: counts and two-key commands', () => {
  const keys = new Keys()
  assert.equal(keys.feed('1'), undefined)
  assert.equal(keys.feed('2'), undefined)
  assert.deepEqual(keys.feed('j'), { key: 'j', count: 12 })
  assert.equal(keys.feed('g'), undefined)
  assert.deepEqual(keys.feed('g'), { key: 'gg', count: undefined })
  assert.deepEqual(keys.feed('0'), { key: '0', count: undefined })
  assert.deepEqual(keys.feed('G'), { key: 'G', count: undefined })
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

test('motion: a tap glides one album; a hold runs ever faster and slows onto an album', () => {
  const run = (m: Motion, seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 60) m.tick(1 / 60, 1000)
  }
  const m = new Motion()
  m.press(1)
  m.release(1)
  run(m, 1)
  assert.equal(m.pos, 1)
  assert.equal(m.moving, false)

  // held: the keyboard starts repeating, and it runs, faster and faster
  m.press(1)
  run(m, 0.15)
  m.repeat(1)
  run(m, 0.2)
  const early = m.velocity
  assert.ok(early >= 12, `sliding from the start: ${early}`)
  run(m, 0.8)
  assert.ok(m.velocity > early * 3, `faster the longer it's held: ${early} → ${m.velocity}`)
  const at = m.pos
  m.release(1)
  let prev = m.velocity
  let jolt = 0
  for (let t = 0; t < 1.5; t += 1 / 60) {
    m.tick(1 / 60, 1000)
    jolt = Math.max(jolt, Math.abs(m.velocity) - Math.abs(prev))
    prev = m.velocity
  }
  assert.equal(m.moving, false)
  assert.ok(Number.isInteger(m.pos) && m.pos > at && m.pos <= Math.ceil(at) + 6, `stops on an album just ahead: ${at} → ${m.pos}`)
  assert.ok(jolt <= 0.001, `slows down without speeding up again: ${jolt}`)

  // no key repeat: a long press runs too
  m.press(-1)
  run(m, 60)
  m.release(-1)
  run(m, 1)
  assert.equal(m.pos, 0, 'stops at the first album')

  m.jump(500)
  assert.equal(m.pos, 488, 'a far jump starts close by')
  run(m, 2)
  assert.equal(m.pos, 500)

  // a click glides there, more gently than a jump
  const j = new Motion()
  j.jump(4)
  m.snap(0)
  m.glide(4)
  run(j, 0.15)
  run(m, 0.15)
  assert.ok(m.pos < j.pos - 0.5, 'a glide is gentler')
  run(m, 2)
  assert.equal(m.pos, 4)
})

test('folders: names from the path, natural order', () => {
  assert.equal(folderName({ Id: 'x', Name: 'Kill', Type: 'MusicAlbum', Path: '/m/Metallica/1983 - Kill/' }), '1983 - Kill')
  assert.ok(compareNames('Disc 2', 'Disc 10') < 0)
})

test('the version Jellyfin is told is the package version', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
  assert.equal(VERSION, pkg.version)
})
