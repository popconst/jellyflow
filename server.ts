// Serves the built web app (dist/) as a local web service: `npm run build`
// once, then `npm start`. The page talks to Jellyfin directly (Jellyfin
// allows it); this hands out its files, and under /api it answers what
// Jellyfin can't: Discover and the wishlist (server/api.ts). Set up by the
// environment (server/config.ts): HOST and PORT, JELLYFIN_URL, the TMDB
// token, where the database goes.

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Api } from './server/api.ts'
import { config } from './server/config.ts'
import { Store } from './server/db.ts'
import { Images } from './server/images.ts'
import { Tmdb } from './server/tmdb.ts'
import { Users } from './server/users.ts'

const settings = config()
const root = fileURLToPath(new URL('./dist/', import.meta.url))
const assets = join(root, 'assets')

const store = new Store(settings.database)
const api = new Api({
  store,
  users: new Users(settings.jellyfin),
  tmdb: settings.tmdbToken ? new Tmdb(settings.tmdbToken, store) : undefined,
  images: new Images(settings.images),
})

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
}

/** `path` if it's a file */
async function file(path: string): Promise<string | undefined> {
  try {
    return (await stat(path)).isFile() ? path : undefined
  } catch {
    return undefined
  }
}

/** The file asked for if it's in dist/, else the app's page; throws on a malformed %-escape */
async function resolve(url: string): Promise<string | undefined> {
  const wanted = normalize(join(root, decodeURIComponent(new URL(url, 'http://localhost').pathname)))
  return (wanted.startsWith(root) ? await file(wanted) : undefined) ?? (await file(join(root, 'index.html')))
}

createServer(async (req, res) => {
  if (req.url?.startsWith('/api/')) {
    await api.handle(req, res)
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end()
    return
  }
  let path: string | undefined
  try {
    path = await resolve(req.url ?? '/')
  } catch {
    res.writeHead(400).end()
    return
  }
  if (!path) {
    res.writeHead(503, { 'Content-Type': 'text/plain' }).end('Build the app first: npm run build\n')
    return
  }
  res.writeHead(200, {
    'Content-Type': types[extname(path)] ?? 'application/octet-stream',
    // the bundles' names change with their content; the page itself is always asked for afresh
    'Cache-Control': path.startsWith(assets) ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  // a rebuild can take the file away mid-read
  createReadStream(path)
    .on('error', () => res.destroy())
    .pipe(res)
}).listen(settings.port, settings.host, () => {
  console.log(`jellyflow on http://${settings.host}:${settings.port}`)
  console.log(settings.tmdbToken ? 'Discover: on' : 'Discover: off (no TMDB token)')
  void api.preload().catch((e: unknown) => console.error(`Discover: TMDB didn't answer (${e instanceof Error ? e.message : String(e)})`))
})
