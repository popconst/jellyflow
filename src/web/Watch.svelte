<!--
  Watch: the films and series, Netflix style, in rows that are each a Cover
  Flow row (Row.svelte): Continue Watching, the films and the series newest
  first, then six genre rows (core/shelves.ts). The row with the keys is
  bigger, its name big above it and the title it's on under it; the next
  rows wait smaller below; j and k go from row to row. Enter opens a title:
  its row comes forward, full size, and the title's page swings out beside
  the poster (TitlePage.svelte).
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import { duration } from '../core/details.ts'
  import { keyName } from '../core/keys.ts'
  import { searchShelf, type Shelf, type Tile } from '../core/shelves.ts'
  import { episodeCode, type Episode } from '../core/shows.ts'
  import { facts, left, resumable, runtime, status } from '../core/titles.ts'
  import Poster from './Poster.svelte'
  import Progress from './Progress.svelte'
  import Row, { FOCUS, layout, type Geometry } from './Row.svelte'
  import Score from './Score.svelte'
  import SearchLine from './SearchLine.svelte'
  import { app, store, stored, typing } from './state.svelte.ts'
  import TitlePage from './TitlePage.svelte'
  import { videos } from './videos.svelte.ts'

  /** A poster's width over its height */
  const ASPECT = 2 / 3
  /** How much of the view the row with the keys takes, with its name and caption; how big the others show */
  const SHARE = 0.8
  const SMALL = 0.34
  /** Side posters apart, in widths: wider than Cover Flow's, so a small row reaches across the screen */
  const STEP = 0.3
  const REACH = 16
  /** How far down a poster's reflection shows, and how much of it a row keeps clear below it (in poster heights) */
  const REFLECTION = 0.16
  const BELOW_FLOOR = 0.08
  /** Above each row its name: big over the row with the keys, so there's no doubt which it is; under that one, its title, what it is and its genres (px) */
  const LABEL = 30
  const LABEL_ON = 54
  const CAPTION = 104
  /** How many genres the caption shows: the main ones, first as Jellyfin lists them */
  const GENRES = 3
  const GAP = 4
  /** Rows on the page around the one with the keys: one above, to go back up to; three below */
  const ABOVE = 1
  const BELOW = 3
  /** An opened title's page, as wide as this many poster heights: a film's, a series' (its episodes need room) */
  const FILM_PAGE = 1.15
  const SHOW_PAGE = 1.45
  /** Scrolled pixels to the next row */
  const WHEEL_ROW = 60

  type Mode = { kind: 'browse' } | { kind: 'search'; prev: string } | { kind: 'page' }
  const BROWSE: Mode = { kind: 'browse' }
  let mode = $state<Mode>(BROWSE)

  interface Saved {
    shelf?: string | undefined
    /** Each row's title, by the row's key */
    at?: Record<string, string>
    query?: string
  }
  const saved = stored<Saved>('jellyflow.watching') ?? {}
  /** Where each row was: rows taken off the page (out of sight) come back there */
  const at: Record<string, string> = { ...saved.at }

  let query = $state(saved.query ?? '')
  let applied = $state(saved.query ?? '')
  let section = $state<HTMLElement>()
  let box = $state({ w: 1200, h: 700 })
  /** The row with the keys, by key; by place if it's gone (a filter, a reload) */
  let focusKey = $state<string | undefined>(saved.shelf)
  let lastFocus = 0
  /** Each row's place (fractional while it moves) and whether it's at rest */
  let poses = $state<Record<string, number>>({})
  let rests = $state<Record<string, boolean>>({})
  let rows = $state<Record<string, Row<Tile> | undefined>>({})
  /** The opened title (kept while its page folds shut again), and the episode it was at in Continue Watching */
  let openedId = $state<string | undefined>()
  let openedEpisode = $state.raw<Episode | undefined>()
  let page = $state<TitlePage>()
  /** The last title taken off Continue Watching, for u */
  let removed = $state.raw<Tile | undefined>()
  let note = $state('')
  let noteTimer: ReturnType<typeof setTimeout> | undefined

  const shelves = $derived<Shelf[]>(applied.trim() ? [searchShelf(videos.titles, applied)] : videos.shelves)
  const focus = $derived.by(() => {
    const i = shelves.findIndex((s) => s.key === focusKey)
    return i >= 0 ? i : Math.max(0, Math.min(lastFocus, shelves.length - 1))
  })
  /** The rows on the page: the one with the keys and those around it */
  const near = $derived(shelves.map((s, i) => ({ s, i })).filter(({ i }) => i >= focus - ABOVE && i <= focus + BELOW))
  const shelf = $derived<Shelf | undefined>(shelves[focus])
  const place = $derived(shelf ? Math.max(0, Math.min(shelf.tiles.length - 1, Math.round(poses[shelf.key] ?? 0))) : 0)
  const tile = $derived<Tile | undefined>(shelf?.tiles[place])
  const settled = $derived(shelf ? (rests[shelf.key] ?? true) : true)
  const opened = $derived(openedId ? videos.titles.find((t) => t.id === openedId) : undefined)
  const open = $derived(mode.kind === 'page' && opened !== undefined)

  /** Every row's stage, full size: as tall as the view, wide enough that a small one still spans it */
  const stage = $derived({ w: box.w / SMALL, h: Math.max(240, box.h - 8) })
  const fit = $derived(layout(stage, ASPECT))
  /** The scale that makes the row with the keys SHARE of the view (an opened title's is full size) */
  const zoomed = $derived(Math.max(SMALL, Math.min(1, (box.h * SHARE - LABEL_ON - CAPTION - 6) / (fit.floor + BELOW_FLOOR * fit.size))))

  // the films and series are read the first time Watch is opened
  $effect(() => {
    if (app.view === 'watch') void videos.load()
  })

  $effect(() => {
    lastFocus = focus
  })

  $effect(() => {
    app.pageOpen.watch = open
  })

  // where the rows rest is remembered, for the next visit
  $effect(() => {
    if (settled && shelf && shelf.key !== 'search') store('jellyflow.watching', { shelf: shelf.key, at, query: applied })
  })

  // the view's size sets the rows' (not while hidden, at no size at all); scrolling up and down goes from row to row
  $effect(() => {
    const el = section
    if (!el) return
    const resize = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry?.contentRect ?? { width: 0, height: 0 }
      if (w > 0 && h > 0) box = { w, h }
    })
    resize.observe(el)
    let scrolled = 0
    let quietUntil = 0
    const onwheel = (e: WheelEvent) => {
      if (mode.kind === 'page' || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      e.preventDefault()
      const now = performance.now()
      if (now < quietUntil) return
      scrolled += e.deltaY * (e.deltaMode === 1 ? 30 : 1)
      if (Math.abs(scrolled) < WHEEL_ROW) return
      toRow(focus + Math.sign(scrolled))
      scrolled = 0
      quietUntil = now + 380
    }
    el.addEventListener('wheel', onwheel, { passive: false })
    return () => {
      resize.disconnect()
      el.removeEventListener('wheel', onwheel)
    }
  })

  /** A word in the line at the bottom for a while */
  function say(message: string): void {
    note = message
    clearTimeout(noteTimer)
    noteTimer = setTimeout(() => (note = ''), 5000)
  }

  /** How tall a row's name is */
  function label(i: number): number {
    return i === focus ? LABEL_ON : LABEL
  }

  /** How big a row shows */
  function zoom(i: number): number {
    if (i === focus) return open ? 1 : zoomed
    return SMALL
  }

  /** A row's height on the page: its name, its posters down to a little of their reflection, the caption under the one with the keys */
  function tall(i: number): number {
    return label(i) + (fit.floor + BELOW_FLOOR * fit.size) * zoom(i) + (i === focus ? CAPTION : 0)
  }

  /** Where each row on the page stands: the one with the keys at the top (an opened one fills the view), the rest stacked around it */
  const tops = $derived.by(() => {
    const y = new Map<number, number>()
    y.set(focus, open ? -LABEL_ON : 4)
    for (let i = focus + 1; i <= Math.min(shelves.length - 1, focus + BELOW); i++) y.set(i, (y.get(i - 1) ?? 0) + tall(i - 1) + GAP)
    for (let i = focus - 1; i >= Math.max(0, focus - ABOVE); i--) y.set(i, (y.get(i + 1) ?? 0) - tall(i) - GAP)
    return y
  })

  /** An opened title's page: as wide as there's room for, up to its share */
  function pageWidth(g: Geometry): number {
    const room = box.w - g.width * FOCUS - 64
    return Math.max(240, Math.min(room, g.size * FOCUS * (opened?.kind === 'show' ? SHOW_PAGE : FILM_PAGE)))
  }

  /** The tile the row with the keys is heading to: what keys act on, even mid-glide */
  function heading(): Tile | undefined {
    if (!shelf) return undefined
    return shelf.tiles[rows[shelf.key]?.target() ?? place]
  }

  function toRow(i: number): void {
    const to = Math.max(0, Math.min(shelves.length - 1, i))
    if (to === focus) return
    const now = heading()
    if (shelf && now && shelf.key !== 'search') at[shelf.key] = now.id
    focusKey = shelves[to]?.key
  }

  function openPage(): void {
    const t = heading()
    if (!t) return
    openedId = t.title.id
    openedEpisode = t.episode
    mode = { kind: 'page' }
  }

  function closePage(): void {
    mode = BROWSE
  }


  /** A poster clicked, in any row: its row comes forward and glides to it, and it opens once there; the open title's poster shuts it again */
  function clickTile(row: number, index: number, middle: boolean): void {
    const key = shelves[row]?.key
    if (!key) return
    if (row === focus && mode.kind === 'page') {
      closePage()
      if (middle) return
    }
    toRow(row)
    if (middle) openPage()
    else rows[key]?.select(index, true, openPage)
  }

  /** x: off Continue Watching (until it's watched again); u puts it back */
  function remove(): void {
    const t = heading()
    if (shelf?.key !== 'continue' || !t) return
    removed = t
    videos.hide(t)
    say(`“${t.title.title}” is off Continue Watching · u puts it back`)
  }

  function undo(): void {
    const t = removed
    if (!t) return
    removed = undefined
    rows['continue']?.anchorTo(t.id)
    at['continue'] = t.id
    videos.unhide(t.id)
    focusKey = 'continue'
    say(`“${t.title.title}” is back`)
  }

  function search(again: string): void {
    applied = again
    store('jellyflow.watching', { shelf: focusKey, at, query: again })
  }

  // the search's keys (SearchLine)

  function clearSearch(): void {
    query = ''
    search('')
  }

  /** Esc: the rows as they were */
  function cancelSearch(): void {
    if (mode.kind !== 'search') return
    const { prev } = mode
    mode = BROWSE
    query = prev
    search(prev)
  }

  /** Enter: browse what was found; nothing found is the same as Esc */
  function doneSearch(): void {
    if (mode.kind !== 'search') return
    const { prev } = mode
    mode = BROWSE
    if (!shelves[0]?.tiles.length) {
      query = prev
      search(prev)
    }
  }

  function moveWhileSearching(dir: -1 | 1, e: KeyboardEvent): void {
    rows['search']?.press(dir, e.repeat, e.code)
  }

  /** Watch's own keys (the row's are Row's): rows, opening, Continue Watching, search */
  function browseKey(key: string, repeat: boolean): boolean {
    switch (key) {
      case 'j':
      case '<Down>':
        toRow(focus + 1)
        break
      case 'k':
      case '<Up>':
        toRow(focus - 1)
        break
      case '<Enter>':
        if (!repeat) openPage()
        break
      case 'x':
        remove()
        break
      case 'u':
        undo()
        break
      case '/':
        query = applied
        mode = { kind: 'search', prev: applied }
        break
      case '<Esc>':
        if (!applied.trim()) return false
        query = ''
        search('')
        break
      default:
        return false
    }
    return true
  }

  function onkeydown(e: KeyboardEvent): void {
    if (app.view !== 'watch' || typing(e) || e.defaultPrevented || app.help) return
    const key = keyName(e)
    if (!key) return
    const row = shelf && rows[shelf.key]
    let handled: boolean
    if (mode.kind === 'page') {
      const answer = page?.key(key, e.repeat) ?? 'close'
      handled = answer !== 'pass'
      if (answer === 'close') closePage()
      // a film's page leaves the row's keys to the row: on to another film, the page shut
      else if (answer === 'pass' && row?.key(e)) {
        closePage()
        handled = true
      }
    } else handled = browseKey(key, e.repeat) || (row?.key(e) ?? false)
    if (handled) e.preventDefault()
  }

  function moved(key: string, tiles: Tile[], pos: number, rest: boolean): void {
    poses[key] = pos
    rests[key] = rest
    const t = tiles[Math.round(pos)]
    if (rest && t && key !== 'search') at[key] = t.id
  }

  /** Under the row with the keys: what it's resting on (its rating apart, in gold), and its main genres */
  function caption(t: Tile): { text: string; score?: number | undefined; more?: string; genres: string[] } {
    const title = t.title
    const genres = title.genres.slice(0, GENRES)
    const e = t.episode
    if (e) {
      return { text: `${resumable(e) ? '' : 'Next: '}${episodeCode(e)} · ${e.title}${resumable(e) ? ` · ${runtime(left(e))} left` : ''}`, genres }
    }
    const more = title.kind === 'movie' && resumable(title) ? `stopped at ${duration(title.resume)}` : status(title)
    return { text: facts(title), score: title.score, more, genres }
  }

  /**
   * Behind it all, dimly: the backdrop of the title the row rests on. Once
   * the row has rested a moment and the picture is loaded, it fades in over
   * the one before, which stays until it's covered: no dip to black between
   * them, no picture popping in halfway.
   */
  interface Layer {
    key: number
    url: string
  }
  let layers = $state.raw<Layer[]>([])
  let layerKey = 0
  $effect(() => {
    const url = settled && tile ? videos.backdrop(tile.title) : undefined
    if (!url || untrack(() => layers.at(-1)?.url) === url) return
    let live = true
    const timer = setTimeout(() => {
      const img = new Image()
      img.src = url
      void img
        .decode()
        .catch(() => undefined)
        .then(() => {
          if (live) layers = [...untrack(() => layers).slice(-2), { key: ++layerKey, url }]
        })
    }, 180)
    return () => {
      live = false
      clearTimeout(timer)
    }
  })

  /** A layer has faded in: the ones under it can go */
  function covered(key: number): void {
    layers = layers.filter((l) => l.key >= key)
  }
</script>

<svelte:window {onkeydown} />

<section class="watch" class:open bind:this={section}>
  <!-- each picture opaque, fading in over the last; the stack dimmed as one, so a covered one goes unseen -->
  <div class="backdrops">
    {#each layers as layer (layer.key)}
      <img class="backdrop" src={layer.url} alt="" onanimationend={() => covered(layer.key)} />
    {/each}
  </div>

  {#each near as { s, i } (s.key)}
    {@const scale = zoom(i)}
    <div
      class="rail"
      class:focused={i === focus}
      class:away={(open && i !== focus) || i < focus}
      style:transform="translateY({tops.get(i) ?? 0}px)"
      style:height="{label(i) + stage.h * scale}px"
    >
      <div
        class="scaler"
        style:width="{stage.w}px"
        style:height="{stage.h}px"
        style:margin-left="{-stage.w / 2}px"
        style:top="{label(i)}px"
        style:transform="scale({scale})"
      >
        <Row
          bind:this={rows[s.key]}
          items={s.tiles}
          aspect={ASPECT}
          start={at[s.key]}
          active={i === focus}
          open={open && i === focus}
          {pageWidth}
          step={STEP}
          reach={REACH}
          span={box.w / scale}
          {scale}
          fetchScale={Math.max(scale, zoomed)}
          box={stage}
          reflection={REFLECTION}
          sideways
          onmove={(pos, rest) => moved(s.key, s.tiles, pos, rest)}
          url={(t, px) => (t.title.posterTag && app.client ? app.client.posterUrl(t.title.id, t.title.posterTag, px) : undefined)}
          label={(t) => `${t.title.title}${t.title.year ? ` (${t.title.year})` : ''}`}
          onclick={(index, middle) => clickTile(i, index, middle)}
          onfloor={closePage}
        >
          {#snippet art(t, px)}
            <Poster id={t.title.id} tag={t.title.posterTag} width={px} title={t.title.title} />
          {/snippet}

          <!-- how far into it: along the poster's foot; watched: a tick; the episode it's at -->
          {#snippet badge(t)}
            {#if t.episode}
              <span class="episode">{episodeCode(t.episode)}</span>
              {#if resumable(t.episode)}<Progress of={t.episode} />{/if}
            {:else if t.title.played}
              <span class="watched" title="Watched">✓</span>
            {:else if t.title.kind === 'movie' && resumable(t.title)}
              <Progress of={t.title} />
            {/if}
          {/snippet}

          <!-- kept while the page folds shut again -->
          {#snippet beside()}
            {#if opened}
              {#key opened.id}
                <TitlePage bind:this={page} title={opened} episode={openedEpisode} />
              {/key}
            {/if}
          {/snippet}
        </Row>
      </div>
      {#if i === focus}
        <div class="caption" style:top="{label(i) + fit.floor * scale + 10}px">
          {#if tile}
            {@const c = caption(tile)}
            <div class="title">{tile.title.title}</div>
            <div class="sub">
              {c.text}{#if c.score}<Score value={c.score} />{:else if c.text && c.more}{' · '}{/if}{c.more}
            </div>
            {#if c.genres.length}
              <div class="genres">{#each c.genres as genre (genre)}<span>{genre}</span>{/each}</div>
            {/if}
          {/if}
        </div>
      {/if}
    </div>
  {/each}

  <!-- the sides darker: one gradient over all the rows; their names over it -->
  <div class="vignette" aria-hidden="true"></div>
  {#each near as { s, i } (s.key)}
    <h2
      class="name"
      class:focused={i === focus}
      class:away={(open && i !== focus) || i < focus}
      style:transform="translateY({tops.get(i) ?? 0}px)"
    >
      {s.name}
      {#if i === focus && s.tiles.length}<span class="count">{place + 1} / {s.tiles.length}</span>{/if}
    </h2>
  {/each}

  {#if !shelves.length}
    <div class="empty">
      {#if videos.loading || !videos.read}Loading films and series…{:else if applied.trim()}Nothing found for “{applied.trim()}”{:else}No films or series yet{/if}
    </div>
  {/if}

  <SearchLine
    searching={mode.kind === 'search'}
    bind:query
    placeholder="title, year or genre"
    {applied}
    everything="all rows"
    count={mode.kind === 'search' ? `${shelves[0]?.tiles.length ?? 0} found` : undefined}
    note={note || undefined}
    hint={shelf?.key === 'continue' && !open ? removeHint : undefined}
    quiet={app.quiet}
    oninput={() => search(query)}
    onclear={clearSearch}
    oncancel={cancelSearch}
    ondone={doneSearch}
    onmove={moveWhileSearching}
  />

  {#snippet removeHint()}<kbd>x</kbd> takes it off Continue Watching{/snippet}
</section>

<style>
  .watch {
    position: relative;
    height: 100%;
    overflow: hidden;
  }
  /* dimmed by its opacity over the black (no filter for the browser to run every frame) */
  .backdrops {
    position: absolute;
    inset: 0;
    opacity: 0.32;
    pointer-events: none;
  }
  .backdrop {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    animation: dawn 700ms ease-out both;
  }
  @keyframes dawn {
    from {
      opacity: 0;
    }
  }
  /* each row: its name, then its stage, scaled; they glide up and down as the keys go from row to row */
  .rail {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    transition:
      transform 600ms cubic-bezier(0.22, 0.61, 0.36, 1),
      opacity 450ms;
  }
  .rail:not(.focused) {
    opacity: 0.6;
  }
  .rail:not(.focused):hover {
    opacity: 0.8;
  }
  /* out of the way: the rows of an opened title's, and the one above (it's there to glide back down) */
  .rail.away {
    opacity: 0;
    pointer-events: none;
  }
  .vignette {
    position: absolute;
    inset: 0;
    z-index: 3000;
    pointer-events: none;
    background: linear-gradient(to right, rgb(0 0 0 / 0.85), rgb(0 0 0 / 0.3) 12%, transparent 26%, transparent 74%, rgb(0 0 0 / 0.3) 88%, rgb(0 0 0 / 0.85));
    transition: opacity 450ms;
  }
  .open .vignette {
    opacity: 0;
  }
  /* the row with the keys: its name big and bright, with an accent bar; the others' small and quiet */
  .name {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 3500;
    height: 54px;
    margin: 0;
    padding: 0 28px;
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: clamp(24px, 2.2vw, 32px);
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--text);
    text-shadow: 0 2px 10px #000;
    pointer-events: none;
    transition:
      transform 600ms cubic-bezier(0.22, 0.61, 0.36, 1),
      opacity 300ms;
  }
  .name.focused::before {
    content: '';
    width: 5px;
    height: 0.9em;
    border-radius: 3px;
    background: linear-gradient(to bottom, var(--accent), var(--accent-2));
    box-shadow: 0 0 12px rgb(0 164 220 / 0.6);
  }
  .name:not(.focused) {
    height: 30px;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--text-3);
    opacity: 0.8;
  }
  .name.away {
    opacity: 0;
  }
  .count {
    margin-left: auto;
    font: 14px var(--mono);
    color: var(--text-2);
    font-weight: 400;
    letter-spacing: 0;
  }
  .scaler {
    position: absolute;
    left: 50%;
    transform-origin: 50% 0;
    transition: transform 600ms cubic-bezier(0.22, 0.61, 0.36, 1);
  }
  .caption {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 2000;
    text-align: center;
    padding: 0 16px;
    text-shadow: 0 1px 8px #000;
    pointer-events: none;
    transition: opacity 300ms;
  }
  .open .caption {
    opacity: 0;
  }
  .caption .title {
    font-size: clamp(20px, 2.1vw, 30px);
    font-weight: 700;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .caption .sub {
    color: var(--text-2);
    font-size: clamp(15px, 1.3vw, 19px);
  }
  .caption .genres {
    display: flex;
    justify-content: center;
    gap: 6px;
    margin-top: 8px;
  }
  .caption .genres span {
    padding: 3px 11px;
    border-radius: 999px;
    font-size: clamp(12px, 0.95vw, 14px);
    font-weight: 600;
    color: var(--text);
    text-shadow: none;
    background: var(--glass), rgb(0 0 0 / 0.35);
    box-shadow: var(--glass-edge);
  }
  /* on the posters, in rows shown scaled: sized by the row's scale (--row-scale) to read the same in every row */
  .watched,
  .episode {
    position: absolute;
    display: grid;
    place-items: center;
    color: #fff;
    font-weight: 700;
    background: var(--glass), rgb(0 0 0 / 0.6);
    box-shadow: var(--glass-edge);
  }
  .watched {
    top: calc(6px / var(--row-scale));
    right: calc(6px / var(--row-scale));
    width: calc(22px / var(--row-scale));
    height: calc(22px / var(--row-scale));
    border-radius: 50%;
    font-size: calc(13px / var(--row-scale));
  }
  .episode {
    left: calc(6px / var(--row-scale));
    bottom: calc(10px / var(--row-scale));
    padding: calc(2px / var(--row-scale)) calc(8px / var(--row-scale));
    border-radius: 999px;
    font-size: calc(12px / var(--row-scale));
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--text-2);
    font-size: 16px;
  }
</style>
