// TMDB, read with the server's token: for the page (through /api/tmdb/…) and
// for working out the Discover lists. Only the reading Discover needs is
// allowed (the token isn't an open proxy); each answer is kept in the
// database for as long as that kind of answer stays true; a few requests at a
// time, waiting out TMDB's rate limit when it's hit.

import type { Store } from './db.ts'

const API = 'https://api.themoviedb.org/3'
const HOUR = 3_600_000
const DAY = 24 * HOUR
/** Requests to TMDB at once */
const AT_ONCE = 16

/** What may be asked, and how long an answer is kept: lists change daily, who made a film doesn't */
const ALLOWED: [RegExp, number][] = [
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

/** How long an answer to `path` is kept; undefined if it may not be asked */
export function keptFor(path: string): number | undefined {
  return ALLOWED.find(([pattern]) => pattern.test(path))?.[1]
}

export type Query = Record<string, string | number | boolean | undefined>

/** A request as it's kept: the path, then the query sorted (so the same question finds the same answer) */
export function requestKey(path: string, query: Query = {}): string {
  const params = new URLSearchParams()
  for (const key of Object.keys(query).sort()) {
    const value = query[key]
    if (value !== undefined && key !== 'api_key') params.set(key, String(value))
  }
  const q = params.toString()
  return q ? `${path}?${q}` : path
}

export class TmdbError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export class Tmdb {
  private readonly token: string
  private readonly store: Store
  private readonly fetch: typeof fetch
  private running = 0
  private readonly waiting: (() => void)[] = []
  /** What's being asked now, so the same question isn't asked twice at once */
  private readonly asking = new Map<string, Promise<string>>()

  constructor(token: string, store: Store, fetcher: typeof fetch = fetch) {
    this.token = token
    this.store = store
    this.fetch = fetcher
  }

  /** TMDB's JSON for `path` (as text), from the database while it's fresh */
  async text(path: string, query: Query = {}): Promise<string> {
    const keep = keptFor(path)
    if (keep === undefined) throw new TmdbError(404, `Not something Discover asks TMDB: ${path}`)
    const request = requestKey(path, query)
    const kept = this.store.tmdb(request, Date.now() - keep)
    if (kept !== undefined) return kept
    let asking = this.asking.get(request)
    if (!asking) {
      asking = this.limited(() => this.ask(request)).then((body) => {
        this.store.keepTmdb(request, body)
        return body
      })
      this.asking.set(request, asking)
      void asking.finally(() => this.asking.delete(request)).catch(() => undefined)
    }
    return asking
  }

  async get<T>(path: string, query: Query = {}): Promise<T> {
    return JSON.parse(await this.text(path, query)) as T
  }

  /** One request to TMDB: waits out the rate limit (twice at most) */
  private async ask(request: string): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetch(API + request, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      })
      if (response.status === 429 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * Number(response.headers.get('Retry-After') ?? 1)))
        continue
      }
      const body = await response.text()
      if (!response.ok) throw new TmdbError(response.status, `TMDB said ${response.status} for ${request.split('?')[0]}`)
      return body
    }
  }

  private async limited<T>(work: () => Promise<T>): Promise<T> {
    while (this.running >= AT_ONCE) await new Promise<void>((r) => this.waiting.push(r))
    this.running++
    try {
      return await work()
    } finally {
      this.running--
      this.waiting.shift()?.()
    }
  }
}
