// Serves the built web app (dist/) as a local web service: `npm run build`
// once, then `npm start`. The page talks to Jellyfin directly (Jellyfin
// allows it), so this only hands out files. HOST and PORT to change where.

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('./dist/', import.meta.url))
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

async function file(path: string): Promise<string | undefined> {
  try {
    return (await stat(path)).isFile() ? path : undefined
  } catch {
    return undefined
  }
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost')
  const wanted = normalize(join(root, decodeURIComponent(pathname)))
  // anything that isn't a file is the app's page
  const path = (wanted.startsWith(root) || wanted + sep === root ? await file(wanted) : undefined) ?? join(root, 'index.html')
  if (!(await file(path))) {
    res.writeHead(500).end('Build the app first: npm run build')
    return
  }
  res.writeHead(200, {
    'Content-Type': types[extname(path)] ?? 'application/octet-stream',
    'Cache-Control': path.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(path).pipe(res)
}).listen(port, host, () => console.log(`jellyflow on http://${host}:${port}`))
