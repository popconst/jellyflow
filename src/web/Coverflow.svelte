<!--
  Cover Flow: the albums in a row, the one in the middle 20% bigger and its
  neighbours turned towards it. The row moves with core/motion.ts: a tap
  glides one album; holding a key runs from the keyboard's first repeat,
  ever faster, and stops on the next album when let go; scrolling follows the
  trackpad. Modes: browse, search (/), the open album (Enter: it opens like a
  gatefold sleeve, its tracks on a page that swings out to the right, the
  spectrum of what's playing on the floor under it) and the details (i).
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { SvelteSet } from 'svelte/reactivity'
  import { duration, links } from '../core/details.ts'
  import { keyName } from '../core/keys.ts'
  import { filter as find, toTrack, type Album, type Found, type Track } from '../core/library.ts'
  import { Motion } from '../core/motion.ts'
  import Cover from './Cover.svelte'
  import Details from './Details.svelte'
  import { player } from './player.svelte.ts'
  import { app, store, stored, typing } from './state.svelte.ts'
  import TrackList from './TrackList.svelte'
  import Visualizer from './Visualizer.svelte'
  import { PALETTE_PX } from './palette.ts'

  /** The row's geometry, in units of `size`: the first side cover's place, then each next one's */
  const GAP = 0.8
  const STEP = 0.13
  /** How far side covers are turned (degrees) and pushed back */
  const TURN = 65
  const DEPTH = 0.25
  /** The middle cover's scale, and the others' */
  const FOCUS = 1.2
  const SIDE = 0.7
  /** The row's height: a little room, the middle cover, as much of its reflection as shows */
  const HEIGHT = 0.06 + FOCUS + 0.36
  /** The open album's page: the share of it the spectrum stands in (the tracks above) */
  const SPECTRUM = 0.42
  /** Covers ahead and behind fetched while the row rests, for a smooth slide */
  const PREFETCH = 24
  /** Scrolled pixels per album */
  const SCROLL_PX = 45
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
  let stage = $state<HTMLElement>()
  let box = $state({ w: 1200, h: 700 })

  const motion = new Motion()
  /** Where the row is, fractional while it moves */
  let pos = $state(0)
  let settled = $state(true)
  /** The album the row is at, so it stays there when the row's albums change (and after a reload) */
  let anchor: string | undefined = resume?.albumId ?? saved?.id
  let frame = 0
  let lastFrame = 0
  let wheelTimer: ReturnType<typeof setTimeout> | undefined
  /** The album opened with j, kept while its page folds shut again */
  let opened = $state.raw<{ album: Album; tracks: Track[] } | undefined>()
  /** Where c came from, for o to go back to (and o again to return) */
  let back: { id: string; filter: string } | undefined

  const found = $derived.by(() => {
    void app.titlesVersion
    return find(app.albums, applied, app.titles)
  })
  const last = $derived(Math.max(0, found.length - 1))
  const place = $derived(Math.max(0, Math.min(last, Math.round(pos))))
  const current = $derived<Found | undefined>(found[place])
  const album = $derived(current ? app.albums[current.index] : undefined)
  const filtered = $derived(applied.trim() !== '')

  /** The unit everything's measured in: as big as the space allows */
  const size = $derived(Math.max(100, Math.min(box.h / HEIGHT, box.w / 2.7)))
  /** The floor the covers stand on: their bottom edges, where the reflections start */
  const floor = $derived((box.h - HEIGHT * size) / 2 + (0.06 + FOCUS) * size)
  /** Covers drawn on each side: enough to reach the edges */
  const side = $derived(Math.min(14, Math.ceil((box.w / 2 / size - GAP) / STEP) + 2))
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1
  /** Covers moving by are fetched small; the one in the middle sharp once the row stops */
  const thumb = $derived(size * dpr <= 340 ? 300 : 500)
  const sharp = $derived(Math.min(1200, Math.ceil((size * FOCUS * dpr) / 200) * 200))

  const visible = $derived.by(() => {
    const from = Math.max(0, Math.floor(pos) - side)
    const to = Math.min(last, Math.ceil(pos) + side)
    const out: { album: Album; index: number; offset: number }[] = []
    for (let i = from; i <= to; i++) {
      const a = app.albums[found[i]?.index ?? -1]
      if (a) out.push({ album: a, index: i, offset: i - pos })
    }
    return out
  })

  /**
   * Where a cover sits at `offset` albums from the middle (fractional while
   * moving). Sliding out of the middle it folds: it turns to face the middle
   * (its inner edge going back, like a page of an open book), shrinks to SIDE
   * and steps back, all continuously; further out it only slides along. The
   * browser sorts the covers by their real depth, so two covers crossing in
   * the middle fold through each other instead of swapping places.
   * Transforms only: the compositor moves them without repainting.
   */
  function pose(offset: number) {
    const s = Math.sign(offset)
    const n = Math.abs(offset)
    const t = Math.min(1, n)
    const x = n <= 1 ? s * GAP * t : s * (GAP + (n - 1) * STEP)
    const scale = FOCUS + (SIDE - FOCUS) * t
    return {
      transform: `translate3d(${(x * size).toFixed(2)}px, 0, ${(-DEPTH * t * size).toFixed(2)}px) rotateY(${(-s * TURN * t).toFixed(2)}deg) scale(${scale.toFixed(4)})`,
      edge: t,
      side: s,
    }
  }

  /** Sharp covers already loaded, by URL: they stay on while their cover folds away */
  const sharpReady = new SvelteSet<string>()

  /** The sharp cover over this one, if it's (about to be) in the middle */
  function crisp(a: Album, index: number, offset: number): string | undefined {
    if (!a.imageTag || !app.client) return undefined
    const url = app.client.imageUrl(a.id, a.imageTag, sharp)
    if (sharpReady.has(url)) return Math.abs(offset) < 1.5 ? url : undefined
    return settled && index === place ? url : undefined
  }

  function idAt(index: number): string | undefined {
    const f = found[index]
    return f ? app.albums[f.index]?.id : undefined
  }

  /** The album the row is heading to: what keys act on, even mid-glide */
  function chosen(): { album: Album; found: Found } | undefined {
    const f = found[Math.max(0, Math.min(last, Math.round(motion.target)))]
    const a = f && app.albums[f.index]
    return a && f ? { album: a, found: f } : undefined
  }

  function animate(now: number): void {
    const moving = motion.tick(Math.min(0.1, (now - lastFrame) / 1000), found.length)
    lastFrame = now
    pos = motion.pos
    anchor = idAt(place)
    frame = moving ? requestAnimationFrame(animate) : 0
    settled = !moving
  }

  /** Starts the row moving, if it isn't */
  function kick(): void {
    settled = false
    if (frame) return
    lastFrame = performance.now()
    frame = requestAnimationFrame(animate)
  }

  $effect(() => () => cancelAnimationFrame(frame))

  // after a reload with something playing: its album opened, once the row has got there
  let opening = resume !== undefined
  $effect(() => {
    if (!opening || !resume || !found.length) return
    if (chosen()?.album.id !== resume.albumId) return
    opening = false
    void openTracks()
  })

  // where the row rests is remembered, for the next visit
  $effect(() => {
    if (!settled) return
    const id = idAt(place)
    if (id) store('jellyflow.flow', { id, filter: applied })
  })

  // while the row rests, fetch the covers around it, so sliding on finds them ready
  const fetched = new Set<string>()
  $effect(() => {
    const client = app.client
    if (!settled || !client) return
    for (let i = Math.max(0, place - PREFETCH); i <= Math.min(last, place + PREFETCH); i++) {
      const a = app.albums[found[i]?.index ?? -1]
      if (!a?.imageTag) continue
      const url = client.imageUrl(a.id, a.imageTag, thumb)
      if (fetched.has(url)) continue
      fetched.add(url)
      const img = new Image()
      img.decoding = 'async'
      img.src = url
    }
    // and the neighbours sharp, so the next step lands on a sharp cover
    for (const i of [place - 1, place + 1]) {
      const a = app.albums[found[i]?.index ?? -1]
      if (!a?.imageTag) continue
      const url = client.imageUrl(a.id, a.imageTag, sharp)
      if (fetched.has(url)) continue
      fetched.add(url)
      const img = new Image()
      img.onload = () => sharpReady.add(url)
      img.src = url
    }
  })

  function snap(index: number): void {
    motion.snap(index)
    pos = motion.pos
  }

  // the row's albums changed (a filter, a reload): stay at the same album, or the same place
  let seen: Found[] | undefined
  $effect.pre(() => {
    const f = found
    untrack(() => {
      if (f === seen) return
      seen = f
      const at = anchor ? f.findIndex((x) => app.albums[x.index]?.id === anchor) : -1
      if (at >= 0 && at === place) return
      snap(at >= 0 ? at : Math.min(Math.round(motion.pos), Math.max(0, f.length - 1)))
    })
  })

  function select(index: number): void {
    motion.jump(Math.max(0, Math.min(last, index)))
    kick()
  }

  /** h / l: a tap moves one album; the keyboard's repeat starts a run */
  function press(dir: -1 | 1, repeat: boolean): void {
    if (repeat) motion.repeat(dir)
    else motion.press(dir)
    kick()
  }

  function onkeyup(e: KeyboardEvent): void {
    const key = e.key.toLowerCase()
    if (key === 'h' || key === 'arrowleft' || key === 'arrowup') motion.release(-1)
    else if (key === 'l' || key === 'arrowright' || key === 'arrowdown') motion.release(1)
    else return
    kick()
  }

  /** The row for the query, at album `keep` if it's in it, else the first match (no glide) */
  function applyFilter(keep: string | undefined): void {
    clearTimeout(filterTimer)
    filterTimer = undefined
    applied = query
    const at = keep ? found.findIndex((f) => app.albums[f.index]?.id === keep) : -1
    anchor = idAt(at >= 0 ? at : 0)
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
      press(-1, e.repeat)
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      pending()
      press(1, e.repeat)
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

  /** The page swinging open from behind the cover, hinged on its right edge; and shut again */
  function fold(_node: Element) {
    return {
      duration: 650,
      easing: cubicOut,
      css: (t: number) => `transform: rotateY(${(-180 * (1 - t)).toFixed(2)}deg)`,
    }
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
    const at = found.findIndex((f) => app.albums[f.index]?.id === id)
    if (at >= 0) select(at)
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
        applyFilter(anchor)
        break
      case 'l':
      case '<Right>':
        press(1, repeat)
        break
      case 'h':
      case '<Left>':
        press(-1, repeat)
        break
      case 'L':
      case '<PageDown>':
        motion.nudge(10)
        kick()
        break
      case 'H':
      case '<PageUp>':
        motion.nudge(-10)
        kick()
        break
      case 'g':
      case '<Home>':
        select(0)
        break
      case 'G':
      case '<End>':
        select(last)
        break
      case 'i':
        if (!repeat) mode = { kind: 'info' }
        break
      case '/':
        // the current filter, to refine or replace
        query = applied
        mode = { kind: 'search', from: anchor, prev: applied }
        break
      case 'c':
        jumpToPlaying()
        break
      case 'o':
        jumpBack()
        break
      case '<Enter>':
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
      // flipping to another album closes the list
      case 'h':
      case '<Left>':
        mode = BROWSE
        press(-1, repeat)
        break
      case 'l':
      case '<Right>':
        mode = BROWSE
        press(1, repeat)
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
      // the panel follows the row
      case 'h':
      case '<Left>':
        press(-1, repeat)
        break
      case 'l':
      case '<Right>':
        press(1, repeat)
        break
      case '<Enter>':
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
    const handled =
      mode.kind === 'tracks'
        ? tracksKey(key, e.repeat, mode)
        : mode.kind === 'info'
          ? infoKey(key, e.repeat)
          : browseKey(key, e.repeat)
    if (handled) e.preventDefault()
  }

  function clickCover(index: number): void {
    if (Math.abs(index - pos) >= 0.5) {
      if (mode.kind === 'tracks') mode = BROWSE
      select(index)
    } else if (mode.kind === 'tracks') mode = BROWSE
    else void openTracks()
  }

  // the stage's size sets the covers'; scrolling (wheel or trackpad, either direction) moves the row
  $effect(() => {
    const el = stage
    if (!el) return
    const resize = new ResizeObserver(([entry]) => {
      if (entry) box = { w: entry.contentRect.width, h: entry.contentRect.height }
    })
    resize.observe(el)
    const onwheel = (e: WheelEvent) => {
      // an open album: the page scrolls its tracks, the rest stays still
      if (mode.kind === 'tracks') {
        if (!(e.target instanceof Element && e.target.closest('.page'))) e.preventDefault()
        return
      }
      e.preventDefault()
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      motion.scroll((d * (e.deltaMode === 1 ? 30 : 1)) / SCROLL_PX)
      clearTimeout(wheelTimer)
      wheelTimer = setTimeout(() => {
        motion.settle()
        kick()
      }, 140)
      kick()
    }
    el.addEventListener('wheel', onwheel, { passive: false })
    return () => {
      resize.disconnect()
      el.removeEventListener('wheel', onwheel)
    }
  })
</script>

<svelte:window {onkeydown} {onkeyup} onblur={() => motion.releaseAll()} />

<section class="flow" class:open={mode.kind === 'tracks'} class:info={mode.kind === 'info'}>
  <div class="stage" bind:this={stage}>
    <!-- the floor glows with what's playing, in its album's colours, under the covers'
         reflections, whichever album is in the middle (an open album has its own
         spectrum, on its page, only when it's the one playing) -->
    {#if mode.kind !== 'tracks' && player.current && app.client}
      {@const playing = player.current}
      <div class="glow" style:height="{Math.max(40, (box.h - floor) * 0.8)}px">
        <Visualizer
          art={playing.imageTag ? app.client.imageUrl(playing.albumId, playing.imageTag, PALETTE_PX) : undefined}
          reflex={0}
        />
      </div>
    {/if}
    <div
      class="row"
      style:perspective="{size * 3}px"
      style:perspective-origin="50% {floor - (size * FOCUS) / 2}px"
      style:transform="translateX({mode.kind === 'tracks' ? (-size * FOCUS) / 2 : 0}px)"
    >
      {#each visible as { album: a, index, offset } (a.id)}
        {@const p = pose(offset)}
        {@const sharpUrl = crisp(a, index, offset)}
        <button
          class="cover"
          class:aside={index !== place}
          data-side={p.side}
          style:width="{size}px"
          style:height="{size}px"
          style:top="{floor - size}px"
          style:margin-left="{-size / 2}px"
          style:transform={p.transform}
          style:--edge={p.edge}
          onclick={() => clickCover(index)}
          aria-label="{a.title} by {a.artist}"
        >
          <Cover id={a.id} tag={a.imageTag} size={thumb} title={a.title} lazy={false} />
          {#if sharpUrl}
            <img class="sharp" src={sharpUrl} alt="" decoding="async" onload={() => sharpReady.add(sharpUrl)} />
          {/if}
          <!-- the reflection on the floor: the cover upside down, fading out -->
          <div class="reflection" aria-hidden="true">
            <Cover id={a.id} tag={a.imageTag} size={thumb} lazy={false} />
          </div>
        </button>
      {/each}

      <!-- Enter: the album's page, swung out from behind the cover like a gatefold
           sleeve. Second only to the cover, the spectrum of what's playing stands
           in its lower part, on the same floor as the cover, its reflection on
           the floor below like the cover's; the tracks are above it -->
      {#if mode.kind === 'tracks' && opened}
        {@const o = opened}
        {@const art = o.album.imageTag && app.client ? app.client.imageUrl(o.album.id, o.album.imageTag, thumb) : undefined}
        {@const pageH = size * FOCUS}
        {@const barsH = pageH * SPECTRUM}
        {@const mirrorH = Math.max(0, Math.min(size * 0.3, box.h - floor - 6))}
        <!-- the spectrum only for the album playing; otherwise the tracks have the page -->
        {@const live = player.current?.albumId === o.album.id}
        <div
          class="page"
          transition:fold
          style:left="calc(50% + {(size * FOCUS) / 2}px)"
          style:top="{floor - size * FOCUS}px"
          style:width="{size * FOCUS}px"
          style:height="{size * FOCUS}px"
        >
          <div class="sheet">
            {#if art}<img class="page-art" src={art} alt="" />{/if}
            <header>
              <div class="page-title">{o.album.title}</div>
              <div class="page-sub">
                {o.album.artist || 'Unknown artist'}{o.album.year ? ` · ${o.album.year}` : ''} · {o.tracks.length}
                {o.tracks.length === 1 ? 'track' : 'tracks'} · {duration(o.tracks.reduce((sum, t) => sum + t.seconds, 0))}
              </div>
            </header>
            <TrackList tracks={o.tracks} cursor={mode.cursor} onplay={playFrom} />
            <div class="stand" style:flex-basis="{live ? barsH : 0}px"></div>
          </div>
          <div
            class="spectrum"
            class:quiet={!live}
            style:top="{pageH - barsH}px"
            style:height="{barsH + mirrorH}px"
          >
            <Visualizer
              art={o.album.imageTag && app.client
                ? app.client.imageUrl(o.album.id, o.album.imageTag, PALETTE_PX)
                : undefined}
              reflex={mirrorH / (barsH + mirrorH)}
              active={live}
            />
          </div>
        </div>
      {/if}
    </div>

    <div class="vignette"></div>

    <div class="caption" style:top="{Math.min(floor + 16, box.h - 110)}px">
      {#if album}
        <div class="title">{album.title}</div>
        <div class="sub">{album.artist || 'Unknown artist'}{album.year ? ` · ${album.year}` : ''}</div>
      {:else if app.loading}
        <div class="sub">Loading {app.loading}…</div>
      {:else if app.albums.length}
        <div class="sub">No album matches “{applied}”</div>
      {/if}
    </div>
  </div>

  {#if mode.kind === 'info' && album}
    <aside class="details"><Details {album} /></aside>
  {/if}

  <div class="line">
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
  .stage {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }
  .flow.info .stage {
    margin-right: var(--panel-w);
  }
  /* one 3D scene: the covers are sorted by depth, not by a fixed order (no overflow
     here, or the browser flattens it) */
  .row {
    position: absolute;
    inset: 0;
    transform-style: preserve-3d;
    transition: transform 650ms cubic-bezier(0.22, 0.61, 0.36, 1);
  }
  /* an open album: the others step back into the dark */
  .cover {
    transition: opacity 450ms;
  }
  .flow.open .cover.aside {
    opacity: 0.12;
  }
  /* the ones on the right are behind the page; their outer edges lean out far
     enough to poke through it, so they go altogether */
  .flow.open .cover.aside[data-side='1'] {
    opacity: 0;
  }
  .flow.open .caption,
  .flow.open .vignette {
    opacity: 0;
  }
  .page {
    position: absolute;
    /* hinged on the cover's right edge; while folded behind it, its back shows nothing.
       A 3D layer even when open, so it's sorted in front of the covers behind it */
    transform-origin: 0 50%;
    transform: rotateY(0deg);
    will-change: transform;
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
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
  .cover {
    position: absolute;
    left: 50%;
    padding: 0;
    border: 0;
    background: none;
    /* turned and scaled about the bottom edge: every cover stands on the floor */
    transform-origin: 50% 100%;
    will-change: transform;
  }
  .reflection {
    position: absolute;
    top: calc(100% + 1px);
    left: 0;
    width: 100%;
    height: 100%;
    transform: scaleY(-1);
    pointer-events: none;
    -webkit-mask-image: linear-gradient(to top, rgb(0 0 0 / 0.3), transparent 45%);
    mask-image: linear-gradient(to top, rgb(0 0 0 / 0.3), transparent 45%);
  }
  /* further out is darker: one still gradient over the row, not a filter per cover */
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
  .sharp {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  /* each side cover shaded; how much shows as it leaves the middle (--edge) */
  .cover::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: var(--edge);
  }
  /* the edge turned away (the inner one) is darker */
  .cover[data-side='-1']::after {
    background: linear-gradient(to right, transparent 35%, rgb(0 0 0 / 0.5));
  }
  .cover[data-side='1']::after {
    background: linear-gradient(to left, transparent 35%, rgb(0 0 0 / 0.5));
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
  .line {
    position: absolute;
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
    transition: opacity 500ms;
  }
  .flow.open .glow {
    opacity: 0;
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
