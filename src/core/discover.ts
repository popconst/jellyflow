// Discover: films and series beyond the library, from TMDB, as the server's
// API (server/) hands them to the page. What a suggestion is, and how TMDB's
// answers turn into one; shared by the server and the web app.

/** A film or a series on TMDB, as TMDB's API names them */
export type Kind = 'movie' | 'tv'

/**
 * What a suggestion or a wishlist entry is, whatever it comes from:
 * "tmdb:movie:603", "tmdb:tv:1399" (music's will be MusicBrainz's)
 */
export type Ref = string

export interface Suggestion {
  ref: Ref
  kind: Kind
  tmdbId: number
  title: string
  /** "2026"; "" when TMDB has no date for it */
  year: string
  /** When it comes out or came out, or (a series of yours) airs next: "2026-03-14" */
  date: string | undefined
  /** TMDB's score out of 10, once enough people have voted (MIN_VOTES) */
  score: number | undefined
  votes: number
  overview: string
  /** As TMDB (and Jellyfin) name them: "Drama", "Science Fiction" */
  genres: string[]
  /** TMDB's image paths ("/abc.jpg"), shown through the API (/api/img/…) */
  poster: string | undefined
  backdrop: string | undefined
  /** Why it's here: "Directed by Denis Villeneuve", "Next: S3E1" */
  why: string
  /** Its Jellyfin id, when it's in the library */
  owned?: string | undefined
  /** On the wishlist */
  wished?: boolean | undefined
}

/** One of Discover's rows */
export interface DiscoverList {
  /** The same across refreshes: "people", "because:tmdb:movie:603", "best:2025" */
  key: string
  name: string
  items: Suggestion[]
  /** When it was worked out (ms) */
  computed: number
}

/** With fewer votes than this, TMDB's score says little, so none is shown */
const MIN_VOTES = 50

/** The oldest year Discover goes back to, a year at a time */
export const FIRST_YEAR = 1900

/** A film or a series as TMDB's lists, details and credits give it (the fields used) */
export interface TmdbTitle {
  id: number
  media_type?: string
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
  vote_average?: number
  vote_count?: number
  overview?: string
  poster_path?: string | null
  backdrop_path?: string | null
  /** In TMDB's lists; its details have `genres` instead */
  genre_ids?: number[]
  genres?: { id: number; name: string }[]
  /** In a person's credits: the part played, or the job done */
  character?: string
  job?: string
  /** Billing, in a film's cast */
  order?: number
}

/** A page of one of TMDB's lists */
export interface TmdbPage {
  page: number
  total_pages: number
  total_results: number
  results: TmdbTitle[]
}

/** TMDB's genres of films and series, by id (its lists give only the ids; they don't change) */
const GENRES: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
  10759: 'Action & Adventure',
  10762: 'Kids',
  10763: 'News',
  10764: 'Reality',
  10765: 'Sci-Fi & Fantasy',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'War & Politics',
}

/** A film or a series, in TMDB's lists of everything (people too) */
export function kindOf(t: TmdbTitle): Kind | undefined {
  return t.media_type === 'movie' || t.media_type === 'tv' ? t.media_type : undefined
}

export function refOf(kind: Kind, id: number): Ref {
  return `tmdb:${kind}:${id}`
}

/** A ref's parts, if it's a TMDB one */
export function parseRef(ref: string): { kind: Kind; id: number } | undefined {
  const match = /^tmdb:(movie|tv):(\d+)$/.exec(ref)
  return match ? { kind: match[1] === 'tv' ? 'tv' : 'movie', id: Number(match[2]) } : undefined
}

/** A TMDB film or series as a suggestion, `why` it's suggested */
export function suggestion(t: TmdbTitle, kind: Kind, why: string): Suggestion {
  const date = (kind === 'movie' ? t.release_date : t.first_air_date) || undefined
  const votes = t.vote_count ?? 0
  return {
    ref: refOf(kind, t.id),
    kind,
    tmdbId: t.id,
    title: (kind === 'movie' ? t.title : t.name) ?? t.title ?? t.name ?? '',
    year: date?.slice(0, 4) ?? '',
    date,
    score: votes >= MIN_VOTES && t.vote_average ? Math.round(t.vote_average * 10) / 10 : undefined,
    votes,
    overview: t.overview ?? '',
    genres: t.genres?.map((g) => g.name) ?? (t.genre_ids ?? []).flatMap((id) => GENRES[id] ?? []),
    poster: t.poster_path ?? undefined,
    backdrop: t.backdrop_path ?? undefined,
    why,
  }
}

/** The best scored first; of the same score, the more voted for */
export function byScore(a: Suggestion, b: Suggestion): number {
  return (b.score ?? 0) - (a.score ?? 0) || b.votes - a.votes
}

/** Each title once (the first time it comes) */
export function uniqueByRef(items: Suggestion[]): Suggestion[] {
  const seen = new Set<Ref>()
  return items.filter((s) => !seen.has(s.ref) && Boolean(seen.add(s.ref)))
}
