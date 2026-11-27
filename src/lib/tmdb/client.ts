// TMDB's API, read with a token (a server's, which the browser never sees):
// only what's allowed is asked, so the server can pass its page's requests
// through without being an open proxy; each answer is kept in a cache for as
// long as that kind of answer stays true; the same question is asked once
// however many ask it at once; a few requests at a time, waiting out TMDB's
// rate limit when it's hit.

const API = 'https://api.themoviedb.org/3'
/** Requests to TMDB at once */
const AT_ONCE = 16

/** A kind of request that may be made (its path), and how long its answer is kept (ms) */
export type Allowed = [path: RegExp, keep: number]

/** How long an answer to `path` is kept; undefined if it may not be asked */
export function keptFor(allowed: Allowed[], path: string): number | undefined {
  return allowed.find(([pattern]) => pattern.test(path))?.[1]
}

/** Where TMDB's answers are kept between runs (a database; a Map will do) */
export interface TmdbCache {
  /** The answer kept for `request`, if it was fetched after `since` (ms) */
  tmdb(request: string, since: number): string | undefined
  /** Keeps `body` as the answer to `request`, fetched now */
  keepTmdb(request: string, body: string): void
}

export interface TmdbOptions {
  /** TMDB's API read access token (TMDB account → Settings → API) */
  token: string
  cache: TmdbCache
  /** What may be asked, and how long each kind of answer is kept: anything else is refused (TmdbError 404) */
  allowed: Allowed[]
  /** A fetch of its own (tests') */
  fetcher?: typeof fetch
}

/** A request's query: those undefined are left out */
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

/** TMDB said no (its status), or what was asked isn't allowed (404) */
export class TmdbError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** TMDB's API, through the cache */
export class Tmdb {
  private readonly token: string
  private readonly cache: TmdbCache
  private readonly allowed: Allowed[]
  private readonly fetch: typeof fetch
  private running = 0
  private readonly waiting: (() => void)[] = []
  /** What's being asked now, so the same question isn't asked twice at once */
  private readonly asking = new Map<string, Promise<string>>()

  constructor({ token, cache, allowed, fetcher = fetch }: TmdbOptions) {
    this.token = token
    this.cache = cache
    this.allowed = allowed
    this.fetch = fetcher
  }

  /** TMDB's JSON for `path` (as text), from the cache while it's fresh */
  async text(path: string, query: Query = {}): Promise<string> {
    const keep = keptFor(this.allowed, path)
    if (keep === undefined) throw new TmdbError(404, `Not something Discover asks TMDB: ${path}`)
    const request = requestKey(path, query)
    const kept = this.cache.tmdb(request, Date.now() - keep)
    if (kept !== undefined) return kept
    let asking = this.asking.get(request)
    if (!asking) {
      asking = this.limited(() => this.ask(request)).then((body) => {
        this.cache.keepTmdb(request, body)
        return body
      })
      this.asking.set(request, asking)
      void asking.finally(() => this.asking.delete(request)).catch(() => undefined)
    }
    return asking
  }

  /** TMDB's answer to `path`, parsed */
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

  /** `work`, once fewer than AT_ONCE are running */
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
