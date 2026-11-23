// What films and series have in common, as the Watch view shows them: the
// fields read from Jellyfin, the facts and status lines, how far one was
// watched, and the search that finds one by its title, year or genre.

import { compareNames, type Item } from './jellyfin.ts'
import { fold, words } from './library.ts'
import type { Movie } from './movies.ts'
import type { Show } from './shows.ts'

export type Title = Movie | Show

/** What every film and series has */
export interface TitleBase {
  id: string
  title: string
  /** The title it sorts by ("Lion King, The" style, from Jellyfin) */
  sortTitle: string
  /** "1994"; a series' "2005–2013", or "2019–" while it's still running */
  year: string
  /** "PG-13", "TV-Y", … */
  rating: string | undefined
  /** Out of 10 */
  score: number | undefined
  genres: string[]
  overview: string
  posterTag: string | undefined
  backdropTag: string | undefined
  /** When it came into the library (ms); a series', when its latest episode did */
  added: number
  played: boolean
  /** Its titles, year and genres, lowercased and without accents once, for searching */
  search: string
}

/** The fields every title reads the same way; `year` and `added` are worked out by the film's or the series' own */
export function titleBase(item: Item, year: string, added: number, otherTitle = ''): TitleBase {
  const genres = item.Genres ?? []
  return {
    id: item.Id,
    title: item.Name,
    sortTitle: item.SortName ?? item.Name,
    year,
    rating: item.OfficialRating,
    score: item.CommunityRating,
    genres,
    overview: item.Overview ?? '',
    posterTag: item.ImageTags?.['Primary'],
    backdropTag: item.BackdropImageTags?.[0],
    added,
    played: item.UserData?.Played ?? false,
    search: fold(`${item.Name} ${otherTitle} ${year} ${genres.join(' ')}`),
  }
}

/** What a query finds (every word, in any order, in the titles, year or genres), in order */
export function filterTitles<T extends { search: string }>(titles: T[], query: string): T[] {
  const ws = words(query)
  return ws.length ? titles.filter((t) => ws.every((w) => t.search.includes(w))) : titles
}

/** Newest in the library first */
export function byAdded(a: Title, b: Title): number {
  return b.added - a.added || compareNames(a.sortTitle, b.sortTitle)
}

/** Something to watch: a film or an episode */
interface Watchable {
  seconds: number
  /** Where it was stopped (seconds; 0 if it wasn't, or was watched to the end) */
  resume: number
  played: boolean
}

/** Stopped partway (Jellyfin keeps a place only past the first few percent): it resumes there */
export function resumable(w: Watchable): boolean {
  return w.resume > 0 && !w.played
}

/** The second to start it at: where it was stopped, else the beginning */
export function startAt(w: Watchable): number {
  return resumable(w) ? w.resume : 0
}

/** Seconds still to watch */
export function left(w: Watchable): number {
  return w.seconds - startAt(w)
}

/** How far into it it was stopped, 0 to 1 */
export function progress(w: Watchable): number {
  return w.seconds > 0 ? Math.min(1, startAt(w) / w.seconds) : 0
}

/** "1h 52m", "24m" */
export function runtime(seconds: number): string {
  const m = Math.round(seconds / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

/** "2010 · PG-13 · 2h 28m"; a series' without the length (the score is shown apart, in gold) */
export function facts(t: Title): string {
  const length = t.kind === 'movie' && t.seconds ? runtime(t.seconds) : ''
  return [t.year, t.rating, length].filter(Boolean).join(' · ')
}

/** "watched"; a series', "27 to watch" */
export function status(t: Title): string {
  if (t.played) return 'watched'
  return t.kind === 'show' && t.unwatched ? `${t.unwatched} to watch` : ''
}
