// The API under /api, for the page. Everything but images is per Jellyfin
// user, who has to be logged in to jellyflow (the page sends its Jellyfin
// Authorization header along):
//
//   GET    /api/me                  who's asking; whether Discover's on (a TMDB token)
//   GET    /api/discover            their Discover lists (?refresh=1: worked out afresh)
//   GET    /api/wishlist            their wishlist, newest first
//   PUT    /api/wishlist/{ref}      on it ("tmdb:movie:603")
//   DELETE /api/wishlist/{ref}      off it
//   GET    /api/dismissed           what they're not interested in (refs), the latest first
//   PUT    /api/dismissed/{ref}     not interested (and so off the wishlist)
//   DELETE /api/dismissed/{ref}     interesting again
//   GET    /api/search?q=…          films and series on TMDB by title, marked as the lists are
//   GET    /api/tmdb/{path}?…       TMDB itself, for a title's or a person's page (what Discover reads only)
//   GET    /api/img/{size}/{file}   TMDB's images (kept on the server's disk once fetched)

import type { IncomingMessage, ServerResponse } from 'node:http'
import { kindOf, parseRef, suggestion, type DiscoverList, type Suggestion, type TmdbPage, type TmdbTitle } from '../src/core/discover.ts'
import { SessionExpired } from '../src/core/jellyfin.ts'
import type { Store } from './db.ts'
import { discover, SHOWN } from './discover.ts'
import type { Images } from './images.ts'
import { libraryOf, type Library } from './library.ts'
import { TmdbError, type Query, type Tmdb } from './tmdb.ts'
import type { User, Users } from './users.ts'

/** Lists older than this are worked out again when asked for */
const LISTS_FOR = 12 * 3_600_000
/** A user's library is read from Jellyfin again after this */
const LIBRARY_FOR = 5 * 60_000
/** The posters' sizes the rows ask for (Row.svelte's thumbs, through discover.svelte.ts): fetched ahead for the lists */
const POSTER_SIZES = ['w342', 'w500']

export interface ApiOptions {
  store: Store
  users: Users
  /** Undefined without a TMDB token: then there's no Discover */
  tmdb: Tmdb | undefined
  images: Images
}

class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export class Api {
  private readonly store: Store
  private readonly users: Users
  private readonly tmdb: Tmdb | undefined
  private readonly images: Images
  private readonly libraries = new Map<string, { library: Promise<Library>; until: number }>()
  /** Lists being worked out, by user: asked twice meanwhile, worked out once */
  private readonly working = new Map<string, Promise<DiscoverList[]>>()

  constructor(options: ApiOptions) {
    this.store = options.store
    this.users = options.users
    this.tmdb = options.tmdb
    this.images = options.images
  }

  /** Answers a request whose path starts /api/ */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const [route = '', ...rest] = url.pathname.slice('/api/'.length).split('/')
      if (route === 'img' && (req.method === 'GET' || req.method === 'HEAD')) return await this.image(res, rest, req.method === 'HEAD')
      const user = await this.users.who(req.headers.authorization)
      if (!user) throw new HttpError(401, 'Log in to jellyflow first')
      const ref = decodeURIComponent(rest.join('/'))
      switch (`${req.method} ${route}${rest.length ? '/' : ''}`) {
        case 'GET me':
          return json(res, 200, { id: user.id, name: user.name, discover: this.tmdb !== undefined })
        case 'GET discover':
          return json(res, 200, { lists: await this.discover(user, url.searchParams.has('refresh')) })
        case 'GET wishlist':
          return json(res, 200, { items: await this.wishlist(user) })
        case 'PUT wishlist/':
          return json(res, 200, { item: await this.wish(user, ref) })
        case 'DELETE wishlist/':
          if (!this.store.unwish(user.id, ref)) throw new HttpError(404, 'Not on the wishlist')
          return json(res, 204)
        case 'GET dismissed':
          return json(res, 200, { refs: this.store.dismissed(user.id) })
        case 'PUT dismissed/':
          if (!parseRef(ref)) throw new HttpError(400, `Not a film or series of TMDB's: ${ref}`)
          this.store.dismiss(user.id, ref)
          return json(res, 204)
        case 'DELETE dismissed/':
          if (!this.store.undismiss(user.id, ref)) throw new HttpError(404, 'Not marked not interested')
          return json(res, 204)
        case 'GET search':
          return json(res, 200, { items: await this.search(user, url.searchParams.get('q') ?? '') })
        case 'GET tmdb/':
          return await this.passThrough(res, `/${rest.join('/')}`, url.searchParams)
        default:
          throw new HttpError(404, `No ${req.method} /api/${route}`)
      }
    } catch (e) {
      const status = e instanceof HttpError ? e.status : e instanceof SessionExpired ? 401 : e instanceof TmdbError ? (e.status === 404 ? 404 : 502) : 500
      if (status === 500) console.error(e)
      json(res, status, { error: e instanceof Error ? e.message : String(e) })
    }
  }

  /** Asks TMDB now for what every user's lists are made of (the years' best), and their posters, so the first to open Discover doesn't wait */
  async preload(): Promise<void> {
    if (this.tmdb) this.warm(await discover(this.tmdb, { owned: new Map(), titles: [], recent: [] }, SHOWN))
  }

  /** The lists' posters, fetched ahead in the background: a fast scroll along a row finds them on the server */
  private warm(lists: DiscoverList[]): void {
    const posters = lists.flatMap((l) => l.items.flatMap((s) => s.poster ?? []))
    void this.images.warm(posters, POSTER_SIZES)
  }

  private tmdbOrFail(): Tmdb {
    if (!this.tmdb) throw new HttpError(503, 'Discover is off: the server has no TMDB token')
    return this.tmdb
  }

  /** What the user has, read again every few minutes */
  private library(user: User): Promise<Library> {
    const kept = this.libraries.get(user.id)
    if (kept && kept.until > Date.now()) return kept.library
    const library = libraryOf(user.jellyfin)
    this.libraries.set(user.id, { library, until: Date.now() + LIBRARY_FOR })
    library.catch(() => this.libraries.delete(user.id))
    return library
  }

  private async discover(user: User, refresh: boolean): Promise<DiscoverList[]> {
    const tmdb = this.tmdbOrFail()
    const made = SHOWN.join(',')
    let lists = this.store.lists(user.id, made)
    const stale = !lists.length || lists.some((l) => l.computed < Date.now() - LISTS_FOR)
    if (refresh || stale) {
      let working = this.working.get(user.id)
      if (!working) {
        working = this.library(user).then((library) => discover(tmdb, library, SHOWN))
        this.working.set(user.id, working)
        void working.finally(() => this.working.delete(user.id)).catch(() => undefined)
      }
      lists = await working
      this.store.keepLists(user.id, made, lists)
      this.warm(lists)
    }
    const marked = await this.marker(user)
    return lists.map((l) => ({ ...l, items: l.items.map(marked) }))
  }

  /** Marks what's in the library, and what's on the wishlist */
  private async marker(user: User): Promise<(s: Suggestion) => Suggestion> {
    const library = await this.library(user)
    const wished = new Set(this.store.wishlist(user.id).map((w) => w.item.ref))
    return (s) => ({ ...s, owned: library.owned.get(s.ref), wished: wished.has(s.ref) })
  }

  private async wishlist(user: User): Promise<(Suggestion & { added: number })[]> {
    const marked = await this.marker(user)
    return this.store.wishlist(user.id).map((w) => ({ ...marked(w.item), added: w.added }))
  }

  /** Films and series on TMDB by title, as TMDB orders them (people left out) */
  private async search(user: User, query: string): Promise<Suggestion[]> {
    const q = query.trim()
    if (!q) return []
    const page = await this.tmdbOrFail().get<TmdbPage>('/search/multi', { query: q, include_adult: false })
    const marked = await this.marker(user)
    return page.results.flatMap((t) => {
      const kind = kindOf(t)
      return kind ? [marked(suggestion(t, kind, ''))] : []
    })
  }

  /** Puts a film or a series on the wishlist, as TMDB has it now */
  private async wish(user: User, ref: string): Promise<Suggestion> {
    const parsed = parseRef(ref)
    if (!parsed) throw new HttpError(400, `Not a film or series of TMDB's: ${ref}`)
    const title = await this.tmdbOrFail().get<TmdbTitle>(`/${parsed.kind}/${parsed.id}`)
    const item = suggestion(title, parsed.kind, '')
    this.store.wish(user.id, item)
    return (await this.marker(user))(item)
  }

  private async passThrough(res: ServerResponse, path: string, params: URLSearchParams): Promise<void> {
    const query: Query = Object.fromEntries(params)
    const body = await this.tmdbOrFail().text(path, query)
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(body)
  }

  /** One of TMDB's images, whole: they never change, so the browser keeps them too */
  private async image(res: ServerResponse, [size = '', file = '', ...more]: string[], headOnly = false): Promise<void> {
    const image = more.length ? undefined : await this.images.get(size, file)
    if (!image) throw new HttpError(404, 'No such image')
    res.writeHead(200, {
      'Content-Type': image.type,
      'Content-Length': image.body.length,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(headOnly ? undefined : image.body)
  }
}

function json(res: ServerResponse, status: number, body?: unknown): void {
  res.writeHead(status, {
    ...(body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
    'Cache-Control': 'no-store',
  })
  res.end(body === undefined ? undefined : JSON.stringify(body))
}
