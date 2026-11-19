// The albums, as coverflow lists them: sorted by year (oldest first, albums
// without one last), then title, then artist; playlist folders left out; and
// the search that finds an album by its artist, title, year or a track.

import { quality } from './details.ts'
import { folderName, seconds, type Item } from './jellyfin.ts'

export interface Album {
  id: string
  title: string
  artist: string
  /** The original year: the folder's "YYYY - " if it has one, else the tags' year */
  year: string
  /** The tags' year: this edition's */
  editionYear: string
  path: string
  imageTag: string | undefined
  genres: string[]
  labels: string[]
  musicbrainz: string | undefined
  /** "artist title year", lowercased once, for searching */
  search: string
}

/** A track to play */
export interface Track {
  id: string
  title: string
  artist: string
  album: string
  albumId: string
  imageTag: string | undefined
  disc: number | undefined
  number: number | undefined
  seconds: number
  /** "FLAC · 24-bit / 96 kHz · stereo", when the track came with its file's details */
  quality: string | undefined
  hiRes: boolean
}

/** Folders that aren't albums: playlists of loose tracks */
export function isPlaylist(path: string): boolean {
  return path.split(/[/\\]/).includes('Playlists')
}

export function toAlbum(item: Item): Album {
  const editionYear = item.ProductionYear ? String(item.ProductionYear) : ''
  const year = /^(\d{4})\b/.exec(folderName(item))?.[1] ?? editionYear
  const artist = item.AlbumArtist ?? item.AlbumArtists?.map((a) => a.Name).join(', ') ?? ''
  return {
    id: item.Id,
    title: item.Name,
    artist,
    year,
    editionYear,
    path: item.Path ?? '',
    imageTag: item.ImageTags?.['Primary'],
    genres: item.Genres ?? [],
    labels: item.Studios?.map((s) => s.Name) ?? [],
    musicbrainz: item.ProviderIds?.['MusicBrainzAlbum'],
    search: `${artist} ${item.Name} ${year}`.toLowerCase(),
  }
}

export function toTrack(item: Item): Track {
  return {
    id: item.Id,
    title: item.Name,
    artist: item.Artists?.join(', ') || item.AlbumArtist || '',
    album: item.Album ?? '',
    albumId: item.AlbumId ?? '',
    imageTag: item.AlbumPrimaryImageTag,
    disc: item.ParentIndexNumber,
    number: item.IndexNumber,
    seconds: seconds(item.RunTimeTicks),
    ...fileQuality(item),
  }
}

/** The file's format, if the track came with its media details */
function fileQuality(item: Item): { quality: string | undefined; hiRes: boolean } {
  if (!item.MediaSources) return { quality: undefined, hiRes: false }
  const q = quality(item)
  return { quality: q.text, hiRes: q.hiRes }
}

/** By year, oldest first, albums without one last; then title (case-insensitive, leading quotes and brackets ignored), then artist */
export function compareAlbums(a: Album, b: Album): number {
  const key = (x: Album) => x.title.replace(/^[^\p{L}\p{N}]+/u, '').toLowerCase()
  return (
    Number(a.year === '') - Number(b.year === '') ||
    cmp(a.year, b.year) ||
    cmp(key(a), key(b)) ||
    cmp(a.artist.toLowerCase(), b.artist.toLowerCase())
  )
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** The library's albums in the row's order, playlists left out */
export function albumsFrom(items: Item[]): Album[] {
  return items
    .filter((i) => !isPlaylist(i.Path ?? ''))
    .map(toAlbum)
    .sort(compareAlbums)
}

/** Each album's track titles, as they come in: album id → titles, lowercased alongside */
export class TrackTitles {
  readonly titles = new Map<string, string[]>()
  readonly lowered = new Map<string, string[]>()

  add(items: Item[]): void {
    for (const item of items) {
      if (!item.AlbumId) continue
      const titles = this.titles.get(item.AlbumId) ?? []
      const lowered = this.lowered.get(item.AlbumId) ?? []
      titles.push(item.Name)
      lowered.push(item.Name.toLowerCase())
      this.titles.set(item.AlbumId, titles)
      this.lowered.set(item.AlbumId, lowered)
    }
  }
}

export interface Found {
  /** Index into the albums */
  index: number
  /** The track it was found by, if it wasn't by the album itself */
  track: string | undefined
}

export function words(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

/**
 * Whether the words (any order, lowercased) are all in the album's artist,
 * title or year; or else, those that aren't, all in one of its track titles
 * (the first such track). `false` if neither.
 */
export function match(album: Album, ws: string[], titles: TrackTitles): { track: string | undefined } | false {
  const missing = ws.filter((w) => !album.search.includes(w))
  if (missing.length === 0) return { track: undefined }
  const lowered = titles.lowered.get(album.id) ?? []
  const at = lowered.findIndex((t) => missing.every((w) => t.includes(w)))
  return at < 0 ? false : { track: titles.titles.get(album.id)?.[at] }
}

/** The albums a query finds, in order; every album for an empty query */
export function filter(albums: Album[], query: string, titles: TrackTitles): Found[] {
  const ws = words(query)
  const found: Found[] = []
  for (const [index, album] of albums.entries()) {
    const m = ws.length === 0 ? { track: undefined } : match(album, ws, titles)
    if (m) found.push({ index, track: m.track })
  }
  return found
}
