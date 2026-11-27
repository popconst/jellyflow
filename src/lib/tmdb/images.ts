// TMDB's images (posters, backdrops, photos) for the page: fetched from TMDB
// once, kept on disk, and from then on served from there, whole. TMDB never
// changes an image under its name, so what's kept stays good. One fetch per
// image at a time, however many ask for it at once.
//
// Streaming them through as TMDB sends them was slow (a second or more each,
// every time) and, with a fast scroll asking for dozens at once, the browser
// drew them in top-down as the bytes trickled in.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TmdbError } from './client.ts'

const TMDB = 'https://image.tmdb.org/t/p'
const SIZES = new Set(['w92', 'w154', 'w185', 'w300', 'w342', 'w500', 'w780', 'w1280', 'h632', 'original'])
const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp' }
/** Images fetched at once while warming: a few, so the page's own, asked meanwhile, don't wait behind them */
const WARMING = 4

/** An image, whole, and its type ("image/jpeg") */
export interface Image {
  type: string
  body: Buffer
}

/** TMDB's images, kept on disk */
export class Images {
  private readonly dir: string
  private readonly fetch: typeof fetch
  private readonly fetching = new Map<string, Promise<Buffer>>()

  /** Kept under `dir` (made when first needed); `fetcher` for tests */
  constructor(dir: string, fetcher: typeof fetch = fetch) {
    this.dir = dir
    this.fetch = fetcher
  }

  /** TMDB's image `file` ("abc.jpg") at `size` ("w342"); undefined if that can't be one. TmdbError if TMDB hasn't it */
  async get(size: string, file: string): Promise<Image | undefined> {
    const type = TYPES[/^[A-Za-z0-9_-]+\.([a-z]+)$/.exec(file)?.[1] ?? '']
    if (!type || !SIZES.has(size)) return undefined
    const path = join(this.dir, size, file)
    const kept = await readFile(path).catch(() => undefined)
    if (kept) return { type, body: kept }
    let fetching = this.fetching.get(path)
    if (!fetching) {
      fetching = this.fromTmdb(size, file, path)
      this.fetching.set(path, fetching)
      void fetching.finally(() => this.fetching.delete(path)).catch(() => undefined)
    }
    return { type, body: await fetching }
  }

  /** Fetches what isn't kept yet, a few at a time, in the background: TMDB's paths ("/abc.jpg") at each of `sizes` */
  async warm(paths: string[], sizes: string[]): Promise<void> {
    const queue = [...new Set(paths)].flatMap((p) => sizes.map((size) => [size, p.replace(/^\//, '')] as const))
    const next = async (): Promise<void> => {
      for (let job = queue.shift(); job; job = queue.shift()) await this.get(...job).catch(() => undefined)
    }
    await Promise.all(Array.from({ length: WARMING }, next))
  }

  private async fromTmdb(size: string, file: string, path: string): Promise<Buffer> {
    const response = await this.fetch(`${TMDB}/${size}/${file}`, { signal: AbortSignal.timeout(20_000) })
    if (!response.ok) throw new TmdbError(response.status, `TMDB said ${response.status} for ${size}/${file}`)
    const body = Buffer.from(await response.arrayBuffer())
    // written whole, then put in place: a half-written file is never read
    const part = `${path}.${process.pid}.part`
    await mkdir(join(this.dir, size), { recursive: true })
      .then(() => writeFile(part, body))
      .then(() => rename(part, path))
      .catch((e: unknown) => console.error(`images: couldn't keep ${size}/${file}: ${e instanceof Error ? e.message : String(e)}`))
    return body
  }
}
