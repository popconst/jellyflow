// The Watch view's rows, Netflix style: Continue Watching, the films and the
// series newest first, then six genre rows (each title in one).

import type { Movie } from './movies.ts'
import { lastWatched, upNext, type Episode, type Show } from './shows.ts'
import { byAdded, filterTitles, resumable, type Title } from './titles.ts'

/** A poster in a row: a title; in Continue Watching, also the episode it's at and when it was last watched */
export interface Tile {
  /** The title's: unique in a row */
  id: string
  title: Title
  episode?: Episode | undefined
  /** When it was last watched (ms) */
  watched?: number | undefined
}

export interface Shelf {
  /** The same across reloads: "continue", the library's id, "genre:Animation", "search" */
  key: string
  name: string
  tiles: Tile[]
}

export interface Library {
  id: string
  name: string
  kind: 'movies' | 'tvshows'
  titles: Title[]
}

/** Whether a library is in Watch: one none of whose titles has a genre (courses, say) waits for a place of its own */
export function inWatch(library: Library): boolean {
  return library.titles.some((t) => t.genres.length)
}

/** The genre rows, in this order; each title is in one of them at most */
const CATEGORIES = ['Documentaries', 'Kids', 'Action', 'Comedy', 'Drama', 'Thriller'] as const
export type Category = (typeof CATEGORIES)[number]

/** Ratings made for children, whatever the genre */
const CHILDREN = new Set(['TV-Y', 'TV-Y7', 'TV-Y7-FV'])
/** Ratings fine for children: a cartoon rated so is for kids */
const ALL_AGES = new Set(['G', 'PG', 'TV-G', 'U'])
/** Ratings for teenagers and up: a family film rated so isn't for kids */
const GROWN_UP = new Set(['PG-13', 'R', 'NC-17', 'TV-14', 'TV-MA', '12', '15', '18'])

/** The four big genres, as Jellyfin (TMDB) names them */
const MAJOR: Record<string, Category> = { Action: 'Action', Comedy: 'Comedy', Drama: 'Drama', Thriller: 'Thriller' }
/** The smaller ones, each in the big one nearest to it */
const NEAR: Record<string, Category> = {
  Adventure: 'Action',
  'Action & Adventure': 'Action',
  'Science Fiction': 'Action',
  'Sci-Fi & Fantasy': 'Action',
  Fantasy: 'Action',
  War: 'Action',
  Western: 'Action',
  Crime: 'Thriller',
  Horror: 'Thriller',
  Mystery: 'Thriller',
  Romance: 'Drama',
  History: 'Drama',
  'War & Politics': 'Drama',
  Music: 'Drama',
  Soap: 'Drama',
}

/**
 * For kids: a children's series (its genre, or its rating); a family film
 * not rated for teenagers (unrated too: old ones often are); a cartoon
 * rated for all ages (an unrated one may well be for grown-ups)
 */
function forKids(title: Title): boolean {
  const g = title.genres
  const rating = title.rating ?? ''
  if (g.includes('Kids') || CHILDREN.has(rating)) return true
  if (g.includes('Family') && !GROWN_UP.has(rating)) return true
  return g.includes('Animation') && ALL_AGES.has(rating)
}

/**
 * The one genre row a title goes in: Kids if it's for kids, else
 * Documentaries, else the first of its genres that's one of the big four,
 * else the first that's near one of them. None for the rest (reality TV).
 */
export function categoryOf(title: Title): Category | undefined {
  if (forKids(title)) return 'Kids'
  if (title.genres.includes('Documentary')) return 'Documentaries'
  for (const g of title.genres) if (MAJOR[g]) return MAJOR[g]
  for (const g of title.genres) if (NEAR[g]) return NEAR[g]
  return undefined
}

/** Each title's tile, made once: rows rebuilt with the same titles keep the same tiles (and their covers) */
const tiles = new WeakMap<Title, Tile>()
function tile(title: Title): Tile {
  let t = tiles.get(title)
  if (!t) tiles.set(title, (t = { id: title.id, title }))
  return t
}

/** The rows of what's in Watch (inWatch): the films' then the series' libraries, newest first; then the genre rows */
export function shelves(libraries: Library[]): Shelf[] {
  const shown = [...libraries].sort((a, b) => Number(b.kind === 'movies') - Number(a.kind === 'movies'))
  const out: Shelf[] = shown.map((l) => ({ key: l.id, name: l.name, tiles: [...l.titles].sort(byAdded).map(tile) }))
  const rows = new Map<Category, Title[]>()
  for (const t of shown.flatMap((l) => l.titles)) {
    const c = categoryOf(t)
    if (!c) continue
    const row = rows.get(c)
    if (row) row.push(t)
    else rows.set(c, [t])
  }
  for (const c of CATEGORIES) {
    const titles = rows.get(c)
    if (titles) out.push({ key: `genre:${c}`, name: c, tiles: titles.sort(byAdded).map(tile) })
  }
  return out
}

/** The row a search shows: what it finds, newest first */
export function searchShelf(titles: Title[], query: string): Shelf {
  return { key: 'search', name: `Found for “${query.trim()}”`, tiles: filterTitles(titles, query).sort(byAdded).map(tile) }
}

/** A series being watched: the episode to pick it up at, and when it was last watched */
export interface Watching {
  show: Show
  episode: Episode
  watched: number
}

/** Where a series is at, if it's being watched: begun, and not every episode watched */
export function watchingOf(show: Show, episodes: Episode[]): Watching | undefined {
  const next = upNext(episodes)
  const watched = lastWatched(episodes)
  return next && watched ? { show, episode: next.episode, watched } : undefined
}

/**
 * Continue Watching: films stopped partway and series being watched (at
 * their next episode), the latest watched first. `hidden` has what was
 * taken off it, by id, with when it had last been watched then: watched
 * again since, it's back.
 */
export function continuing(movies: Movie[], series: Watching[], hidden: Record<string, number>): Tile[] {
  const tiles: Tile[] = [
    ...movies.filter(resumable).map((m) => ({ id: m.id, title: m, watched: m.lastPlayed })),
    ...series.map(({ show, episode, watched }) => ({ id: show.id, title: show, episode, watched })),
  ]
  return tiles.filter((t) => hidden[t.id] === undefined || (t.watched ?? 0) > hidden[t.id]!).sort((a, b) => (b.watched ?? 0) - (a.watched ?? 0))
}
