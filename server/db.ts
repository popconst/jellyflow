// The server's SQLite database (Node's own, no packages): TMDB's answers,
// kept a while; each user's Discover lists as last worked out; their
// wishlist, and what they're not interested in. Users are Jellyfin's, by id.

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite'
import type { DiscoverList, Ref, Suggestion } from '../src/core/discover.ts'

/** The schema, one step per version (PRAGMA user_version): add steps, never change one */
const MIGRATIONS = [
  `CREATE TABLE tmdb (
     request TEXT PRIMARY KEY,  -- path and query
     body TEXT NOT NULL,        -- TMDB's JSON
     fetched INTEGER NOT NULL   -- ms
   );
   CREATE TABLE discover (
     user TEXT NOT NULL,
     key TEXT NOT NULL,
     position INTEGER NOT NULL, -- the lists' order
     name TEXT NOT NULL,
     items TEXT NOT NULL,       -- JSON: Suggestion[]
     computed INTEGER NOT NULL,
     PRIMARY KEY (user, key)
   );
   CREATE TABLE wishlist (
     user TEXT NOT NULL,
     ref TEXT NOT NULL,         -- "tmdb:movie:603"; music's will be MusicBrainz's
     item TEXT NOT NULL,        -- JSON: Suggestion, as it was when added
     added INTEGER NOT NULL,
     PRIMARY KEY (user, ref)
   );`,
  // what the lists were worked out for (the kinds of list asked): asked for others, they're worked out again
  `ALTER TABLE discover ADD COLUMN made TEXT NOT NULL DEFAULT '';`,
  // not interested: left out of Discover's lists
  `CREATE TABLE dismissed (
     user TEXT NOT NULL,
     ref TEXT NOT NULL,
     added INTEGER NOT NULL,
     PRIMARY KEY (user, ref)
   );`,
]

/** TMDB's answers older than this go at startup (each kind of answer has its own, shorter, use-by in tmdb.ts) */
const KEEP_TMDB = 60 * 24 * 3_600_000

export interface Wish {
  item: Suggestion
  /** When it was added (ms) */
  added: number
}

export class Store {
  private readonly db: DatabaseSync

  /** The database at `path` (made if it isn't there), or ":memory:" */
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000')
    this.migrate()
    this.db.prepare('DELETE FROM tmdb WHERE fetched < ?').run(Date.now() - KEEP_TMDB)
  }

  private migrate(): void {
    const version = Number(this.db.prepare('PRAGMA user_version').get()?.['user_version'] ?? 0)
    MIGRATIONS.slice(version).forEach((step, i) => {
      this.transaction(() => {
        this.db.exec(step)
        this.db.exec(`PRAGMA user_version = ${version + i + 1}`)
      })
    })
  }

  private transaction(work: () => void): void {
    this.db.exec('BEGIN')
    try {
      work()
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  /** TMDB's answer to `request`, if one came after `since` (ms) */
  tmdb(request: string, since: number): string | undefined {
    const row = this.db.prepare('SELECT body FROM tmdb WHERE request = ? AND fetched >= ?').get(request, since)
    return row ? text(row['body']) : undefined
  }

  keepTmdb(request: string, body: string, now = Date.now()): void {
    this.db.prepare('INSERT OR REPLACE INTO tmdb (request, body, fetched) VALUES (?, ?, ?)').run(request, body, now)
  }

  /** A user's Discover lists, in order, if they were worked out for `made` */
  lists(user: string, made: string): DiscoverList[] {
    return this.db
      .prepare('SELECT key, name, items, computed FROM discover WHERE user = ? AND made = ? ORDER BY position')
      .all(user, made)
      .map((row) => ({
        key: text(row['key']),
        name: text(row['name']),
        items: JSON.parse(text(row['items'])) as Suggestion[],
        computed: Number(row['computed']),
      }))
  }

  /** Puts a user's lists, worked out for `made`, in place of the ones they had */
  keepLists(user: string, made: string, lists: DiscoverList[]): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM discover WHERE user = ?').run(user)
      const insert = this.db.prepare(
        'INSERT INTO discover (user, key, position, name, items, computed, made) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      lists.forEach((l, i) => insert.run(user, l.key, i, l.name, JSON.stringify(l.items), l.computed, made))
    })
  }

  /** A user's wishlist, newest first */
  wishlist(user: string): Wish[] {
    return this.db
      .prepare('SELECT item, added FROM wishlist WHERE user = ? ORDER BY added DESC, rowid DESC')
      .all(user)
      .map((row) => ({ item: JSON.parse(text(row['item'])) as Suggestion, added: Number(row['added']) }))
  }

  /** On the wishlist (again: it keeps when it was first added); wished for, it's not "not interested" any more */
  wish(user: string, item: Suggestion, now = Date.now()): void {
    const { owned: _owned, wished: _wished, ...kept } = item
    this.transaction(() => {
      this.db
        .prepare('INSERT INTO wishlist (user, ref, item, added) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET item = excluded.item')
        .run(user, item.ref, JSON.stringify(kept), now)
      this.db.prepare('DELETE FROM dismissed WHERE user = ? AND ref = ?').run(user, item.ref)
    })
  }

  /** Off the wishlist; whether it was on it */
  unwish(user: string, ref: Ref): boolean {
    return Number(this.db.prepare('DELETE FROM wishlist WHERE user = ? AND ref = ?').run(user, ref).changes) > 0
  }

  /** What a user isn't interested in, the latest first */
  dismissed(user: string): Ref[] {
    return this.db
      .prepare('SELECT ref FROM dismissed WHERE user = ? ORDER BY added DESC, rowid DESC')
      .all(user)
      .map((row) => text(row['ref']))
  }

  /** Not interested (and so off the wishlist) */
  dismiss(user: string, ref: Ref, now = Date.now()): void {
    this.transaction(() => {
      this.db.prepare('INSERT INTO dismissed (user, ref, added) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(user, ref, now)
      this.db.prepare('DELETE FROM wishlist WHERE user = ? AND ref = ?').run(user, ref)
    })
  }

  /** Interesting again; whether it wasn't */
  undismiss(user: string, ref: Ref): boolean {
    return Number(this.db.prepare('DELETE FROM dismissed WHERE user = ? AND ref = ?').run(user, ref).changes) > 0
  }

  close(): void {
    this.db.close()
  }
}

function text(value: SQLOutputValue | undefined): string {
  return typeof value === 'string' ? value : ''
}
