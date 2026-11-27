<!--
  Watch: the films and series, Netflix style (Rails.svelte): Continue
  Watching, the films and the series newest first, then six genre rows
  (core/shelves.ts). Enter opens a title's page (TitlePage.svelte); x takes
  one off Continue Watching, u puts it back; / searches by title, year or
  genre.
-->
<script lang="ts">
  import { duration } from '../core/details.ts'
  import { searchShelf, type Shelf, type Tile } from '../core/shelves.ts'
  import { episodeCode } from '../core/shows.ts'
  import { facts, left, resumable, runtime, status } from '../core/titles.ts'
  import { Mark, Poster, Rails, type Rail } from '../lib/coverflow/index.ts'
  import Caption from './Caption.svelte'
  import Progress from './Progress.svelte'
  import { Note, Search } from './search.svelte.ts'
  import SearchLine from './SearchLine.svelte'
  import { app } from './state.svelte.ts'
  import TitlePage from './TitlePage.svelte'
  import { videos } from './videos.svelte.ts'

  /** An opened title's page, as wide as this many poster heights: a film's, a series' (its episodes need room) */
  const FILM_PAGE = 1.15
  const SHOW_PAGE = 1.45

  let rails = $state<Rails<Tile>>()
  let titlePage = $state<TitlePage>()
  let open = $state(false)
  let focusKey = $state<string | undefined>()
  /** The search on, kept across reloads */
  const search = new Search('jellyflow.watchSearch')
  /** A word in the line at the bottom for a while */
  const note = new Note(5000)
  /** The last title taken off Continue Watching, for u */
  let removed = $state.raw<Tile | undefined>()

  const shelves = $derived<Shelf[]>(search.applied.trim() ? [searchShelf(videos.titles, search.applied)] : videos.shelves)
  const shown = $derived<Rail<Tile>[]>(shelves.map((s) => ({ key: s.key, name: s.name, items: s.tiles, passing: s.key === 'search' })))

  // the films and series are read the first time Watch is opened
  $effect(() => {
    if (app.view === 'watch') void videos.load()
  })

  $effect(() => {
    app.pageOpen.watch = open
  })

  /** x: off Continue Watching (until it's watched again); u puts it back */
  function remove(): void {
    const at = rails?.current()
    if (at?.rail.key !== 'continue' || !at.item) return
    removed = at.item
    videos.hide(at.item)
    note.say(`“${at.item.title.title}” is off Continue Watching · u puts it back`)
  }

  function undo(): void {
    const t = removed
    if (!t) return
    removed = undefined
    rails?.show('continue', t.id)
    videos.unhide(t.id)
    note.say(`“${t.title.title}” is back`)
  }

  /** Watch's own keys (the rows' are Rails'): Continue Watching, search */
  function onkey(key: string): boolean {
    switch (key) {
      case 'x':
        remove()
        return true
      case 'u':
        undo()
        return true
      case '/':
        search.start()
        return true
      case '<Esc>':
        if (!search.applied.trim()) return false
        search.clear()
        return true
      default:
        return false
    }
  }

  /** A title's poster from Jellyfin, `px` wide */
  function poster(t: Tile, px: number): string | undefined {
    return t.title.posterTag && app.client ? app.client.posterUrl(t.title.id, t.title.posterTag, px) : undefined
  }

  /** Under the row with the keys: what it's resting on (its rating apart, in gold), and its main genres */
  function about(t: Tile): { text: string; score?: number | undefined; more?: string; genres: string[] } {
    const title = t.title
    const e = t.episode
    if (e) {
      return { text: `${resumable(e) ? '' : 'Next: '}${episodeCode(e)} · ${e.title}${resumable(e) ? ` · ${runtime(left(e))} left` : ''}`, genres: title.genres }
    }
    const more = title.kind === 'movie' && resumable(title) ? `stopped at ${duration(title.resume)}` : status(title)
    return { text: facts(title), score: title.score, more, genres: title.genres }
  }
</script>

<Rails
  bind:this={rails}
  bind:open
  bind:focusKey
  rails={shown}
  remember="jellyflow.watching"
  active={app.view === 'watch' && !app.help}
  url={poster}
  label={(t) => `${t.title.title}${t.title.year ? ` (${t.title.year})` : ''}`}
  pageWide={(t) => (t.title.kind === 'show' ? SHOW_PAGE : FILM_PAGE)}
  pageKey={(key, repeat) => titlePage?.key(key, repeat) ?? 'close'}
  backdrop={(t) => videos.backdrop(t.title)}
  {onkey}
>
  {#snippet art(t, px)}
    <Poster src={poster(t, px)} title={t.title.title} />
  {/snippet}

  <!-- how far into it: along the poster's foot; watched: a tick; the episode it's at -->
  {#snippet badge(t)}
    {#if t.episode}
      <span class="episode">{episodeCode(t.episode)}</span>
      {#if resumable(t.episode)}<Progress of={t.episode} />{/if}
    {:else if t.title.played}
      <Mark sign="✓" title="Watched" />
    {:else if t.title.kind === 'movie' && resumable(t.title)}
      <Progress of={t.title} />
    {/if}
  {/snippet}

  {#snippet caption(t)}
    {@const c = about(t)}
    <Caption title={t.title.title} text={c.text} score={c.score} more={c.more} genres={c.genres} />
  {/snippet}

  {#snippet page(t)}
    <TitlePage bind:this={titlePage} title={t.title} episode={t.episode} />
  {/snippet}

  {#snippet empty()}
    {#if videos.loading || !videos.read}Loading films and series…{:else if search.applied.trim()}Nothing found for “{search.applied.trim()}”{:else}No films or series yet{/if}
  {/snippet}

  <SearchLine
    searching={search.searching}
    bind:query={search.query}
    placeholder="title, year or genre"
    applied={search.applied}
    everything="all rows"
    count={search.searching ? `${shelves[0]?.tiles.length ?? 0} found` : undefined}
    note={note.text || undefined}
    hint={focusKey === 'continue' && !open ? removeHint : undefined}
    quiet={app.quiet}
    oninput={() => search.typed()}
    onclear={() => search.clear()}
    oncancel={() => search.cancel()}
    ondone={() => search.done(Boolean(shelves[0]?.tiles.length))}
    onmove={(dir, e) => rails?.press('search', dir, e.repeat, e.code)}
  />
</Rails>

{#snippet removeHint()}<kbd>x</kbd> takes it off Continue Watching{/snippet}

<style>
  /* the episode a Continue Watching title is at, on its poster's foot, sized by the row's scale (--row-scale) */
  .episode {
    position: absolute;
    left: calc(6px / var(--row-scale));
    bottom: calc(10px / var(--row-scale));
    display: grid;
    place-items: center;
    padding: calc(2px / var(--row-scale)) calc(8px / var(--row-scale));
    border-radius: 999px;
    color: #fff;
    font-size: calc(12px / var(--row-scale));
    font-weight: 700;
    background: var(--glass), rgb(0 0 0 / 0.6);
    box-shadow: var(--glass-edge);
  }
</style>
