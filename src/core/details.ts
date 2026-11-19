// An album at a glance, from Jellyfin's album and its tracks: artists, years,
// label, genres, length, audio quality, credits, MusicBrainz id, folder; and
// the Discogs / Wikipedia / MusicBrainz links (coverflow's `i` panel).

import { seconds, type Item, type MediaStream } from './jellyfin.ts'
import type { Album } from './library.ts'

export interface Quality {
  /** e.g. "FLAC · 24-bit / 96 kHz · stereo" */
  text: string
  /** More than CD quality: lossless above 16-bit or 48 kHz, or DSD */
  hiRes: boolean
  tracks: number
}

export interface Details {
  artist: string
  /** The tracks' artists in order of appearance, if any differ from the album artist */
  trackArtists: string[]
  /** "1977", or "1977 (this edition 2016)" */
  year: string
  labels: string[]
  genres: string[]
  tracks: number
  discs: number
  seconds: number
  /** One line per kind of file, most tracks first */
  quality: Quality[]
  composers: string[]
  /** Everyone else credited: "Name (role)" */
  credits: string[]
  musicbrainz: string | undefined
  folder: string
}

export interface Link {
  key: string
  name: string
  url: string
}

const unique = (items: Iterable<string>): string[] => [...new Set([...items].filter(Boolean))]

/** 44.1 kHz, 96 kHz, 22.05 kHz */
export function khz(rate: number): string {
  return `${(rate / 1000).toFixed(2).replace(/\.?0+$/, '')} kHz`
}

function channels(n: number | undefined): string {
  return n === 1 ? 'mono' : n === 2 || n === undefined ? 'stereo' : `${n} channels`
}

/** The codec's name, and whether it's lossless */
function codec(stream: MediaStream, container: string): [string, boolean] {
  const c = (stream.Codec ?? container).toLowerCase()
  if (c.startsWith('dsd')) return ['DSD', true]
  if (c.startsWith('pcm')) return [container.startsWith('aif') ? 'AIFF' : 'WAV', true]
  const known: Record<string, [string, boolean]> = {
    flac: ['FLAC', true],
    alac: ['ALAC', true],
    ape: ['APE', true],
    wavpack: ['WavPack', true],
    tta: ['TTA', true],
    mp3: ['MP3', false],
    aac: ['AAC', false],
    vorbis: ['Ogg Vorbis', false],
    opus: ['Opus', false],
    musepack7: ['Musepack', false],
    musepack8: ['Musepack', false],
    wmav2: ['WMA', false],
  }
  return known[c] ?? [c.toUpperCase() || '?', false]
}

export function quality(track: Item): { text: string; hiRes: boolean } {
  const source = track.MediaSources?.[0]
  const stream = source?.MediaStreams?.find((s) => s.Type === 'Audio')
  const container = (source?.Container ?? '').toLowerCase()
  if (!stream) return { text: container.toUpperCase() || '?', hiRes: false }
  const [name, lossless] = codec(stream, container)
  const rate = stream.SampleRate ?? 0
  const bits = stream.BitDepth ?? 0
  let detail: string
  let hiRes = false
  if (name === 'DSD') {
    detail = rate ? `DSD${Math.round(rate / 44_100)}` : 'DSD'
    hiRes = true
  } else if (!lossless || !bits) {
    // a lossy file's bit depth is only the decoder's
    detail = rate ? khz(rate) : ''
  } else {
    detail = `${bits}-bit / ${khz(rate)}`
    hiRes = bits > 16 || rate > 48_000
  }
  return { text: [name, detail, channels(stream.Channels)].filter(Boolean).join(' · '), hiRes }
}

export function details(album: Album, tracks: Item[]): Details {
  const artists = unique(tracks.flatMap((t) => t.Artists ?? []))
  const differ = artists.some((a) => a !== album.artist)
  const qualities = new Map<string, Quality>()
  for (const track of tracks) {
    const q = quality(track)
    const seen = qualities.get(q.text)
    if (seen) seen.tracks++
    else qualities.set(q.text, { ...q, tracks: 1 })
  }
  const people = tracks.flatMap((t) => t.People ?? [])
  const year =
    album.editionYear && album.year && album.editionYear !== album.year
      ? `${album.year} (this edition ${album.editionYear})`
      : album.year || album.editionYear
  return {
    artist: album.artist,
    trackArtists: differ ? artists : [],
    year,
    labels: album.labels,
    genres: album.genres,
    tracks: tracks.length,
    discs: new Set(tracks.map((t) => t.ParentIndexNumber ?? 1)).size,
    seconds: tracks.reduce((sum, t) => sum + seconds(t.RunTimeTicks), 0),
    quality: [...qualities.values()].sort((a, b) => b.tracks - a.tracks),
    composers: unique(people.filter((p) => p.Type === 'Composer').map((p) => p.Name)),
    credits: unique(
      people
        .filter((p) => p.Type !== 'Composer')
        .map((p) => {
          const role = p.Role || p.Type
          return role && role !== 'Artist' && role !== 'AlbumArtist' ? `${p.Name} (${role.toLowerCase()})` : p.Name
        }),
    ).filter((c) => !artists.includes(c)),
    musicbrainz: album.musicbrainz,
    folder: album.path,
  }
}

/** Discogs and Wikipedia searches for the album, and its MusicBrainz page when it has a release id */
export function links(album: Album): Link[] {
  const query = encodeURIComponent(`${album.artist} ${album.title}`.trim())
  const list: Link[] = [
    { key: 'd', name: 'Discogs', url: `https://www.discogs.com/search/?q=${query}` },
    { key: 'w', name: 'Wikipedia', url: `https://en.wikipedia.org/w/index.php?search=${query}%20album` },
  ]
  if (album.musicbrainz) {
    list.push({ key: 'm', name: 'MusicBrainz', url: `https://musicbrainz.org/release/${album.musicbrainz}` })
  }
  return list
}

/** 3:07, 1:02:03 */
export function duration(total: number): string {
  const s = Math.round(total)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
