// The web app's state: the login, the library's albums and track titles,
// each album's tracks (fetched once), the status line, and a live connection
// to Jellyfin that reloads the albums when the library changes.

import { Jellyfin, login, SessionExpired, type Device, type Item, type Session } from '../core/jellyfin.ts'
import { albumsFrom, TrackTitles, type Album } from '../core/library.ts'

export type View = 'flow' | 'folders'

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

class App {
  readonly device = device()
  session = $state<Session | undefined>(stored('jellyflow.session'))
  client = $derived(this.session ? new Jellyfin(this.session, this.device) : undefined)
  view = $state<View>(stored('jellyflow.view') ?? 'flow')
  help = $state(false)

  library = $state.raw<Item | undefined>()
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

  setView(view: View): void {
    this.view = view
    store('jellyflow.view', view)
  }

  async login(server: string, user: string, password: string): Promise<void> {
    const session = await login(server, user, password, this.device)
    store('jellyflow.server', session.server)
    store('jellyflow.session', session)
    this.session = session
    await this.load()
  }

  logout(): void {
    this.client?.logout().catch(() => undefined)
    store('jellyflow.session', undefined)
    this.session = undefined
    this.socket?.close()
    this.library = undefined
    this.albums = []
    this.tracks.clear()
  }

  /** The albums first (the row can show), then every track title, a page at a time (for searching by track) */
  async load(): Promise<void> {
    const client = this.client
    if (!client) return
    try {
      this.loading = 'albums'
      const [library] = await client.musicLibraries()
      if (!library) throw new Error('This Jellyfin has no music library')
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
    let tracks = this.tracks.get(albumId)
    if (!tracks) {
      tracks = this.client?.albumTracks(albumId) ?? Promise.resolve([])
      tracks.catch(() => this.tracks.delete(albumId))
      this.tracks.set(albumId, tracks)
    }
    return tracks
  }

  /** An album with everything Jellyfin knows about it (overview, links); fetched once */
  albumItem(albumId: string): Promise<Item> {
    let item = this.items.get(albumId)
    if (!item) {
      item = this.client?.item(albumId) ?? Promise.reject(new Error('Not logged in'))
      item.catch(() => this.items.delete(albumId))
      this.items.set(albumId, item)
    }
    return item
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

  /** Jellyfin's live events: LibraryChanged reloads (once a burst has settled); reconnects if dropped */
  private listen(): void {
    const client = this.client
    if (!client || this.socket) return
    const socket = new WebSocket(client.socketUrl())
    let settle: ReturnType<typeof setTimeout> | undefined
    let keepAlive: ReturnType<typeof setInterval> | undefined
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { MessageType: string; Data?: unknown }
      if (message.MessageType === 'LibraryChanged') {
        clearTimeout(settle)
        settle = setTimeout(() => void this.reload(), SETTLE_MS)
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

export const app = new App()

/** The server the login screen starts with: the last one used, else the configured one */
export const defaultServer: string = stored<string>('jellyflow.server') ?? import.meta.env['VITE_JELLYFIN_URL'] ?? ''

/** Keys typed into a text field are the field's */
export function typing(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null
  return target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'
}
