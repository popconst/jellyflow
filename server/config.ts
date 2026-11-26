// What the server needs, from the environment: where to listen, the Jellyfin
// the page logs in to (as the server reaches it), TMDB's token (a file of its
// own by default, never in the repo), where the database lives and where
// TMDB's images are kept.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface Config {
  host: string
  port: number
  /** Jellyfin, as this machine reaches it: "http://127.0.0.1:8096" */
  jellyfin: string
  /** TMDB's API read access token; without one there's no Discover */
  tmdbToken: string | undefined
  /** The SQLite file */
  database: string
  /** TMDB's images, once fetched (any of it can go: it's fetched again) */
  images: string
}

export function config(env: NodeJS.ProcessEnv = process.env): Config {
  const home = homedir()
  return {
    host: env['HOST'] ?? '127.0.0.1',
    port: Number(env['PORT'] ?? 4173),
    jellyfin: (env['JELLYFIN_URL'] ?? 'http://127.0.0.1:8096').replace(/\/+$/, ''),
    tmdbToken: env['TMDB_TOKEN'] || readIfThere(env['TMDB_TOKEN_FILE'] ?? join(home, '.config', 'jellyflow', 'tmdb-token')),
    database: env['DATABASE'] ?? join(home, '.local', 'share', 'jellyflow', 'jellyflow.db'),
    images: env['IMAGES'] ?? join(home, '.cache', 'jellyflow', 'images'),
  }
}

function readIfThere(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8').trim() || undefined
  } catch {
    return undefined
  }
}
