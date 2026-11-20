// Serves the built web app (dist/) as a local web service: `npm run build`
// once, then `npm start`. The page talks to Jellyfin directly (Jellyfin
// allows it), so this only hands out files. HOST and PORT to change where.

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('./dist/', import.meta.url))
const assets = join(root, 'assets')
const host = process.env['HOST'] ?? '127.0.0.1'
const port = Number(process.env['PORT'] ?? 4173)

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
}).listen(port, host, () => console.log(`jellyflow on http://${host}:${port}`))
