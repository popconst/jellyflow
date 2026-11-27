import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { TmdbError } from './client.ts'
import { Images } from './images.ts'

/** TMDB's images: three bytes each, but gone.jpg; each request's path */
function fakeTmdb(): { fetcher: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    calls.push(url.pathname)
    return url.pathname.endsWith('/gone.jpg')
      ? new Response('', { status: 404 })
      : new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } })
  }) as typeof fetch
  return { fetcher, calls }
}

function withDir(work: (dir: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jellyflow-images-'))
    try {
      await work(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

test(
  "TMDB's images: fetched once, kept on disk, served from there; asked for at once, fetched once",
  withDir(async (dir) => {
    const tmdb = fakeTmdb()
    const images = new Images(dir, tmdb.fetcher)
    const [a, b] = await Promise.all([images.get('w342', 'poster.jpg'), images.get('w342', 'poster.jpg')])
    assert.deepEqual([...(a?.body ?? [])], [1, 2, 3])
    assert.equal(a?.type, 'image/jpeg')
    assert.deepEqual(b, a)
    assert.deepEqual([...readFileSync(join(dir, 'w342', 'poster.jpg'))], [1, 2, 3])
    assert.deepEqual(await images.get('w342', 'poster.jpg'), a)
    assert.equal(tmdb.calls.length, 1)
    // another size is another image
    await images.get('w500', 'poster.jpg')
    assert.equal(tmdb.calls.length, 2)
  }),
)

test(
  "TMDB's images: only real sizes and file names; one TMDB hasn't, TmdbError 404 (and nothing kept)",
  withDir(async (dir) => {
    const tmdb = fakeTmdb()
    const images = new Images(dir, tmdb.fetcher)
    for (const [size, file] of [['w9999', 'a.jpg'], ['w342', '../x.jpg'], ['w342', 'a.exe'], ['w342', '']]) {
      assert.equal(await images.get(size ?? '', file ?? ''), undefined, `${size}/${file}`)
    }
    assert.equal(tmdb.calls.length, 0)
    await assert.rejects(images.get('w342', 'gone.jpg'), (e) => e instanceof TmdbError && e.status === 404)
    await assert.rejects(images.get('w342', 'gone.jpg'), TmdbError, 'asked for again, asked again')
    assert.equal(tmdb.calls.length, 2)
  }),
)

test(
  "warming: what isn't kept yet, at each size, each once; TMDB's failures don't stop it",
  withDir(async (dir) => {
    const tmdb = fakeTmdb()
    const images = new Images(dir, tmdb.fetcher)
    await images.get('w342', 'a.jpg')
    await images.warm(['/a.jpg', '/b.jpg', '/gone.jpg', '/a.jpg'], ['w342', 'w500'])
    assert.deepEqual(
      tmdb.calls.sort(),
      ['/t/p/w342/a.jpg', '/t/p/w342/b.jpg', '/t/p/w342/gone.jpg', '/t/p/w500/a.jpg', '/t/p/w500/b.jpg', '/t/p/w500/gone.jpg'],
    )
  }),
)
