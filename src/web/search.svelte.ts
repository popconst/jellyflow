// What Watch's and Discover's line along the foot (SearchLine.svelte) shows:
// the search (/), what's typed and what's on (kept across reloads), with
// Esc's way back to the rows as they were; and a word for a while (what was
// just done).

import { store, stored } from './state.svelte.ts'

export class Search {
  /** What's typed */
  query = $state('')
  /** What's searched for: what's typed, as it's typed ('' for nothing) */
  applied = $state('')
  /** Searching: what was on before, for Esc */
  private before = $state<string | undefined>()
  private readonly key: string

  /** Kept in localStorage under `key` */
  constructor(key: string) {
    this.key = key
    this.query = this.applied = stored<string>(key) ?? ''
  }

  get searching(): boolean {
    return this.before !== undefined
  }

  /** /: the search on, to refine or replace */
  start(): void {
    this.query = this.applied
    this.before = this.applied
  }

  /** What's typed is searched for */
  typed(): void {
    this.apply(this.query)
  }

  /** Ctrl-U, or Esc on the rows: nothing searched for */
  clear(): void {
    this.query = ''
    this.apply('')
  }

  /** Esc: the rows as they were */
  cancel(): void {
    if (this.before === undefined) return
    const before = this.before
    this.before = undefined
    this.query = before
    this.apply(before)
  }

  /** Enter: browse what was `found`; nothing found is the same as Esc */
  done(found: boolean): void {
    if (this.before === undefined) return
    const before = this.before
    this.before = undefined
    if (!found) {
      this.query = before
      this.apply(before)
    }
  }

  private apply(query: string): void {
    this.applied = query
    store(this.key, query)
  }
}

/** A word in the line for a while */
export class Note {
  text = $state('')
  private readonly ms: number
  private timer: ReturnType<typeof setTimeout> | undefined

  /** Shown for `ms` */
  constructor(ms: number) {
    this.ms = ms
  }

  say(message: string): void {
    this.text = message
    clearTimeout(this.timer)
    this.timer = setTimeout(() => (this.text = ''), this.ms)
  }
}
