// The Discover lists, worked out for a user from their library and TMDB: new
// and coming from the people they watch, because they watched …, what's next
// for their series, the years' best series and films, what's in cinemas and
// coming soon, and what's trending. Discover shows the years' best for now
// (SHOWN): this year's and the three before at first, older years one at a
// time as they're asked for; the rest are there to be turned on. A list that
// can't be worked out (TMDB down) is left out.

import {
  byScore,
  kindOf,
  suggestion,
  uniqueByRef,
  type DiscoverList,
  type Kind,
  type Suggestion,
  type TmdbPage,
  type TmdbTitle,
} from '../src/core/discover.ts'
import type { Allowed, Query } from '../src/lib/tmdb/index.ts'
import type { Library, Owned } from './library.ts'

/** What's needed of TMDB: the Tmdb class's get */
export interface TmdbReader {
  get<T>(path: string, query?: Query): Promise<T>
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

/**
 * What jellyflow reads of TMDB, for the lists and for a title's page
 * (through /api/tmdb), and how long each answer is kept: lists change
 * daily, who made a film doesn't. Nothing else may be asked of the
 * server's token
 */
export const READS: Allowed[] = [
  [/^\/(movie|tv|person)\/\d+$/, DAY],
  [/^\/movie\/\d+\/credits$/, 30 * DAY],
  [/^\/tv\/\d+\/aggregate_credits$/, 7 * DAY],
  [/^\/(movie|tv)\/\d+\/(recommendations|similar|videos|watch\/providers|external_ids)$/, DAY],
  [/^\/person\/\d+\/(combined_credits|movie_credits|tv_credits|external_ids)$/, DAY],
  [/^\/discover\/(movie|tv)$/, 6 * HOUR],
  [/^\/trending\/(all|movie|tv|person)\/(day|week)$/, 6 * HOUR],
  [/^\/movie\/(now_playing|upcoming|popular|top_rated)$/, 6 * HOUR],
  [/^\/tv\/(on_the_air|airing_today|popular|top_rated)$/, 6 * HOUR],
  [/^\/search\/(multi|movie|tv|person)$/, HOUR],
  [/^\/genre\/(movie|tv)\/list$/, 7 * DAY],
]
/** The year's best: at least this score, from at least this many votes */
const BEST = { score: 7.2, votes: 200 }
/** The year's best series: this many seasons out at least, this score, from this many votes */
const SERIES = { seasons: 3, score: 7.5, votes: 200 }
/** TMDB's genres for news, reality, soaps and talk shows: not series to watch through */
const NOT_SERIES = '10763,10764,10766,10767'
/** "New" goes back this far */
const NEW_FOR = 120 * DAY
/** The people whose new work is followed: the most watched this many */
const PEOPLE = 20
/** "Because you watched": for this many of the latest */
const BECAUSE = 3
/** A list's length at most */
const LONGEST = 100
/** TMDB's lists come this many to a page */
const PAGE = 20
/** Series looked at for a year's best, the most voted for first: few have the seasons, or were last on that year, so many more than LONGEST */
const SERIES_LOOKED = 500

interface MovieCredits {
  cast: { id: number; name: string; order: number }[]
  crew: { id: number; name: string; job: string }[]
}

interface TvCredits {
  cast: { id: number; name: string; order: number }[]
}

interface PersonCredits {
  cast: TmdbTitle[]
  crew: TmdbTitle[]
}

interface Episode {
  air_date: string | null
  season_number: number
  episode_number: number
}

interface TvDetails extends TmdbTitle {
  status: string
  number_of_seasons?: number
  last_air_date?: string | null
  next_episode_to_air: Episode | null
  last_episode_to_air: Episode | null
}

export interface Person {
  id: number
  name: string
  /** How much of what's in the library (and more, of what was watched) they made */
  weight: number
  /** Directed most of it, or acted */
  directs: boolean
}

/**
 * Who made the library, weighed: a film's director most, then its leads,
 * then the rest of the top billing; a series' leads. Twice as much for what
 * was watched
 */
export function peopleOf(credits: { title: Owned; movie?: MovieCredits; tv?: TvCredits }[]): Person[] {
  const people = new Map<number, Person & { directed: number }>()
  const add = (id: number, name: string, weight: number, directed: boolean) => {
    const p = people.get(id) ?? { id, name, weight: 0, directs: false, directed: 0 }
    p.weight += weight
    p.directed += directed ? weight : 0
    people.set(id, p)
  }
  for (const { title, movie, tv } of credits) {
    const times = title.played ? 2 : 1
    for (const c of movie?.crew ?? []) if (c.job === 'Director') add(c.id, c.name, 3 * times, true)
    for (const c of movie?.cast ?? []) if (c.order < 8) add(c.id, c.name, (c.order < 3 ? 2 : 1) * times, false)
    for (const c of tv?.cast ?? []) if (c.order < 4) add(c.id, c.name, times, false)
  }
  return [...people.values()]
    .map(({ directed, ...p }) => ({ ...p, directs: directed * 2 > p.weight }))
    .filter((p) => p.weight >= 2)
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))
}

/** Playing themselves (talk shows, documentaries about them) isn't new work of theirs */
const SELF = /\b(self|himself|herself|themselves|host|narrator)\b/i
/** TMDB's genres for documentaries, news, reality and talk shows: an actor in one isn't acting */
const NOT_ACTING = new Set([99, 10763, 10764, 10767])

/** A person's films and series out lately or coming, as directed or as acted in (a part, not as themselves) */
export function newWorkOf(credits: PersonCredits, since: string): { title: TmdbTitle; kind: Kind; role: 'directed' | 'with' }[] {
  const out: { title: TmdbTitle; kind: Kind; role: 'directed' | 'with' }[] = []
  const recent = (t: TmdbTitle, kind: Kind) => (kind === 'movie' ? t.release_date : t.first_air_date) ?? ''
  for (const t of credits.crew) {
    const kind = kindOf(t)
    if (kind && t.job === 'Director' && recent(t, kind) >= since) out.push({ title: t, kind, role: 'directed' })
  }
  for (const t of credits.cast) {
    const kind = kindOf(t)
    if (!kind || recent(t, kind) < since || SELF.test(t.character ?? '')) continue
    if (t.genre_ids?.some((g) => NOT_ACTING.has(g))) continue
    if (kind === 'movie' && t.order !== undefined && t.order >= 10) continue
    out.push({ title: t, kind, role: 'with' })
  }
  return out
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function byDate(a: Suggestion, b: Suggestion): number {
  return (a.date ?? '9999').localeCompare(b.date ?? '9999')
}

/** New and coming from the people the library is most made by */
async function fromPeople(tmdb: TmdbReader, library: Library, today: Date): Promise<Suggestion[]> {
  const credits = await Promise.all(
    library.titles.map(async (title) =>
      title.kind === 'movie'
        ? { title, movie: await tmdb.get<MovieCredits>(`/movie/${title.tmdbId}/credits`) }
        : { title, tv: await tmdb.get<TvCredits>(`/tv/${title.tmdbId}/aggregate_credits`) },
    ),
  )
  const people = peopleOf(credits).slice(0, PEOPLE)
  const since = day(new Date(today.getTime() - NEW_FOR))
  const found = new Map<string, { s: Suggestion; directed: string[]; with: string[] }>()
  await Promise.all(
    people.map(async (person) => {
      const work = newWorkOf(await tmdb.get<PersonCredits>(`/person/${person.id}/combined_credits`), since)
      for (const { title, kind, role } of work) {
        const s = suggestion(title, kind, '')
        if (library.owned.has(s.ref) || !s.date) continue
        const entry = found.get(s.ref) ?? { s, directed: [], with: [] }
        const names = role === 'directed' ? entry.directed : entry.with
        if (!names.includes(person.name)) names.push(person.name)
        found.set(s.ref, entry)
      }
    }),
  )
  return [...found.values()]
    .map(({ s, directed, with: cast }) => ({
      ...s,
      why: [directed.length ? `Directed by ${directed.join(', ')}` : '', cast.length ? `With ${cast.slice(0, 3).join(', ')}` : '']
        .filter(Boolean)
        .join(' · '),
    }))
    .sort(byDate)
    .slice(0, LONGEST)
}

/** TMDB's recommendations for something watched, without what's in the library */
async function because(tmdb: TmdbReader, library: Library, watched: Owned): Promise<Suggestion[]> {
  const page = await tmdb.get<TmdbPage>(`/${watched.kind}/${watched.tmdbId}/recommendations`)
  return page.results
    .map((t) => suggestion(t, watched.kind, `Because you watched ${watched.title}`))
    .filter((s) => !library.owned.has(s.ref))
}

/** The library's series still running: the next episode's date, or the latest one's if it's just out */
async function nextForShows(tmdb: TmdbReader, library: Library, today: Date): Promise<Suggestion[]> {
  const since = day(new Date(today.getTime() - 30 * DAY))
  const shows = await Promise.all(
    library.titles.filter((t) => t.kind === 'tv').map((t) => tmdb.get<TvDetails>(`/tv/${t.tmdbId}`)),
  )
  const code = (e: Episode) => `S${e.season_number}E${e.episode_number}`
  return shows
    .flatMap((show) => {
      const next = show.next_episode_to_air
      const last = show.last_episode_to_air
      if (next?.air_date) return [{ ...suggestion(show, 'tv', `Next: ${code(next)}`), date: next.air_date }]
      if (last?.air_date && last.air_date >= since) return [{ ...suggestion(show, 'tv', `New: ${code(last)}`), date: last.air_date }]
      return []
    })
    .sort(byDate)
}

/** What TMDB's discover (`path`) finds for `query`, up to `most`: the first page, then as many more as there are and are needed */
async function discoverUpTo(tmdb: TmdbReader, path: string, query: Query, most: number): Promise<TmdbTitle[]> {
  const ask = (page: number) => tmdb.get<TmdbPage>(path, { ...query, include_adult: false, page })
  const first = await ask(1)
  const last = Math.min(first.total_pages, Math.ceil(most / PAGE))
  const rest = await Promise.all(Array.from({ length: Math.max(0, last - 1) }, (_, i) => ask(i + 2)))
  return [first, ...rest].flatMap((p) => p.results).slice(0, most)
}

/** The films TMDB's discover finds for `query`, the most popular first, up to `most` */
async function discoverMovies(tmdb: TmdbReader, query: Query, most = 40): Promise<Suggestion[]> {
  const films = await discoverUpTo(tmdb, '/discover/movie', { ...query, sort_by: 'popularity.desc' }, most)
  return films.map((t) => suggestion(t, 'movie', ''))
}

/** How a series came to an end, by its TMDB status */
const ENDING: Record<string, string> = { Ended: 'ended', Canceled: 'cancelled' }

/**
 * A year's best-scored series with SERIES.seasons or more out, in the year
 * they were last on: the year they ended, or (still running) their latest
 * season's; so each is in one year only. Of the most voted for that were on
 * that year: TMDB's lists don't say how many seasons, or when a series was
 * last on, so each one's details are read
 */
async function bestSeries(tmdb: TmdbReader, year: number): Promise<Suggestion[]> {
  const found = await discoverUpTo(
    tmdb,
    '/discover/tv',
    {
      'air_date.gte': `${year}-01-01`,
      'air_date.lte': `${year}-12-31`,
      'vote_average.gte': SERIES.score,
      'vote_count.gte': SERIES.votes,
      without_genres: NOT_SERIES,
      sort_by: 'vote_count.desc',
    },
    SERIES_LOOKED,
  )
  const ids = new Set(found.map((t) => t.id))
  const shows = await Promise.all([...ids].map((id) => tmdb.get<TvDetails>(`/tv/${id}`)))
  return shows
    .flatMap((s) => {
      // out so far: TMDB counts one that's only announced too
      const seasons = s.last_episode_to_air?.season_number ?? s.number_of_seasons ?? 0
      if (seasons < SERIES.seasons || !s.last_air_date?.startsWith(String(year))) return []
      const ending = ENDING[s.status]
      return [suggestion(s, 'tv', ending ? `${seasons} seasons, ${ending} ${year}` : `${seasons} seasons so far`)]
    })
    .sort(byScore)
}

/** A year's best-scored films (with enough votes): of the most popular, the best scored first */
async function best(tmdb: TmdbReader, year: number): Promise<Suggestion[]> {
  const films = await discoverMovies(tmdb, { primary_release_year: year, 'vote_average.gte': BEST.score, 'vote_count.gte': BEST.votes }, LONGEST)
  return films.sort(byScore)
}

/** The most awaited films out in the next half year, soonest first */
async function comingSoon(tmdb: TmdbReader, today: Date): Promise<Suggestion[]> {
  const from = day(today)
  const films = await discoverMovies(tmdb, {
    'primary_release_date.gte': from,
    'primary_release_date.lte': day(new Date(today.getTime() + 182 * DAY)),
  })
  return films.filter((s) => (s.date ?? '') >= from).sort(byDate)
}

async function inCinemas(tmdb: TmdbReader): Promise<Suggestion[]> {
  return (await tmdb.get<TmdbPage>('/movie/now_playing')).results.map((t) => suggestion(t, 'movie', ''))
}

async function trending(tmdb: TmdbReader): Promise<Suggestion[]> {
  const page = await tmdb.get<TmdbPage>('/trending/all/week')
  return page.results.flatMap((t) => {
    const kind = kindOf(t)
    return kind ? [suggestion(t, kind, '')] : []
  })
}

/** Discover's kinds of list */
export type ListKind = 'people' | 'because' | 'shows' | 'series' | 'best' | 'cinema' | 'upcoming' | 'trending'
/** Every kind, in Discover's order */
export const ALL: ListKind[] = ['people', 'because', 'shows', 'series', 'best', 'cinema', 'upcoming', 'trending']
/** What Discover shows for now: the best series and films of the last few years */
export const SHOWN: ListKind[] = ['series', 'best']
/** Discover's years at first: this one and the three before it (older ones are asked for one at a time) */
const LATEST_YEARS = 4

/** This year and the ones before it that Discover starts with, the latest first */
export function latestYears(today = new Date()): number[] {
  return Array.from({ length: LATEST_YEARS }, (_, i) => today.getFullYear() - i)
}

export interface DiscoverOptions {
  today?: Date
  /** The years' best of (the series and best lists): `latestYears` */
  years?: number[]
}

/** A user's lists of the `kinds` asked for, in Discover's order; those that are empty or failed left out */
export async function discover(
  tmdb: TmdbReader,
  library: Library,
  kinds: ListKind[] = SHOWN,
  { today = new Date(), years = latestYears(today) }: DiscoverOptions = {},
): Promise<DiscoverList[]> {
  const lists: Record<ListKind, () => [string, string, Promise<Suggestion[]>][]> = {
    people: () => [['people', 'New and coming from people you watch', fromPeople(tmdb, library, today)]],
    because: () =>
      library.recent
        .slice(0, BECAUSE)
        .map((w) => [`because:${w.kind}:${w.tmdbId}`, `Because you watched ${w.title}`, because(tmdb, library, w)]),
    shows: () => [['shows', 'Your series: what’s next', nextForShows(tmdb, library, today)]],
    series: () => years.map((y) => [`series:${y}`, `Best series of ${y}`, bestSeries(tmdb, y)]),
    best: () => years.map((y) => [`best:${y}`, `Best films of ${y}`, best(tmdb, y)]),
    cinema: () => [['cinema', 'In cinemas', inCinemas(tmdb)]],
    upcoming: () => [['upcoming', 'Coming soon', comingSoon(tmdb, today)]],
    trending: () => [['trending', 'Trending this week', trending(tmdb)]],
  }
  const wanted = ALL.filter((kind) => kinds.includes(kind)).flatMap((kind) => lists[kind]())
  const computed = Date.now()
  const settled = await Promise.allSettled(wanted.map(([, , items]) => items))
  return wanted.flatMap(([key, name], i) => {
    const result = settled[i]
    if (result?.status !== 'fulfilled') {
      console.error(`discover: ${key}: ${result?.reason instanceof Error ? result.reason.message : String(result?.reason)}`)
      return []
    }
    const items = uniqueByRef(result.value).slice(0, LONGEST)
    return items.length ? [{ key, name, items, computed }] : []
  })
}
