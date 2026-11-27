import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keptFor, requestKey, Tmdb, TmdbError, type Allowed, type TmdbCache } from './client.ts'

const HOUR = 3_600_000
const ALLOWED: Allowed[] = [
  [/^\/movie\/\d+$/, 24 * HOUR],
  [/^\/movie\/\d+\/credits$/, 30 * 24 * HOUR],
  [/^\/discover\/movie$/, 6 * HOUR],
]

/** A cache in a Map, as a database's table would keep it */
function memory(): TmdbCache & { kept: Map<string, { body: string; fetched: number }> } {
  const kept = new Map<string, { body: string; fetched: number }>()
  return {
    kept,
    tmdb: (request, since) => {
      const k = kept.get(request)
      return k && k.fetched >= since ? k.body : undefined
    },
    keepTmdb: (request, body) => void kept.set(request, { body, fetched: Date.now() }),
  }
}

/** TMDB knowing one film; each request's path and query, as TMDB would see it */
function fakeTmdb(): { fetcher: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const path = url.pathname.replace(/^\/3/, '')
    calls.push(path + url.search)
    return path === '/movie/603' ? Response.json({ id: 603, title: 'The Matrix' }) : new Response('{"status_message":"Not found"}', { status: 404 })
  }) as typeof fetch
  return { fetcher, calls }
}

const tmdbWith = (fetcher: typeof fetch, cache: TmdbCache = memory(), token = 'token') => new Tmdb({ token, cache, allowed: ALLOWED, fetcher })

test('only what is allowed may be asked, each kept as long as allowed', () => {
  assert.equal(keptFor(ALLOWED, '/movie/603'), 24 * HOUR)
  assert.equal(keptFor(ALLOWED, '/movie/603/credits'), 30 * 24 * HOUR)
  for (const path of ['/account', '/movie/603/rating', '/movie/603/../account', '/movie/abc']) {
    assert.equal(keptFor(ALLOWED, path), undefined, path)
  }
})

test('a request is kept by its path and its query in order, without any api_key', () => {
  assert.equal(requestKey('/discover/movie', { year: 2025, page: 2, api_key: 'x', region: undefined }), '/discover/movie?page=2&year=2025')
  assert.equal(requestKey('/movie/603'), '/movie/603')
})

test('answers are kept: the same question goes to TMDB once, asked twice at once too', async () => {
  const fake = fakeTmdb()
  const cache = memory()
  const tmdb = tmdbWith(fake.fetcher, cache)
  const [first, meanwhile] = await Promise.all([
    tmdb.get<{ title: string }>('/movie/603', { language: 'en-US' }),
    tmdb.get<{ title: string }>('/movie/603', { language: 'en-US' }),
  ])
  const again = await tmdb.get<{ title: string }>('/movie/603', { language: 'en-US' })
  assert.equal(first.title, 'The Matrix')
  assert.deepEqual(meanwhile, first)
  assert.deepEqual(again, first)
  assert.deepEqual(fake.calls, ['/movie/603?language=en-US'])
  assert.deepEqual([...cache.kept.keys()], ['/movie/603?language=en-US'])
})

test("what isn't allowed isn't asked; TMDB's errors come back as TmdbError", async () => {
  const fake = fakeTmdb()
  const tmdb = tmdbWith(fake.fetcher)
  await assert.rejects(tmdb.get('/account'), (e) => e instanceof TmdbError && e.status === 404)
  assert.deepEqual(fake.calls, [])
  await assert.rejects(tmdb.get('/movie/1'), (e) => e instanceof TmdbError && e.status === 404)
  assert.deepEqual(fake.calls, ['/movie/1'])
})

test("TMDB's rate limit is waited out", async () => {
  let calls = 0
  const fetcher = (async () => {
    calls++
    return calls === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '0' } }) : Response.json({ id: 1 })
  }) as unknown as typeof fetch
  assert.deepEqual(await tmdbWith(fetcher).get('/movie/1'), { id: 1 })
  assert.equal(calls, 2)
})

test('the token goes as a bearer', async () => {
  let auth: string | null = null
  const fetcher = (async (_url: string, init?: RequestInit) => {
    auth = new Headers(init?.headers).get('Authorization')
    return Response.json({})
  }) as unknown as typeof fetch
  await tmdbWith(fetcher, memory(), 'secret').get('/movie/1')
  assert.equal(auth, 'Bearer secret')
})
