// The films and series in Watch: read when Watch is first opened, again when
// the library changes; each series' episodes (fetched once, again after
// watching); what's being watched, kept up to date from Jellyfin's live
// events; what was taken off Continue Watching, kept in Jellyfin (so every
// browser the user logs in from leaves it off); and what the player gets to
// play one of them.

import { untrack } from 'svelte'
import type { Item, Preferences } from '../core/jellyfin.ts'
import { toMovie, type Movie } from '../core/movies.ts'
import { continuing, inWatch, shelves, watchingOf, type Library, type Shelf, type Tile, type Watching } from '../core/shelves.ts'
import { episodeCode, episodesFrom, nextEpisode, toShow, type Episode, type Show } from '../core/shows.ts'
import { resumable, startAt, type Title } from '../core/titles.ts'
import { app, cached } from './state.svelte.ts'
import type { Showing } from './watch.svelte.ts'

/** Continue Watching's removed titles, in the app's settings on Jellyfin: id → when it had last been watched (ms) */
const HIDDEN = 'continueHidden'
/** Backdrops: small and blurred by Jellyfin, then stretched (it's a blur: nothing to lose) */
const BACKDROP_PX = 640
const BACKDROP_BLUR = 18
/** What was watched is read again once Jellyfin's news of it has been quiet this long (ms) */
const QUIET_MS = 1500

function parseHidden(value: string | null | undefined): Record<string, number> {
  try {
    const parsed: unknown = value ? JSON.parse(value) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {}
  } catch {
    return {}
  }
}

class Videos {
  /** Each film and series library in Watch (inWatch), with its titles */
  libraries = $state.raw<Library[]>([])
  /** The series being watched, each at its next episode */
  watching = $state.raw<Watching[]>([])
  hidden = $state.raw<Record<string, number>>({})
  loading = $state(false)
  read = $state(false)

  movies = $derived(this.libraries.flatMap((l) => l.titles.filter((t): t is Movie => t.kind === 'movie')))
  shows = $derived(this.libraries.flatMap((l) => l.titles.filter((t): t is Show => t.kind === 'show')))
  titles = $derived<Title[]>([...this.movies, ...this.shows])
  /** The rows: Continue Watching, if anything's in it, then the libraries' and the genres' (kept as they are when only it changes) */
  private rows = $derived(shelves(this.libraries))
  private continuing = $derived<Tile[]>(continuing(this.movies, this.watching, this.hidden))
  shelves = $derived<Shelf[]>(
    this.continuing.length ? [{ key: 'continue', name: 'Continue Watching', tiles: this.continuing }, ...this.rows] : this.rows,
  )

  private episodeLists = new Map<string, Promise<Episode[]>>()
  private preferences: Preferences | undefined
  /** Each load's number: one that's been overtaken drops what it read */
  private generation = 0
  /** What Jellyfin said was watched, waiting for it to go quiet */
  private changed = new Set<string>()
  private changedTimer: ReturnType<typeof setTimeout> | undefined

  /** Everything, once (or `again`, after a change) */
  async load(again = false): Promise<void> {
    const client = app.client
    if (!client || !app.videoLibraries.length || (!again && (this.loading || this.read))) return
    const generation = ++this.generation
    this.loading = true
    try {
      const [all, inProgress, preferences] = await Promise.all([
        Promise.all(
          app.videoLibraries.map(async (l): Promise<Library> => {
            const films = l.CollectionType === 'movies'
            const titles: Title[] = films ? (await client.movies(l.Id)).map(toMovie) : (await client.series(l.Id)).map(toShow)
            return { id: l.Id, name: l.Name, kind: films ? 'movies' : 'tvshows', titles }
          }),
        ),
        client.seriesInProgress(),
        client.preferences().catch(() => undefined),
      ])
      const libraries = all.filter(inWatch)
      if (again) this.episodeLists.clear()
      const watching = await this.watchingOf(inProgress, libraries)
      if (generation !== this.generation) return
      this.preferences = preferences
      this.hidden = parseHidden(preferences?.CustomPrefs?.[HIDDEN])
      this.libraries = libraries
      this.watching = watching
      this.read = true
    } catch (e) {
      if (generation === this.generation) app.fail(e)
    } finally {
      if (generation === this.generation) this.loading = false
    }
  }

  /** The series being watched, of those in Watch, each at the episode to pick it up at */
  private async watchingOf(ids: string[], libraries: Library[]): Promise<Watching[]> {
    const shows = new Map(libraries.flatMap((l) => l.titles).map((t) => [t.id, t]))
    const out = await Promise.all(
      ids.map(async (id) => {
        const show = shows.get(id)
        return show?.kind === 'show' ? watchingOf(show, await this.episodes(id).catch(() => [])) : undefined
      }),
    )
    return out.filter((w) => w !== undefined)
  }

  /** A series' episodes in order, with where each was stopped; fetched once, or `fresh` */
  episodes(seriesId: string, fresh = false): Promise<Episode[]> {
    if (fresh) this.episodeLists.delete(seriesId)
    return cached(this.episodeLists, seriesId, () => app.client?.episodes(seriesId).then(episodesFrom) ?? Promise.resolve([]))
  }

  private title(id: string): Title | undefined {
    return this.titles.find((t) => t.id === id)
  }

  /** Where a film or a series is at now, as Jellyfin has it (after it was watched), here and in Continue Watching */
  async refresh(id: string): Promise<void> {
    const before = this.title(id)
    if (!before) return
    app.forget(id)
    try {
      const series = before.kind === 'show'
      const [item, episodes] = await Promise.all([app.item(id), series ? this.episodes(id, true) : undefined])
      const title = series ? toShow(item) : toMovie(item)
      this.libraries = this.libraries.map((l) =>
        l.titles.some((t) => t.id === id) ? { ...l, titles: l.titles.map((t) => (t.id === id ? title : t)) } : l,
      )
      if (title.kind === 'show' && episodes) {
        const others = this.watching.filter((w) => w.show.id !== id)
        const now = watchingOf(title, episodes)
        this.watching = now ? [now, ...others] : others
      }
    } catch {
      // the lists keep what they had
    }
  }

  /**
   * Jellyfin says these were watched (here or in another app): once it's
   * quiet, the films and series they are, or are episodes of, read again;
   * something new altogether (a series begun elsewhere), everything
   */
  heard(ids: string[]): void {
    if (!this.read) return
    for (const id of ids) this.changed.add(id)
    clearTimeout(this.changedTimer)
    this.changedTimer = setTimeout(() => void this.refreshChanged(), QUIET_MS)
  }

  private async refreshChanged(): Promise<void> {
    const ids = [...this.changed]
    this.changed.clear()
    const lists = await Promise.all([...this.episodeLists].map(async ([series, list]) => [series, await list.catch(() => [])] as const))
    const known = new Set<string>()
    for (const id of ids) {
      if (this.title(id)) known.add(id)
      for (const [series, episodes] of lists) if (episodes.some((e) => e.id === id)) known.add(series)
    }
    if (known.size) await Promise.all([...known].map((id) => this.refresh(id)))
    else if (ids.length) await this.load(true)
  }

  /** Takes a title off Continue Watching, until it's watched again */
  hide(tile: Tile): void {
    this.hidden = { ...this.hidden, [tile.id]: tile.watched ?? 0 }
    void this.saveHidden()
  }

  /** Puts it back */
  unhide(id: string): void {
    const { [id]: _, ...rest } = this.hidden
    this.hidden = rest
    void this.saveHidden()
  }

  /** In Jellyfin, with the app's other settings: only what's still being watched needs remembering */
  private async saveHidden(): Promise<void> {
    const client = app.client
    if (!client) return
    const live = new Set([...this.movies.filter(resumable).map((m) => m.id), ...this.watching.map((w) => w.show.id)])
    const hidden = Object.fromEntries(Object.entries(this.hidden).filter(([id]) => live.has(id)))
    try {
      const preferences = this.preferences ?? (await client.preferences())
      const saved = { ...preferences, CustomPrefs: { ...preferences.CustomPrefs, [HIDDEN]: JSON.stringify(hidden) } }
      await client.savePreferences(saved)
      this.preferences = saved
    } catch (e) {
      app.fail(e)
    }
  }

  /** A title's backdrop, dim behind the rows and on its page */
  backdrop(title: Title): string | undefined {
    return title.backdropTag && app.client ? app.client.backdropUrl(title.id, title.backdropTag, BACKDROP_PX, BACKDROP_BLUR) : undefined
  }

  /** What the player needs to play a film from `start` */
  async film(movie: Movie, start: number): Promise<Showing> {
    const item = await app.item(movie.id).catch((): Item => ({ Id: movie.id, Name: movie.title, Type: 'Movie' }))
    return {
      id: movie.id,
      title: movie.title,
      sub: [movie.year, movie.rating].filter(Boolean).join(' · '),
      name: movie.title,
      from: [movie.year, movie.genres.slice(0, 2).join(', ')].filter(Boolean).join(' · '),
      seconds: movie.seconds,
      poster: { id: movie.id, tag: movie.posterTag },
      item,
      start,
      stopped: () => void this.refresh(movie.id),
    }
  }

  /** … and an episode, with the one after it to go on to */
  async episode(show: Show, episode: Episode, start: number): Promise<Showing> {
    const item = await app.item(episode.id).catch((): Item => ({ Id: episode.id, Name: episode.title, Type: 'Episode' }))
    return {
      id: episode.id,
      title: show.title,
      sub: `${episodeCode(episode)} · ${episode.title}`,
      name: episode.title,
      from: `${show.title} · ${episodeCode(episode)}`,
      seconds: episode.seconds,
      poster: { id: show.id, tag: show.posterTag },
      item,
      start,
      next: async () => {
        const next = nextEpisode(await this.episodes(show.id), episode.id)
        return next && this.episode(show, next, startAt(next))
      },
      stopped: () => void this.refresh(show.id),
    }
  }

  clear(): void {
    this.generation++
    clearTimeout(this.changedTimer)
    this.changed.clear()
    this.libraries = []
    this.watching = []
    this.hidden = {}
    this.read = false
    this.loading = false
    this.preferences = undefined
    this.episodeLists.clear()
  }
}

export const videos = new Videos()

// Jellyfin's news: the library changed (everything again), something was watched (that again)
app.on('library', () => {
  if (videos.read) void videos.load(true)
})
app.on('watched', (ids) => videos.heard(ids))

// logging out forgets them (another user may log in next)
$effect.root(() => {
  $effect(() => {
    if (!app.session) untrack(() => videos.clear())
  })
})
