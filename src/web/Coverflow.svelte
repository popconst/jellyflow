<!--
  Cover Flow: the albums in a row (Row.svelte). Modes: browse, search (/),
  the open album (Enter: it opens like a gatefold sleeve, its tracks on a
  page that swings out to the right, the spectrum of what's playing on the
  floor under it) and the details (i).
-->
<script lang="ts">
  import { duration, links } from '../core/details.ts'
  import { keyName } from '../core/keys.ts'
  import { filter as find, toTrack, type Album, type Found, type Track } from '../core/library.ts'
  import Cover from './Cover.svelte'
  import Details from './Details.svelte'
  import { player } from './player.svelte.ts'
  import Row, { FOCUS } from './Row.svelte'
  import { app, store, stored, typing } from './state.svelte.ts'
  import TrackList from './TrackList.svelte'
  import Visualizer from './Visualizer.svelte'

  /** The open album's page: the share of it the spectrum stands in (the tracks above) */
  const SPECTRUM = 0.42
  /** The row follows the search once typing pauses this long */
  const FILTER_MS = 150

  type Mode =
    | { kind: 'browse' }
    | { kind: 'search'; from: string | undefined; prev: string }
    | { kind: 'tracks'; tracks: Track[]; cursor: number }
    | { kind: 'info' }

  const BROWSE: Mode = { kind: 'browse' }
  let mode = $state<Mode>(BROWSE)
  /** Where the row was last time: the album, and the filter on */
  const saved = stored<{ id: string; filter: string }>('jellyflow.flow')
  /**
   * Something playing when the page was reloaded: the row starts at its album,
   * opened, the cursor on the track (and the view is Cover Flow)
   */
  const resume = player.current
  if (resume && app.view !== 'flow') app.setView('flow')
  /** What's typed after / */
  let query = $state(resume ? '' : (saved?.filter ?? ''))
  /** What the row is filtered by: the query, once typing pauses */
  let applied = $state(resume ? '' : (saved?.filter ?? ''))
  let filterTimer: ReturnType<typeof setTimeout> | undefined
  let input = $state<HTMLInputElement>()

  let row = $state<Row<Album>>()
  /** Where the row is, fractional while it moves */
  let pos = $state(0)
  let settled = $state(true)
  /** The album opened with Enter, kept while its page folds shut again */
  let opened = $state.raw<{ album: Album; tracks: Track[] } | undefined>()
  /** Where c came from, for o to go back to (and o again to return) */
  let back: { id: string; filter: string } | undefined

  const found = $derived.by(() => {
    void app.titlesVersion
    return find(app.albums, applied, app.titles)
  })
  /** The row's albums: the matches */
  const albums = $derived(found.flatMap((f) => app.albums[f.index] ?? []))
  const last = $derived(Math.max(0, found.length - 1))
  const place = $derived(Math.max(0, Math.min(last, Math.round(pos))))
  const album = $derived<Album | undefined>(albums[place])
  const filtered = $derived(applied.trim() !== '')

  /** The album the row is heading to: what keys act on, even mid-glide */
  function chosen(): { album: Album; found: Found } | undefined {
    const at = row?.target() ?? place
    const f = found[at]
    const a = albums[at]
    return a && f ? { album: a, found: f } : undefined
  }

  // after a reload with something playing: its album opened, once the row has got there
  let opening = resume !== undefined
  $effect(() => {
    if (!opening || !resume || !found.length) return
    if (chosen()?.album.id !== resume.albumId) return
    opening = false
    void openTracks()
  })

  $effect(() => {
    app.pageOpen.flow = mode.kind === 'tracks'
  })

  // where the row rests is remembered, for the next visit
  $effect(() => {
    if (!settled) return
    const id = albums[place]?.id
    if (id) store('jellyflow.flow', { id, filter: applied })
  })


  /** The row for the query, at album `keep` if it's in it, else the first match (no glide) */
  function applyFilter(keep: string | undefined): void {
    clearTimeout(filterTimer)
    filterTimer = undefined
    applied = query
    row?.anchorTo(keep && albums.some((a) => a.id === keep) ? keep : albums[0]?.id)
  }

  /** While searching: the first match; with the search emptied, the album it started from */
  function applyTyped(): void {
    if (mode.kind === 'search') applyFilter(query.trim() ? undefined : mode.from)
  }

  function typed(): void {
    clearTimeout(filterTimer)
    filterTimer = setTimeout(applyTyped, FILTER_MS)
  }

  function onSearchKey(e: KeyboardEvent): void {
    if (mode.kind !== 'search') return
    const { from, prev } = mode
    const pending = () => filterTimer !== undefined && applyTyped()
    if (e.ctrlKey && e.key === 'u') {
      query = ''
      typed()
    } else if (e.key === 'Escape') {
      // back to the row as it was
      mode = BROWSE
      query = prev
      applyFilter(from)
    } else if (e.key === 'Enter') {
      // browse the matches; nothing to browse is the same as Esc
      pending()
      mode = BROWSE
      if (!found.length) {
        query = prev
        applyFilter(from)
      } else if (!filtered) query = applied = ''
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      pending()
      row?.press(-1, e.repeat, e.code)
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      pending()
      row?.press(1, e.repeat, e.code)
    } else return
    e.preventDefault()
  }

  $effect(() => {
    if (mode.kind === 'search') input?.focus()
  })

  async function tracksOf(a: Album): Promise<Track[] | undefined> {
    try {
      return (await app.albumTracks(a.id)).map(toTrack)
    } catch (e) {
      app.fail(e)
      return undefined
    }
  }

  /** Enter: the album opened, its tracks from the one the search found it by, else the one playing */
  async function openTracks(): Promise<void> {
    const c = chosen()
    if (!c) return
    const tracks = await tracksOf(c.album)
    if (!tracks || chosen()?.album.id !== c.album.id) return
    const matched = c.found.track
    let cursor = matched ? tracks.findIndex((t) => t.title === matched) : -1
    if (cursor < 0) cursor = tracks.findIndex((t) => t.id === player.current?.id)
    opened = { album: c.album, tracks }
    mode = { kind: 'tracks', tracks, cursor: Math.max(0, cursor) }
  }

  function playFrom(index: number): void {
    if (mode.kind !== 'tracks') return
    player.play(mode.tracks, index)
    app.say(`Playing ${mode.tracks[index]?.title ?? ''}`)
  }

  async function add(): Promise<void> {
    const c = chosen()
    const tracks = c && (await tracksOf(c.album))
    if (!tracks) return
    player.add(tracks)
    app.say('Added to the queue')
  }

  /** To album `id` with `filter` on: a glide if the filter's the same, else the new row at it */
  function goTo(id: string, filter: string): void {
    if (filter !== applied) {
      query = filter
      applyFilter(id)
      return
    }
    const at = albums.findIndex((a) => a.id === id)
    if (at >= 0) row?.select(at)
  }

  /** c: the album playing; the filter goes if it isn't among its matches. o comes back here */
  function jumpToPlaying(): void {
    const id = player.current?.albumId
    if (!id || !app.albums.some((a) => a.id === id)) return
    const here = chosen()?.album.id
    if (here && here !== id) back = { id: here, filter: applied }
    goTo(id, found.some((f) => app.albums[f.index]?.id === id) ? applied : '')
  }

  /** o: back to where c came from; o again goes back there */
  function jumpBack(): void {
    if (!back) return
    const to = back
    const here = chosen()?.album.id
    back = here ? { id: here, filter: applied } : undefined
    goTo(to.id, to.filter)
  }

  /** d / w / m: the album on Discogs, Wikipedia, MusicBrainz */
  function openLink(key: string): void {
    const c = chosen()
    const link = c && links(c.album).find((l) => l.key === key)
    if (!link) return
    window.open(link.url, '_blank', 'noopener')
    app.say(`Opened ${link.name}`)
  }

  function browseKey(key: string, repeat: boolean): boolean {
    switch (key) {
      case '<Esc>':
        // the filter goes, staying at the same album
        if (!filtered) return false
        query = ''
        applyFilter(album?.id)
        break
      case 'i':
        if (!repeat) mode = { kind: 'info' }
        break
      case '/':
        // the current filter, to refine or replace
        query = applied
        mode = { kind: 'search', from: album?.id, prev: applied }
        break
      case 'c':
        jumpToPlaying()
        break
      case 'o':
        jumpBack()
        break
      // j opens it too: down into the tracks, and k on the first one folds it shut
      case '<Enter>':
      case 'j':
        if (!repeat) void openTracks()
        break
      case 'a':
        if (!repeat) void add()
        break
      case 'd':
      case 'w':
      case 'm':
        if (!repeat) openLink(key)
        break
      default:
        return false
    }
    return true
  }

  function tracksKey(key: string, repeat: boolean, m: { tracks: Track[]; cursor: number }): boolean {
    const end = Math.max(0, m.tracks.length - 1)
    switch (key) {
      case '<Esc>':
      case 'q':
      case '<BS>':
        mode = BROWSE
        break
      case 'j':
      case '<Down>':
        m.cursor = Math.min(m.cursor + 1, end)
        break
      case 'k':
      case '<Up>':
        // up from the first track: back to the covers
        if (m.cursor === 0) {
          if (!repeat) mode = BROWSE
        } else m.cursor--
        break
      case 'g':
      case '<Home>':
        m.cursor = 0
        break
      case 'G':
      case '<End>':
        m.cursor = end
        break
      case '<Enter>':
        if (!repeat) playFrom(m.cursor)
        break
      case 'a':
        if (!repeat) void add()
        break
      case 'i':
        mode = { kind: 'info' }
        break
      case 'd':
      case 'w':
      case 'm':
        if (!repeat) openLink(key)
        break
      default:
        return false
    }
    return true
  }

  function infoKey(key: string, repeat: boolean): boolean {
    switch (key) {
      case '<Esc>':
      case 'q':
      case 'i':
      case '<BS>':
        if (!repeat) mode = BROWSE
        break
      case '<Enter>':
      case 'j':
        if (!repeat) void openTracks()
        break
      case 'a':
        if (!repeat) void add()
        break
      case 'c':
        jumpToPlaying()
        break
      case 'o':
        jumpBack()
        break
      case 'd':
      case 'w':
      case 'm':
        if (!repeat) openLink(key)
        break
      default:
        return false
    }
    return true
  }

  function onkeydown(e: KeyboardEvent): void {
    if (app.view !== 'flow' || typing(e) || e.defaultPrevented || app.help) return
    const key = keyName(e)
    if (!key) return
    let handled: boolean
    if (mode.kind === 'tracks') {
      handled = tracksKey(key, e.repeat, mode)
      // the row's keys flip to another album: the list closes
      if (!handled && row?.key(e)) {
        mode = BROWSE
        handled = true
      }
    } else {
      // with the details open, the panel follows the row
      handled = (mode.kind === 'info' ? infoKey(key, e.repeat) : browseKey(key, e.repeat)) || (row?.key(e) ?? false)
    }
    if (handled) e.preventDefault()
  }

  /** A click away from the open album (or its details), anywhere but on a cover or the page itself, closes it */
  function clickAway(e: MouseEvent): void {
    if (mode.kind !== 'tracks' && mode.kind !== 'info') return
    if (e.target instanceof Element && e.target.closest('[data-page], .details, button, input, a')) return
    mode = BROWSE
  }

  /** A cover clicked: the row glides to it, and it opens once there; the open album's cover shuts it again */
  function clickCover(index: number, middle: boolean): void {
    if (mode.kind === 'tracks') {
      mode = BROWSE
      if (middle) return
    }
    if (middle) void openTracks()
    else row?.select(index, true, () => void openTracks())
  }
</script>

<svelte:window {onkeydown} />

<!-- the keyboard's way out is Esc; a click away is the mouse's -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<section class="flow" class:open={mode.kind === 'tracks'} class:info={mode.kind === 'info'} onclick={clickAway}>
  <div class="stagebox">
    <Row
      bind:this={row}
      onmove={(p, s) => {
        pos = p
        settled = s
      }}
      items={albums}
      start={resume?.albumId ?? saved?.id}
      active={app.view === 'flow'}
      open={mode.kind === 'tracks'}
      url={(a, px) => (a.imageTag && app.client ? app.client.imageUrl(a.id, a.imageTag, px) : undefined)}
      label={(a) => `${a.title} by ${a.artist}`}
      onclick={clickCover}
    >
      {#snippet art(a, px)}
        <Cover id={a.id} tag={a.imageTag} size={px} title={a.title} lazy={false} />
      {/snippet}

      <!-- the floor glows with what's playing, in its album's colours, under the covers'
           reflections, whichever album is in the middle (an open album has its own
           spectrum, on its page, only when it's the one playing) -->
      {#snippet under(g)}
        {#if mode.kind !== 'tracks' && player.current}
          <div class="glow" style:height="{Math.max(40, (g.box.h - g.floor) * 0.8)}px">
            <Visualizer albumId={player.current.albumId} tag={player.current.imageTag} reflex={0} />
          </div>
        {/if}
      {/snippet}

      <!-- Enter: the album's page, swung out from behind the cover like a gatefold
           sleeve. Second only to the cover, the spectrum of what's playing stands
           in its lower part, on the same floor as the cover, its reflection on
           the floor below like the cover's; the tracks are above it -->
      {#snippet beside(g)}
        <!-- kept while the page folds shut again -->
        {#if opened}
          {@const o = opened}
          {@const art = o.album.imageTag && app.client ? app.client.imageUrl(o.album.id, o.album.imageTag, g.thumb) : undefined}
          {@const pageH = g.size * FOCUS}
          {@const barsH = pageH * SPECTRUM}
          {@const mirrorH = Math.max(0, Math.min(g.size * 0.3, g.box.h - g.floor - 6))}
          <!-- the spectrum only for the album playing; otherwise the tracks have the page -->
          {@const live = player.current?.albumId === o.album.id}
          <div class="sheet">
            {#if art}<img class="page-art" src={art} alt="" />{/if}
            <header>
              <div class="page-title">{o.album.title}</div>
              <div class="page-sub">
                {o.album.artist || 'Unknown artist'}{o.album.year ? ` · ${o.album.year}` : ''} · {o.tracks.length}
                {o.tracks.length === 1 ? 'track' : 'tracks'} · {duration(o.tracks.reduce((sum, t) => sum + t.seconds, 0))}
              </div>
            </header>
            <TrackList tracks={o.tracks} cursor={mode.kind === 'tracks' ? mode.cursor : undefined} onplay={playFrom} />
            <div class="stand" style:flex-basis="{live ? barsH : 0}px"></div>
          </div>
          <div
            class="spectrum"
            class:quiet={!live}
            style:top="{pageH - barsH}px"
            style:height="{barsH + mirrorH}px"
          >
            <Visualizer
              albumId={o.album.id}
              tag={o.album.imageTag}
              reflex={mirrorH / (barsH + mirrorH)}
              active={live}
            />
          </div>
        {/if}
      {/snippet}

      {#snippet over(g)}
        <!-- further out is darker: one still gradient over the row, not a filter per cover -->
        <div class="vignette"></div>
        <div class="caption" style:top="{Math.min(g.floor + 16, g.box.h - 110)}px">
          {#if album}
            <div class="title">{album.title}</div>
            <div class="sub">{album.artist || 'Unknown artist'}{album.year ? ` · ${album.year}` : ''}</div>
          {:else if app.loading}
            <div class="sub">Loading {app.loading}…</div>
          {:else if app.albums.length}
            <div class="sub">No album matches “{applied}”</div>
          {/if}
        </div>
      {/snippet}
    </Row>
  </div>

  {#if mode.kind === 'info' && album}
    <aside class="details"><Details {album} /></aside>
  {/if}

  <div class="line" class:quiet={app.quiet}>
    {#if mode.kind === 'search'}
      <span class="slash">/</span>
      <input
        bind:this={input}
        bind:value={query}
        oninput={typed}
        onkeydown={onSearchKey}
        spellcheck="false"
        autocomplete="off"
        placeholder="artist, album, year or track title"
      />
      <span class="count">{found.length} {found.length === 1 ? 'album' : 'albums'}</span>
    {:else}
      {#if filtered}
        <span class="filter">/{applied}</span>
        <span class="hint"><kbd>Esc</kbd> whole library · <kbd>/</kbd> edit</span>
      {/if}
      <span class="count">{found.length ? place + 1 : 0} / {found.length}</span>
    {/if}
  </div>
</section>

<style>
  .flow {
    --panel-w: min(420px, 40vw);
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .stagebox {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
  }
  .flow.info .stagebox {
    margin-right: var(--panel-w);
  }
  .flow.open .caption {
    opacity: 0;
  }
  .vignette {
    position: absolute;
    inset: 0;
    z-index: 1500;
    pointer-events: none;
    background: linear-gradient(
      to right,
      rgb(0 0 0 / 0.92),
      rgb(0 0 0 / 0.35) 16%,
      transparent 30%,
      transparent 70%,
      rgb(0 0 0 / 0.35) 84%,
      rgb(0 0 0 / 0.92)
    );
  }
  .flow.open .vignette {
    opacity: 0;
  }
  .sheet {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    padding: 18px 12px 10px;
    overflow: hidden;
    background: #0d0d10;
    box-shadow: 0 10px 40px rgb(0 0 0 / 0.6);
  }
  /* where the spectrum stands: the lower part of the page, darkened a little so
     the bars glow, and the floor below it for their reflection */
  .stand {
    flex: none;
    transition: flex-basis 450ms cubic-bezier(0.22, 0.61, 0.36, 1);
    margin: 0 -12px -10px;
    background: linear-gradient(to bottom, transparent, rgb(0 0 0 / 0.45));
  }
  .spectrum {
    position: absolute;
    left: 0;
    width: 100%;
    pointer-events: none;
    transition: opacity 450ms;
  }
  .spectrum.quiet {
    opacity: 0;
  }
  /* tighter rows on the page, so more tracks fit above the spectrum */
  .sheet :global(li button) {
    padding-top: 3px;
    padding-bottom: 3px;
  }
  /* the back cover: the art, blurred into the dark */
  .page-art {
    position: absolute;
    inset: -10%;
    width: 120%;
    height: 120%;
    object-fit: cover;
    filter: blur(28px) brightness(0.3) saturate(1.2);
  }
  .sheet header {
    position: relative;
    padding: 0 10px 10px;
    margin-bottom: 6px;
    border-bottom: 1px solid rgb(255 255 255 / 0.14);
  }
  .page-title {
    font-size: 19px;
    font-weight: 700;
  }
  .page-sub {
    color: var(--text-2);
    font-size: 13px;
  }
  .sheet :global(ol) {
    position: relative;
    flex: 1;
    min-height: 0;
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
  }
  .title {
    font-size: clamp(18px, 2.2vw, 26px);
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .sub {
    color: var(--text-2);
    font-size: clamp(14px, 1.4vw, 17px);
  }
  .details {
    position: absolute;
    top: 12px;
    right: 12px;
    bottom: 52px;
    width: calc(var(--panel-w) - 24px);
    display: flex;
    background: rgb(18 18 20 / 0.94);
    border: 1px solid var(--line);
    border-radius: 10px;
    z-index: 3000;
  }
  /* the filter and the place in the row, floating over the floor */
  /* faded while the app is quiet (a page open, nothing done for a while) */
  .line.quiet {
    opacity: 0;
  }
  .line {
    position: absolute;
    transition: opacity 700ms;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 4000;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 40px;
    padding: 0 18px;
    font: 13px var(--mono);
    background: linear-gradient(to top, rgb(0 0 0 / 0.75), transparent);
  }
  .glow {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    opacity: 0.6;
    pointer-events: none;
  }
  .slash,
  .filter {
    color: var(--accent);
    font-weight: 700;
  }
  input {
    flex: 1;
    background: none;
    border: 0;
    outline: 0;
    font: 15px var(--mono);
  }
  .hint {
    color: var(--text-3);
    font-family: var(--font);
    font-size: 13px;
  }
  .count {
    margin-left: auto;
    color: var(--text-2);
  }
</style>
