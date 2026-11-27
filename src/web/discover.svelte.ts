// Discover: films and series beyond the library, from jellyflow's own server
// (/api, server/api.ts), asked as the user logged in to jellyflow. Whether
// the server has it (a TMDB token); its lists, read when Discover is first
// opened, the latest years' and then, as they're asked for, older years one
// at a time; which kind is shown, films or series; and the wishlist, which w
// adds to and takes from at once, the server told after.

import { untrack } from 'svelte'
import { FIRST_YEAR, type DiscoverList, type Kind, type Suggestion } from '../core/discover.ts'
import { authorization } from '../lib/jellyfin/index.ts'
import { app, store, stored } from './state.svelte.ts'

/** TMDB's image widths, smallest first */
const WIDTHS = [92, 154, 185, 342, 500, 780]
/** Films or series, kept across reloads */
const KIND = 'jellyflow.discoverKind'

/** A suggestion in a row: by its ref, which is unique in a row */
export type Pick = Suggestion & { id: string }

export function pick(s: Suggestion): Pick {
  return { ...s, id: s.ref }
}

class Discover {
  /** The server has Discover */
  on = $state(false)
  lists = $state.raw<DiscoverList[]>([])
  wishlist = $state.raw<Suggestion[]>([])
  loading = $state(false)
  read = $state(false)
  /** Films or series: what Discover shows */
  kind = $state<Kind>(stored<Kind>(KIND) === 'tv' ? 'tv' : 'movie')
  /** The oldest year the lists are of; the year being asked for now (one at a time) */
  oldest = $state<number | undefined>()
  finding = $state<number | undefined>()

  /** The refs on the wishlist */
  wished = $derived(new Set(this.wishlist.map((s) => s.ref)))
  /** The refs not of interest (left out of the lists) */
  dismissed = $state.raw<ReadonlySet<string>>(new Set())

  /** One of the API's answers, asked with the login the page has */
  private async call<T>(path: string, method = 'GET'): Promise<T> {
    const client = app.client
    if (!client) throw new Error('Not logged in')
    const response = await fetch(`/api/${path}`, { method, headers: { Authorization: authorization(client.device, client.session.token) } })
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `jellyflow's server said ${response.status}`)
    }
    return (response.status === 204 ? undefined : await response.json()) as T
  }

  /** Whether the server has Discover: asked once logged in (no server, as with `npm run dev` alone: no) */
  async check(): Promise<void> {
    try {
      this.on = (await this.call<{ discover: boolean }>('me')).discover
    } catch {
      this.on = false
    }
    app.hasDiscover = this.on
    // opened at Discover last time, and it's gone
    if (!this.on && app.view === 'discover') app.setSection(app.sections[0] ?? 'listen')
  }

  /** The lists and the wishlist, once (or `again`) */
  async load(again = false): Promise<void> {
    if (!this.on || (!again && (this.loading || this.read))) return
    this.loading = true
    try {
      const [{ lists, oldest }, { items }, { refs }] = await Promise.all([
        this.call<{ lists: DiscoverList[]; oldest: number }>('discover'),
        this.call<{ items: Suggestion[] }>('wishlist'),
        this.call<{ refs: string[] }>('dismissed'),
      ])
      this.lists = lists
      this.oldest = oldest
      this.wishlist = items
      this.dismissed = new Set(refs)
      this.read = true
    } catch (e) {
      app.fail(e)
    } finally {
      this.loading = false
    }
  }

  setKind(kind: Kind): void {
    this.kind = kind
    store(KIND, kind)
  }

  /**
   * The year before the oldest one's lists, after the rest, both kinds at
   * once (so the other has it too): that year and its lists, once they're
   * in. One year at a time: asked again meanwhile, or with none older,
   * nothing is asked
   */
  async more(): Promise<{ year: number; lists: DiscoverList[] } | undefined> {
    const year = this.oldest === undefined ? undefined : this.oldest - 1
    if (!this.read || this.finding !== undefined || year === undefined || year < FIRST_YEAR) return undefined
    this.finding = year
    try {
      const { lists, oldest } = await this.call<{ lists: DiscoverList[]; oldest: number }>(`discover?year=${year}`)
      // logged out, or read afresh, meanwhile
      if (this.finding !== year || this.oldest !== year + 1) return undefined
      this.lists = [...this.lists, ...lists]
      this.oldest = oldest
      return { year, lists }
    } catch (e) {
      app.fail(e)
      return undefined
    } finally {
      if (this.finding === year) this.finding = undefined
    }
  }

  /** On the wishlist (and so of interest again), or off it: here at once, then on the server (put back if that fails) */
  async toggle(s: Suggestion): Promise<void> {
    const [wishlist, dismissed] = [this.wishlist, this.dismissed]
    const on = !this.wished.has(s.ref)
    this.wishlist = on ? [{ ...s, wished: true }, ...wishlist] : wishlist.filter((w) => w.ref !== s.ref)
    if (on) this.dismissed = without(dismissed, s.ref)
    try {
      await this.call(`wishlist/${encodeURIComponent(s.ref)}`, on ? 'PUT' : 'DELETE')
    } catch (e) {
      this.wishlist = wishlist
      this.dismissed = dismissed
      app.fail(e)
    }
  }

  /** Not interested: left out of the lists, and off the wishlist; here at once, then on the server */
  async dismiss(s: Suggestion): Promise<void> {
    const [wishlist, dismissed] = [this.wishlist, this.dismissed]
    this.wishlist = wishlist.filter((w) => w.ref !== s.ref)
    this.dismissed = new Set([...dismissed, s.ref])
    try {
      await this.call(`dismissed/${encodeURIComponent(s.ref)}`, 'PUT')
    } catch (e) {
      this.wishlist = wishlist
      this.dismissed = dismissed
      app.fail(e)
    }
  }

  /** Of interest again; back on the wishlist, if it was on it (wished for, it's of interest anyway) */
  async undismiss(s: Suggestion, wished: boolean): Promise<void> {
    if (wished) return this.toggle(s)
    const dismissed = this.dismissed
    this.dismissed = without(dismissed, s.ref)
    try {
      await this.call(`dismissed/${encodeURIComponent(s.ref)}`, 'DELETE')
    } catch (e) {
      this.dismissed = dismissed
      app.fail(e)
    }
  }

  /** Films and series on TMDB by title, marked as the lists are */
  async search(query: string): Promise<Suggestion[]> {
    return (await this.call<{ items: Suggestion[] }>(`search?q=${encodeURIComponent(query)}`)).items
  }

  /** TMDB itself, through the server: a title's details (`/movie/603?append_to_response=credits`) */
  tmdb<T>(path: string): Promise<T> {
    return this.call<T>(`tmdb${path}`)
  }

  /** A backdrop, small: shown dimmed and stretched behind the rows and on a page, it might as well be blurred */
  backdrop(path: string | undefined): string | undefined {
    return path ? `/api/img/w300${path}` : undefined
  }

  /** One of TMDB's images ("/abc.jpg"), through the server, at least `px` wide */
  image(path: string | undefined, px: number): string | undefined {
    if (!path) return undefined
    const width = WIDTHS.find((w) => w >= px) ?? 'original'
    return `/api/img/${typeof width === 'number' ? `w${width}` : width}${path}`
  }

  clear(): void {
    this.on = false
    app.hasDiscover = false
    this.lists = []
    this.wishlist = []
    this.dismissed = new Set()
    this.oldest = undefined
    this.finding = undefined
    this.read = false
    this.loading = false
  }
}

function without(set: ReadonlySet<string>, ref: string): ReadonlySet<string> {
  return new Set([...set].filter((r) => r !== ref))
}

export const discover = new Discover()

// logged in: whether the server has Discover; logged out: it's forgotten (another user may log in next)
$effect.root(() => {
  $effect(() => {
    const session = app.session
    untrack(() => {
      discover.clear()
      if (session) void discover.check()
    })
  })
})
