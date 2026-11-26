import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Store } from './db.ts'
import { fakeTmdb } from './fakes.ts'
import { keptFor, requestKey, Tmdb, TmdbError } from './tmdb.ts'

test('only what Discover reads may be asked', () => {
  for (const path of ['/movie/603', '/tv/1399/aggregate_credits', '/person/1/combined_credits', '/discover/movie', '/search/multi', '/trending/all/week']) {
    assert.ok(keptFor(path), path)
  }
  for (const path of ['/account', '/movie/603/rating', '/authentication/token/new', '/movie/603/../account', '/list/1', '/movie/abc']) {
    assert.equal(keptFor(path), undefined, path)
  }
  assert.ok((keptFor('/movie/603/credits') ?? 0) > (keptFor('/discover/movie') ?? 0), 'who made a film keeps longer than a list')
})

test('a request is kept by its path and its query in order, without any api_key', () => {
  assert.equal(requestKey('/discover/movie', { year: 2025, page: 2, api_key: 'x', region: undefined }), '/discover/movie?page=2&year=2025')
  assert.equal(requestKey('/movie/603'), '/movie/603')
})

test('answers are kept: the same question goes to TMDB once', async () => {
  const fake = fakeTmdb()
  const tmdb = new Tmdb('token', new Store(':memory:'), fake.fetcher)
  const first = await tmdb.get<{ title: string }>('/movie/603', { language: 'en-US' })
  const again = await tmdb.get<{ title: string }>('/movie/603', { language: 'en-US' })
  assert.equal(first.title, 'The Matrix')
  assert.deepEqual(again, first)
  assert.deepEqual(fake.calls, ['/movie/603?language=en-US'])
})

test("what isn't allowed isn't asked; TMDB's errors come back as TmdbError", async () => {
  const fake = fakeTmdb()
  const tmdb = new Tmdb('token', new Store(':memory:'), fake.fetcher)
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
  const tmdb = new Tmdb('token', new Store(':memory:'), fetcher)
  assert.deepEqual(await tmdb.get('/movie/1'), { id: 1 })
  assert.equal(calls, 2)
})

test('the token goes as a bearer', async () => {
  let auth: string | null = null
  const fetcher = (async (_url: string, init?: RequestInit) => {
    auth = new Headers(init?.headers).get('Authorization')
    return Response.json({})
  }) as unknown as typeof fetch
  await new Tmdb('secret', new Store(':memory:'), fetcher).get('/movie/1')
  assert.equal(auth, 'Bearer secret')
})
