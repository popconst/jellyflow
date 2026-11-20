// A tiny Jellyfin client: only what browsing and playing a music library
// needs. Plain fetch and URLs, so it runs in the browser and in Node alike.

export const CLIENT = 'jellyflow'
/** The app's version, as Jellyfin lists it under Devices: package.json's (a test keeps them in step) */
export const VERSION = '0.1.0'

/** Who's logged in where; saved by the app between runs */
export interface Session {
  server: string
  token: string
  userId: string
  userName: string
}

/** This copy of the app, as Jellyfin lists it under Devices */
export interface Device {
  id: string
  name: string
}

export interface NameId {
  Name: string
  Id: string
}

export interface MediaStream {
  Type?: string
  Codec?: string
  BitDepth?: number
  SampleRate?: number
  Channels?: number
  BitRate?: number
}

export interface MediaSource {
  Container?: string
  Path?: string
  MediaStreams?: MediaStream[]
}

/** The fields of Jellyfin's BaseItemDto this app reads */
export interface Item {
  Id: string
  Name: string
  Type: string
  IsFolder?: boolean
  CollectionType?: string
  Path?: string
  ParentId?: string
  Album?: string
  AlbumId?: string
  AlbumArtist?: string
  AlbumArtists?: NameId[]
  Artists?: string[]
  ProductionYear?: number
  IndexNumber?: number
  ParentIndexNumber?: number
  RunTimeTicks?: number
  ImageTags?: Record<string, string>
  AlbumPrimaryImageTag?: string
  Genres?: string[]
  Studios?: NameId[]
  ProviderIds?: Record<string, string>
  People?: { Name: string; Type?: string; Role?: string }[]
  MediaSources?: MediaSource[]
  Overview?: string
  ExternalUrls?: { Name: string; Url: string }[]
}

interface Page {
  Items: Item[]
  TotalRecordCount: number
}

type Params = Record<string, string | number | boolean | undefined>

/** Jellyfin's Authorization header: the app, the device and, once logged in, the token */
export function authorization(device: Device, token?: string): string {
  const quote = (s: string) => `"${s.replaceAll('"', "'")}"`
  const parts = [
    `Client=${quote(CLIENT)}`,
    `Device=${quote(device.name)}`,
    `DeviceId=${quote(device.id)}`,
    `Version=${quote(VERSION)}`,
  ]
  if (token) parts.push(`Token=${quote(token)}`)
  return `MediaBrowser ${parts.join(', ')}`
}

/** "jelly.example.com" or "https://jelly.example.com/" → "https://jelly.example.com" */
export function normalizeServer(server: string): string {
  const s = server.trim().replace(/\/+$/, '')
  return /^https?:\/\//.test(s) ? s : `https://${s}`
}

export async function login(server: string, username: string, password: string, device: Device): Promise<Session> {
  server = normalizeServer(server)
  const response = await fetch(`${server}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authorization(device) },
    body: JSON.stringify({ Username: username, Pw: password }),
  })
  if (response.status === 401) throw new Error('Wrong user name or password')
  if (!response.ok) throw new Error(`Jellyfin said ${response.status} ${response.statusText}`)
  const result = (await response.json()) as { AccessToken: string; User: { Id: string; Name: string } }
  return { server, token: result.AccessToken, userId: result.User.Id, userName: result.User.Name }
}

/** Ask for as little as possible: no user data, at most the front cover */
const LEAN: Params = { enableUserData: false, imageTypeLimit: 1, enableImageTypes: 'Primary' }

export class Jellyfin {
  readonly session: Session
  readonly device: Device

  constructor(session: Session, device: Device) {
    this.session = session
    this.device = device
  }

  url(path: string, params: Params = {}): string {
    const url = new URL(this.session.server + path)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  async get<T>(path: string, params: Params = {}): Promise<T> {
    const response = await fetch(this.url(path, params), {
      headers: { Authorization: authorization(this.device, this.session.token) },
    })
    if (response.status === 401) throw new SessionExpired()
    if (!response.ok) throw new Error(`Jellyfin said ${response.status} ${response.statusText} for ${path}`)
    return (await response.json()) as T
  }

  async items(params: Params): Promise<Item[]> {
    const page = await this.get<Page>('/Items', { userId: this.session.userId, ...LEAN, ...params })
    return page.Items
  }

  /** The user's music libraries */
  async musicLibraries(): Promise<Item[]> {
    const page = await this.get<Page>('/UserViews', { userId: this.session.userId })
    return page.Items.filter((v) => v.CollectionType === 'music')
  }

  /** Every album in a library, with what the row and its search need */
  albums(libraryId: string): Promise<Item[]> {
    return this.items({
      parentId: libraryId,
      recursive: true,
      includeItemTypes: 'MusicAlbum',
      fields: 'Path,Genres,Studios,ProviderIds',
    })
  }

  /** Every track in a library, `size` at a time, titles and albums only: for searching by track */
  async *tracks(libraryId: string, size = 5000): AsyncGenerator<Item[]> {
    for (let start = 0; ; start += size) {
      const page = await this.get<Page>('/Items', {
        userId: this.session.userId,
        parentId: libraryId,
        recursive: true,
        includeItemTypes: 'Audio',
        enableUserData: false,
        enableImages: false,
        startIndex: start,
        limit: size,
      })
      yield page.Items
      if (page.Items.length < size || start + size >= page.TotalRecordCount) return
    }
  }

  /** An album's tracks in order, with their files' formats and credits */
  async albumTracks(albumId: string): Promise<Item[]> {
    const tracks = await this.items({
      parentId: albumId,
      recursive: true,
      includeItemTypes: 'Audio',
      fields: 'MediaSources,People,Path',
    })
    return tracks.sort(byDiscAndNumber)
  }

  /** Every track under a folder, in folder order (by path) */
  async tracksUnder(folderId: string): Promise<Item[]> {
    const tracks = await this.items({ parentId: folderId, recursive: true, includeItemTypes: 'Audio', fields: 'Path' })
    return tracks.sort((a, b) => compareNames(a.Path ?? a.Name, b.Path ?? b.Name))
  }

  /** What's in a folder, as on disk: folders first by name, then tracks in order */
  async children(parentId: string): Promise<Item[]> {
    const items = await this.items({ parentId, fields: 'Path,MediaSources' })
    return items.sort((a, b) => {
      if (Boolean(a.IsFolder) !== Boolean(b.IsFolder)) return a.IsFolder ? -1 : 1
      return a.IsFolder ? compareNames(folderName(a), folderName(b)) : byDiscAndNumber(a, b)
    })
  }

  /** One item with everything Jellyfin knows about it: overview, links, … */
  item(id: string): Promise<Item> {
    return this.get<Item>(`/Items/${id}`, { userId: this.session.userId })
  }

  /** An item's folders, from its parent up to the top */
  ancestors(id: string): Promise<Item[]> {
    return this.get<Item[]>(`/Items/${id}/Ancestors`, { userId: this.session.userId })
  }

  /** A front cover, fitted to `size` pixels square. Jellyfin serves images without a token */
  imageUrl(id: string, tag: string, size: number): string {
    return this.url(`/Items/${id}/Images/Primary`, { tag, fillWidth: size, fillHeight: size, quality: 90 })
  }

  /** The track's file as it is (FLAC, MP3, …): every browser plays those */
  streamUrl(trackId: string): string {
    return this.url(`/Audio/${trackId}/stream`, { static: true, deviceId: this.device.id })
  }

  /** Jellyfin's live events: LibraryChanged and the like. The token both ways: newer servers read ApiKey, older api_key */
  socketUrl(): string {
    const url = new URL(this.url('/socket', { ApiKey: this.session.token, api_key: this.session.token, deviceId: this.device.id }))
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url.toString()
  }

  logout(): Promise<Response> {
    return fetch(this.url('/Sessions/Logout'), {
      method: 'POST',
      headers: { Authorization: authorization(this.device, this.session.token) },
    })
  }
}

/** The token was refused: log in again */
export class SessionExpired extends Error {
  constructor() {
    super('Jellyfin wants you to log in again')
  }
}

/** A folder's name on disk ("1983 - Kill ’Em All"), else Jellyfin's name for it */
export function folderName(item: Item): string {
  const path = item.Path?.replace(/[/\\]+$/, '')
  return path ? (path.split(/[/\\]/).pop() ?? item.Name) : item.Name
}

/** Natural, case-insensitive: "Disc 2" before "Disc 10" */
export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

export function byDiscAndNumber(a: Item, b: Item): number {
  return (
    (a.ParentIndexNumber ?? 1) - (b.ParentIndexNumber ?? 1) ||
    (a.IndexNumber ?? 0) - (b.IndexNumber ?? 0) ||
    compareNames(a.Path ?? a.Name, b.Path ?? b.Name)
  )
}

/** Jellyfin's ticks are 100 ns */
export function seconds(ticks: number | undefined): number {
  return ticks ? ticks / 10_000_000 : 0
}
