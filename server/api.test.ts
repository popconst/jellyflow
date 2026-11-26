import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import type { DiscoverList, Suggestion } from '../src/core/discover.ts'
import { Api } from './api.ts'
import { Store } from './db.ts'
import { AUTH, fakeJellyfin, fakeTmdb, type FakeJellyfin, type FakeTmdb } from './fakes.ts'
import { Images } from './images.ts'
import { Tmdb } from './tmdb.ts'
import { Users } from './users.ts'

let jellyfin: FakeJellyfin
let tmdb: FakeTmdb
let server: Server
let base: string
let withoutTmdb: Server
let baseWithout: string
const imageDir = mkdtempSync(join(tmpdir(), 'jellyflow-images-'))

async function serve(api: Api): Promise<[Server, string]> {
  const s = createServer((req, res) => void api.handle(req, res))
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve))
  return [s, `http://127.0.0.1:${(s.address() as AddressInfo).port}`]
}

before(async () => {
  jellyfin = await fakeJellyfin()
  tmdb = fakeTmdb()
  const store = new Store(':memory:')
  const images = new Images(imageDir, tmdb.fetcher)
  ;[server, base] = await serve(new Api({ store, users: new Users(jellyfin.url), tmdb: new Tmdb('token', store, tmdb.fetcher), images }))
  ;[withoutTmdb, baseWithout] = await serve(
    new Api({ store: new Store(':memory:'), users: new Users(jellyfin.url), tmdb: undefined, images }),
  )
})

after(async () => {
  server.close()
  withoutTmdb.close()
  await jellyfin.close()
  rmSync(imageDir, { recursive: true, force: true })
})

/** A request to the API; `auth` null: not logged in */
function call(path: string, method = 'GET', auth: string | null = AUTH, at = base): Promise<Response> {
  return fetch(at + path, { method, headers: auth === null ? {} : { Authorization: auth } })
}

const wishRef = (id: number) => `/api/wishlist/${encodeURIComponent(`tmdb:movie:${id}`)}`

test('nothing without a jellyflow login', async () => {
  for (const path of ['/api/me', '/api/discover', '/api/wishlist', '/api/tmdb/movie/603']) {
    const response = await call(path, 'GET', null)
    assert.equal(response.status, 401, path)
    assert.deepEqual(await response.json(), { error: 'Log in to jellyflow first' })
  }
  assert.equal((await call('/api/me', 'GET', AUTH.replace('good-token', 'stolen'))).status, 401)
})

test('me: who, and whether Discover is on', async () => {
  assert.deepEqual(await (await call('/api/me')).json(), { id: 'user-1', name: 'tester', discover: true })
  assert.deepEqual(await (await call('/api/me', 'GET', AUTH, baseWithout)).json(), { id: 'user-1', name: 'tester', discover: false })
  assert.equal((await call('/api/discover', 'GET', AUTH, baseWithout)).status, 503)
})

test('the wishlist: on, newest first, marked; off', async () => {
  const added = await call(wishRef(603), 'PUT')
  assert.equal(added.status, 200)
  const { item } = (await added.json()) as { item: Suggestion }
  assert.equal(item.title, 'The Matrix')
  assert.equal(item.wished, true)
  await call(wishRef(800), 'PUT')
  const { items } = (await (await call('/api/wishlist')).json()) as { items: (Suggestion & { added: number })[] }
  assert.deepEqual(
    items.map((s) => [s.title, s.wished, typeof s.added]),
    [
      ['Blade Runner 2049', true, 'number'],
      ['The Matrix', true, 'number'],
    ],
  )
  assert.equal((await call(wishRef(603), 'DELETE')).status, 204)
  assert.equal((await call(wishRef(603), 'DELETE')).status, 404)
  assert.equal((await call('/api/wishlist/tmdb%3Aperson%3A1', 'PUT')).status, 400)
})

test('discover: the lists, marking what the library has and what is wished for; kept, not worked out again', async () => {
  const response = await call('/api/discover')
  assert.equal(response.status, 200)
  const { lists } = (await response.json()) as { lists: DiscoverList[] }
  const year = new Date().getFullYear()
  assert.deepEqual(
    lists.map((l) => l.key),
    [`series:${year}`, `series:${year - 1}`, ...[0, 1, 2, 3].map((i) => `best:${year - i}`)],
  )
  const best = lists.find((l) => l.key === `best:${year}`)?.items ?? []
  assert.deepEqual(
    best.map((s) => s.title),
    ['One Battle After Another', 'Sinners', 'Weapons'],
    'the best scored first; of the same score, the more voted for',
  )
  const sinners = best[1]
  assert.equal(sinners?.owned, undefined)
  assert.equal(sinners?.wished, false)
  const asked = tmdb.calls.length
  const again = (await (await call('/api/discover')).json()) as { lists: DiscoverList[] }
  assert.deepEqual(
    again.lists.map((l) => l.computed),
    lists.map((l) => l.computed),
  )
  assert.equal(tmdb.calls.length, asked)
})

test('not interested: on, listed, off; off the wishlist too', async () => {
  const ref = (id: number) => `/api/dismissed/${encodeURIComponent(`tmdb:movie:${id}`)}`
  await call(wishRef(800), 'PUT')
  assert.equal((await call(ref(800), 'PUT')).status, 204)
  assert.equal((await call(ref(801), 'PUT')).status, 204)
  const { refs } = (await (await call('/api/dismissed')).json()) as { refs: string[] }
  assert.deepEqual(new Set(refs), new Set(['tmdb:movie:800', 'tmdb:movie:801']))
  const { items } = (await (await call('/api/wishlist')).json()) as { items: Suggestion[] }
  assert.ok(!items.some((s) => s.ref === 'tmdb:movie:800'), 'off the wishlist')
  assert.equal((await call(ref(800), 'DELETE')).status, 204)
  assert.equal((await call(ref(801), 'DELETE')).status, 204)
  assert.equal((await call(ref(801), 'DELETE')).status, 404)
  assert.equal((await call('/api/dismissed/tmdb%3Aperson%3A1', 'PUT')).status, 400)
  assert.equal((await call('/api/dismissed', 'GET', null)).status, 401)
})

test("search: TMDB's films and series by title, marking what the library has; people left out", async () => {
  const { items } = (await (await call('/api/search?q=%20dune%20')).json()) as { items: Suggestion[] }
  assert.deepEqual(
    items.map((s) => [s.title, s.kind, s.owned]),
    [
      ['Dune', 'movie', 'j-dune'],
      ['Dune: Prophecy', 'tv', undefined],
    ],
  )
  const nothing = (await (await call('/api/search?q=')).json()) as { items: Suggestion[] }
  assert.deepEqual(nothing.items, [])
  assert.equal((await call('/api/search?q=dune', 'GET', null)).status, 401)
})

test('TMDB through the API: what Discover reads, and nothing else', async () => {
  const film = await call('/api/tmdb/movie/603?language=en-US')
  assert.equal(film.status, 200)
  assert.equal(((await film.json()) as { title: string }).title, 'The Matrix')
  assert.equal((await call('/api/tmdb/account')).status, 404)
  assert.equal((await call('/api/tmdb/movie/603/rating', 'GET')).status, 404)
})

test("TMDB's images: anyone's, kept by the browser; only real sizes and file names", async () => {
  const image = await call('/api/img/w342/poster.jpg', 'GET', null)
  assert.equal(image.status, 200)
  assert.equal(image.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.equal(image.headers.get('content-length'), '3', 'whole, not streamed in')
  assert.deepEqual([...new Uint8Array(await image.arrayBuffer())], [1, 2, 3])
  const head = await call('/api/img/w342/poster.jpg', 'HEAD', null)
  assert.equal(head.status, 200)
  assert.equal(head.headers.get('content-type'), 'image/jpeg')
  for (const path of ['/api/img/w9999/poster.jpg', '/api/img/w342/..%2Fx.jpg', '/api/img/w342/a/b.jpg', '/api/img/w342/gone.jpg']) {
    assert.equal((await call(path, 'GET', null)).status, 404, path)
  }
})

test('anything else: 404', async () => {
  assert.equal((await call('/api/nope')).status, 404)
  assert.equal((await call('/api/discover', 'POST')).status, 404)
})
