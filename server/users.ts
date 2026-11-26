// Who's asking: the page sends the Authorization header it sends Jellyfin
// (its device and its token), and Jellyfin says whose token it is. Known
// users are remembered a few minutes; then Jellyfin is asked again, so a
// logged-out token stops working soon after.

import { Jellyfin, SessionExpired, type Device } from '../src/core/jellyfin.ts'

/** How long Jellyfin's word on a token holds (ms) */
const TRUSTED_FOR = 10 * 60_000

export interface User {
  id: string
  name: string
  /** Jellyfin as this user, the way the page talks to it */
  jellyfin: Jellyfin
}

/** The device and token in a Jellyfin Authorization header ("MediaBrowser Client=…, Token=…") */
export function credentials(header: string | undefined): { device: Device; token: string } | undefined {
  if (!header?.startsWith('MediaBrowser ')) return undefined
  const fields = new Map([...header.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1] ?? '', m[2] ?? '']))
  const token = fields.get('Token')
  if (!token) return undefined
  return { token, device: { id: fields.get('DeviceId') ?? 'jellyflow-server', name: fields.get('Device') ?? 'jellyflow server' } }
}

export class Users {
  private readonly server: string
  private readonly known = new Map<string, { user: User; until: number }>()

  /** For the Jellyfin at `server` ("http://127.0.0.1:8096") */
  constructor(server: string) {
    this.server = server
  }

  /** Whose header this is; undefined if it's no logged-in user's */
  async who(header: string | undefined): Promise<User | undefined> {
    const found = credentials(header)
    if (!found) return undefined
    const known = this.known.get(found.token)
    if (known && known.until > Date.now()) return known.user
    const asking = new Jellyfin({ server: this.server, token: found.token, userId: '', userName: '' }, found.device)
    let me: { Id: string; Name: string }
    try {
      me = await asking.get<{ Id: string; Name: string }>('/Users/Me')
    } catch (e) {
      if (e instanceof SessionExpired) {
        this.known.delete(found.token)
        return undefined
      }
      throw e
    }
    const user: User = {
      id: me.Id,
      name: me.Name,
      jellyfin: new Jellyfin({ server: this.server, token: found.token, userId: me.Id, userName: me.Name }, found.device),
    }
    if (this.known.size > 100) this.known.clear()
    this.known.set(found.token, { user, until: Date.now() + TRUSTED_FOR })
    return user
  }
}
