// The web app's state: the login, the library's albums and track titles,
// each album's tracks (fetched once), the film and series libraries (their
// titles are videos.svelte.ts'), the status line, and a live connection to
// Jellyfin that reads them again when the library changes.

import { Jellyfin, login, SessionExpired, type Device, type Item, type Session } from '../core/jellyfin.ts'
import { albumsFrom, TrackTitles, type Album } from '../core/library.ts'

/** Watch (films and series), or Listen: Cover Flow or Folders */
export type View = 'watch' | 'flow' | 'folders'
export type Section = 'watch' | 'listen'

export function stored<T>(key: string): T | undefined {
  try {
    const value = localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : undefined
  } catch {
    return undefined
  }
}

export function store(key: string, value: unknown): void {
  try {
    if (value === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // private window: nothing is remembered, everything still works
  }
}

function device(): Device {
  const id = stored<string>('jellyflow.device') ?? crypto.randomUUID()
  store('jellyflow.device', id)
  return { id, name: 'jellyflow web' }
}

/** After a library change, how long it has to stay quiet before the albums are read again */
const SETTLE_MS = 1000

/** A fetch done once and kept (dropped if it fails, to be tried again) */
export function cached<T>(kept: Map<string, Promise<T>>, key: string, fetch: () => Promise<T>): Promise<T> {
  let promise = kept.get(key)
  if (!promise) {
    promise = fetch()
    promise.catch(() => kept.delete(key))
    kept.set(key, promise)
  }
  return promise
}

/** Jellyfin's live events the views hear: the library changed (once a burst has settled), items watched (their ids) */
interface Events {
  library: []
  watched: [ids: string[]]
}

class App {
  readonly device = device()
  session = $state<Session | undefined>(stored('jellyflow.session'))
  client = $derived(this.session ? new Jellyfin(this.session, this.device) : undefined)
  view = $state<View>(initialView())
  /** Where Listen goes back to */
  listenView = $state<'flow' | 'folders'>(stored('jellyflow.listen') ?? 'flow')
  section = $derived<Section>(this.view === 'watch' ? 'watch' : 'listen')
  help = $state(false)
  /** A page open beside the middle cover, by view: an album's in Cover Flow, a title's in Watch */
  pageOpen = $state({ flow: false, watch: false })
  /** A page open and nothing done for a while: the header and the player bar are away, the views' lines faded */
  quiet = $state(false)

  /** The music library (it may be missing), and the film and series ones */
  library = $state.raw<Item | undefined>()
  videoLibraries = $state.raw<Item[]>([])
  albums = $state.raw<Album[]>([])
  titles = new TrackTitles()
  /** Bumped as track titles come in, so searches by track see them */
  titlesVersion = $state(0)
  /** Bumped each time the library has been read again after a change */
  reloaded = $state(0)
  /** What's loading, for the corner; empty when done */
  loading = $state('')
  status = $state('')

  private tracks = new Map<string, Promise<Item[]>>()
  private items = new Map<string, Promise<Item>>()
  private socket: WebSocket | undefined
  private statusTimer: ReturnType<typeof setTimeout> | undefined
  private handlers: { [E in keyof Events]: ((...args: Events[E]) => void)[] } = { library: [], watched: [] }

  /** Hears one of Jellyfin's live events */
  on<E extends keyof Events>(event: E, handler: (...args: Events[E]) => void): void {
    this.handlers[event].push(handler)
  }

  /** The sections there are: Watch with a film or series library, Listen with a music one */
  get sections(): Section[] {
    const out: Section[] = []
    if (this.videoLibraries.length) out.push('watch')
    if (this.library || !this.videoLibraries.length) out.push('listen')
    return out
  }

  setView(view: View): void {
    this.view = view
    store('jellyflow.view', view)
    if (view !== 'watch') {
      this.listenView = view
      store('jellyflow.listen', view)
    }
  }

  /** Watch, or Listen where it was left */
  setSection(section: Section): void {
    this.setView(section === 'watch' ? 'watch' : this.listenView)
  }

  async login(server: string, user: string, password: string): Promise<void> {
    const session = await login(server, user, password, this.device)
    store('jellyflow.server', session.server)
    store('jellyflow.session', session)
    this.session = session
    await this.load()
  }

  /** Forgets the login and everything read with it (another user may log in next) */
  logout(): void {
    this.client?.logout().catch(() => undefined)
    store('jellyflow.session', undefined)
    this.session = undefined
    this.socket?.close()
    this.library = undefined
    this.videoLibraries = []
    this.albums = []
    this.titles = new TrackTitles()
    this.titlesVersion++
    this.tracks.clear()
    this.items.clear()
  }

  /** The albums first (the row can show), then every track title, a page at a time (for searching by track) */
  async load(): Promise<void> {
    const client = this.client
    if (!client) return
    try {
      this.loading = 'albums'
      const views = await client.libraries()
      const library = views.find((v) => v.CollectionType === 'music')
      this.videoLibraries = views.filter((v) => v.CollectionType === 'movies' || v.CollectionType === 'tvshows')
      if (!library) {
        this.loading = ''
        if (!this.videoLibraries.length) throw new Error('This Jellyfin has no music, film or series library')
        if (this.view !== 'watch') this.setView('watch')
        this.listen()
        return
      }
      if (!this.videoLibraries.length && this.view === 'watch') this.setView(this.listenView)
      this.library = library
      this.albums = albumsFrom(await client.albums(library.Id))
      this.loading = 'track titles'
      // the first time, searches see titles as they come; a reload swaps them in when done
      const titles = new TrackTitles()
      if (this.titles.titles.size === 0) this.titles = titles
      for await (const page of client.tracks(library.Id)) {
        titles.add(page)
        this.titlesVersion++
      }
      this.titles = titles
      this.titlesVersion++
      this.loading = ''
      this.listen()
    } catch (e) {
      this.loading = ''
      this.fail(e)
    }
  }

  /** The library changed: read it again; the views keep their place by album id */
  private async reload(): Promise<void> {
    this.tracks.clear()
    this.items.clear()
    await this.load()
    this.reloaded++
  }

  /** An album's tracks in order, with formats and credits; fetched once */
  albumTracks(albumId: string): Promise<Item[]> {
    return cached(this.tracks, albumId, () => this.client?.albumTracks(albumId) ?? Promise.resolve([]))
  }

  /** An album or a film with everything Jellyfin knows about it (overview, links, its streams); fetched once */
  item(id: string): Promise<Item> {
    return cached(this.items, id, () => this.client?.item(id) ?? Promise.reject(new Error('Not logged in')))
  }

  /** Forgets an item read before (a film just watched: where it was stopped has changed) */
  forget(id: string): void {
    this.items.delete(id)
  }

  /** A message in the status line, gone after a few seconds */
  say(message: string): void {
    this.status = message
    clearTimeout(this.statusTimer)
    this.statusTimer = setTimeout(() => (this.status = ''), 4000)
  }

  fail(e: unknown): void {
    if (e instanceof SessionExpired) {
      this.logout()
      return
    }
    this.say(`Error: ${e instanceof Error ? e.message : String(e)}`)
  }

  /**
   * Jellyfin's live events: LibraryChanged reloads (once a burst has settled),
   * UserDataChanged tells what was watched; reconnects if dropped
   */
  private listen(): void {
    const client = this.client
    if (!client || this.socket) return
    const socket = new WebSocket(client.socketUrl())
    let settle: ReturnType<typeof setTimeout> | undefined
    let keepAlive: ReturnType<typeof setInterval> | undefined
    socket.onmessage = (event) => {
      let message: { MessageType?: string; Data?: unknown }
      try {
        message = JSON.parse(String(event.data)) as typeof message
      } catch {
        return
      }
      if (message.MessageType === 'LibraryChanged') {
        clearTimeout(settle)
        settle = setTimeout(() => {
          void this.reload()
          for (const handler of this.handlers.library) handler()
        }, SETTLE_MS)
      } else if (message.MessageType === 'UserDataChanged') {
        const list = (message.Data as { UserDataList?: { ItemId?: string }[] } | undefined)?.UserDataList ?? []
        const ids = list.map((d) => d.ItemId).filter((id): id is string => Boolean(id))
        for (const handler of this.handlers.watched) handler(ids)
      } else if (message.MessageType === 'ForceKeepAlive' && typeof message.Data === 'number') {
        clearInterval(keepAlive)
        keepAlive = setInterval(() => socket.send(JSON.stringify({ MessageType: 'KeepAlive' })), message.Data * 500)
      }
    }
    socket.onclose = () => {
      clearInterval(keepAlive)
      this.socket = undefined
      if (this.session) setTimeout(() => this.listen(), 5000)
    }
    this.socket = socket
  }
}

/** Where the app opens: where it was left */
function initialView(): View {
  const view = stored<View>('jellyflow.view')
  return view === 'watch' || view === 'folders' ? view : 'flow'
}

export const app = new App()

/** The server the login screen starts with: the last one used, else the configured one */
export const defaultServer: string = stored<string>('jellyflow.server') ?? import.meta.env['VITE_JELLYFIN_URL'] ?? ''

/** Keys typed into a text field are the field's */
export function typing(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null
  return target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'
}
