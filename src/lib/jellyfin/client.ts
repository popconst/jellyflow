// A small Jellyfin client: logging in, the libraries and their items, the
// images, how to play an item on this device and where it's at, the app's
// own settings, live events. Plain fetch and URLs, so it runs in the browser
// and in Node alike.

import { byDiscAndNumber, compareNames, folderName } from './items.ts'
import type { Device, DeviceProfile, Item, Playing, PlaybackInfo, Preferences, Session } from './types.ts'

/** A page of Jellyfin's items */
interface Page {
  Items: Item[]
  TotalRecordCount: number
}

/** A request's query: those undefined are left out */
export type Params = Record<string, string | number | boolean | undefined>

/** Jellyfin's Authorization header: the app, the device and, once logged in, the token */
export function authorization(device: Device, token?: string): string {
  const quote = (s: string) => `"${s.replaceAll('"', "'")}"`
  const parts = [
    `Client=${quote(device.client)}`,
    `Device=${quote(device.name)}`,
    `DeviceId=${quote(device.id)}`,
    `Version=${quote(device.version)}`,
  ]
  if (token) parts.push(`Token=${quote(token)}`)
  return `MediaBrowser ${parts.join(', ')}`
}

/** "jelly.example.com" or "https://jelly.example.com/" → "https://jelly.example.com" */
function normalizeServer(server: string): string {
  const s = server.trim().replace(/\/+$/, '')
  return /^https?:\/\//.test(s) ? s : `https://${s}`
}

/** Logs in to the Jellyfin at `server` ("jelly.example.com" will do): the session to make a client with, and to keep */
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

/** Jellyfin, as the user logged in on this device */
export class Jellyfin {
  readonly session: Session
  readonly device: Device

  constructor(session: Session, device: Device) {
    this.session = session
    this.device = device
  }

  /** A URL on the server, with `params` as its query */
  url(path: string, params: Params = {}): string {
    const url = new URL(this.session.server + path)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  /** A GET's answer, parsed */
  async get<T>(path: string, params: Params = {}): Promise<T> {
    return (await this.request('GET', path, params)).json() as Promise<T>
  }

  /** A POST of `body` (as JSON): its answer, parsed (none for a 204) */
  async post<T>(path: string, body: unknown, params: Params = {}): Promise<T> {
    const response = await this.request('POST', path, params, body)
    return (response.status === 204 ? undefined : await response.json()) as T
  }

  /**
   * Any request, with the token. `keepalive` lets it finish after the page
   * has gone (a last report as the tab closes)
   */
  async request(method: string, path: string, params: Params = {}, body?: unknown, keepalive = false): Promise<Response> {
    const headers: Record<string, string> = { Authorization: authorization(this.device, this.session.token) }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await fetch(this.url(path, params), {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      keepalive,
    })
    if (response.status === 401) throw new SessionExpired()
    if (!response.ok) throw new Error(`Jellyfin said ${response.status} ${response.statusText} for ${path}`)
    return response
  }

  /** A URL Jellyfin gave as a path on itself (a stream's, a subtitle file's) */
  resolve(path: string): string {
    return this.session.server + path
  }

  /** The user's items that `params` ask for (Jellyfin's /Items), as little of each as will do unless asked for more */
  async items(params: Params): Promise<Item[]> {
    const page = await this.get<Page>('/Items', { userId: this.session.userId, ...LEAN, ...params })
    return page.Items
  }

  /** The user's libraries: music, films, shows, … (CollectionType says which) */
  async libraries(): Promise<Item[]> {
    const page = await this.get<Page>('/UserViews', { userId: this.session.userId })
    return page.Items
  }

  /** Every film in a library, with what a row of posters, a film's page and resuming need (where it was stopped) */
  movies(libraryId: string): Promise<Item[]> {
    return this.items({
      parentId: libraryId,
      recursive: true,
      includeItemTypes: 'Movie',
      fields: 'Overview,Genres,SortName,OriginalTitle,Taglines,DateCreated',
      enableUserData: true,
      imageTypeLimit: 1,
      enableImageTypes: 'Primary,Backdrop',
    })
  }

  /** Every series in a library (shows, courses), with what a row of posters and a series' page need */
  series(libraryId: string): Promise<Item[]> {
    return this.items({
      parentId: libraryId,
      recursive: true,
      includeItemTypes: 'Series',
      fields: 'Overview,Genres,SortName,DateCreated,DateLastMediaAdded',
      enableUserData: true,
      imageTypeLimit: 1,
      enableImageTypes: 'Primary,Backdrop',
    })
  }

  /** A series' episodes, every season, with where each was stopped and when it was last watched */
  async episodes(seriesId: string): Promise<Item[]> {
    const page = await this.get<Page>(`/Shows/${seriesId}/Episodes`, {
      userId: this.session.userId,
      fields: 'Overview',
      isMissing: false,
      enableUserData: true,
      imageTypeLimit: 1,
      enableImageTypes: 'Primary',
    })
    return page.Items
  }

  /**
   * The series being watched: those with an episode stopped partway, and
   * those Jellyfin has a next episode for (one was watched to the end lately)
   */
  async seriesInProgress(): Promise<string[]> {
    const lean = { userId: this.session.userId, limit: 200, enableImages: false, enableUserData: false, enableTotalRecordCount: false }
    const [resumed, next] = await Promise.all([
      this.get<Page>('/UserItems/Resume', { ...lean, includeItemTypes: 'Episode', mediaTypes: 'Video' }),
      this.get<Page>('/Shows/NextUp', { ...lean, enableResumable: false, enableRewatching: false }),
    ])
    return [...new Set([...resumed.Items, ...next.Items].map((e) => e.SeriesId).filter((id): id is string => Boolean(id)))]
  }

  /**
   * The app's settings for the user, kept by Jellyfin under its name (so
   * every browser the user logs in from has them): its CustomPrefs, strings
   * by name
   */
  async preferences(): Promise<Preferences> {
    const client = this.device.client
    return this.get<Preferences>(`/DisplayPreferences/${client}`, { userId: this.session.userId, client })
  }

  /** Saves them: what `preferences` gave, changed */
  async savePreferences(preferences: Preferences): Promise<void> {
    const client = this.device.client
    await this.post(`/DisplayPreferences/${client}`, preferences, { userId: this.session.userId, client })
  }

  /** Every album in a library, with its folder, genres, labels and MusicBrainz id */
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

  /** An item's picture, filling `width` × `height` pixels. Jellyfin serves images without a token */
  private image(id: string, type: string, tag: string, width: number, height: number, quality: number, blur?: number): string {
    return this.url(`/Items/${id}/Images/${type}`, { tag, fillWidth: width, fillHeight: Math.round(height), quality, blur })
  }

  /** A front cover, `size` pixels square */
  imageUrl(id: string, tag: string, size: number): string {
    return this.image(id, 'Primary', tag, size, size, 90)
  }

  /** A poster (2:3): a film's, a series', a person's photo */
  posterUrl(id: string, tag: string, width: number): string {
    return this.image(id, 'Primary', tag, width, width * 1.5, 90)
  }

  /** An episode's still (16:9) */
  stillUrl(id: string, tag: string, width: number): string {
    return this.image(id, 'Primary', tag, width, (width * 9) / 16, 85)
  }

  /** A title's backdrop (a still from it, 16:9); blurred by Jellyfin if asked (cheaper than in the browser) */
  backdropUrl(id: string, tag: string, width: number, blur?: number): string {
    return this.image(id, 'Backdrop/0', tag, width, (width * 9) / 16, 85, blur)
  }

  /**
   * How to play an item on this device: Jellyfin compares the file with
   * `profile` and answers with a stream (the file as it is, or repackaged,
   * converting only what the device can't play) and a session to report to
   */
  playbackInfo(
    itemId: string,
    profile: DeviceProfile,
    choice: { mediaSourceId?: string | undefined; audio?: number | undefined; subtitles?: number | undefined } = {},
  ): Promise<PlaybackInfo> {
    return this.post<PlaybackInfo>(`/Items/${itemId}/PlaybackInfo`, {
      UserId: this.session.userId,
      DeviceProfile: profile,
      MaxStreamingBitrate: profile.MaxStreamingBitrate,
      MediaSourceId: choice.mediaSourceId,
      AudioStreamIndex: choice.audio,
      // -1: none
      SubtitleStreamIndex: choice.subtitles ?? -1,
      EnableDirectPlay: true,
      EnableDirectStream: true,
      EnableTranscoding: true,
      AllowVideoStreamCopy: true,
      AllowAudioStreamCopy: true,
      AutoOpenLiveStream: true,
    })
  }

  /** A film's or a track's file as it is, for a browser that plays it (nothing converted or repackaged) */
  fileUrl(media: 'Videos' | 'Audio', itemId: string, mediaSourceId: string | undefined): string {
    return this.url(`/${media}/${itemId}/stream`, { static: true, mediaSourceId, deviceId: this.device.id })
  }

  /** Text subtitles as WebVTT: from where PlaybackInfo said (`deliveryUrl`), else the stream's usual place */
  async subtitles(itemId: string, mediaSourceId: string | undefined, index: number, deliveryUrl?: string): Promise<string> {
    const path = deliveryUrl ?? `/Videos/${itemId}/${mediaSourceId}/Subtitles/${index}/0/Stream.vtt`
    return (await this.request('GET', path.replace(/^https?:\/\/[^/]+/, ''))).text()
  }

  /** Ends a stream Jellyfin is packaging for this device, once it's no longer wanted */
  async endStream(playSessionId: string): Promise<void> {
    await this.request('DELETE', '/Videos/ActiveEncodings', { deviceId: this.device.id, playSessionId })
  }

  /** Tells Jellyfin playing started, is going on, or stopped: it keeps where it's at for resuming, anywhere */
  async report(event: 'start' | 'progress' | 'stopped', playing: Playing, keepalive = false): Promise<void> {
    const path = { start: '/Sessions/Playing', progress: '/Sessions/Playing/Progress', stopped: '/Sessions/Playing/Stopped' }[event]
    await this.request('POST', path, {}, playing, keepalive)
  }

  /** Jellyfin's live events: LibraryChanged and the like. The token both ways: newer servers read ApiKey, older api_key */
  socketUrl(): string {
    const url = new URL(this.url('/socket', { ApiKey: this.session.token, api_key: this.session.token, deviceId: this.device.id }))
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url.toString()
  }

  /** Ends the session on the server: its token stops working */
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
