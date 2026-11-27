<!--
  Rows of posters, Netflix style, each a Cover Flow row (Row.svelte): what
  Watch and Discover show. The row with the keys is bigger, its name big
  above it and a caption under its middle poster; the next rows wait smaller
  below; j and k (or scrolling) go from row to row (down from the last, the
  view may have more: onend). Enter opens the middle poster's page: its row
  comes forward, full size, and the page swings out beside the poster. Behind it all, dimly, the backdrop of what the row rests
  on. Where each row was left is remembered. What the posters, captions,
  marks and pages are is the view's.
-->
<script module lang="ts">
  /** One row: its name over it, its posters */
  export interface Rail<T> {
    /** The same across reloads: where the row was left is kept by it */
    key: string
    name: string
    items: T[]
    /** Passing through (search results): where it was isn't remembered */
    passing?: boolean
  }
</script>

<script lang="ts" generics="T extends { id: string }">
  import { untrack, type Snippet } from 'svelte'
  import { keyName } from '../core/keys.ts'
  import Row, { FOCUS, layout, type Geometry } from './Row.svelte'
  import { app, store, stored, typing } from './state.svelte.ts'

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
  /** Above each row its name: big over the row with the keys, so there's no doubt which it is; under that one, the caption (px) */
  const LABEL = 30
  const LABEL_ON = 54
  const CAPTION = 104
  const GAP = 4
  /** Rows on the page around the one with the keys: one above, to go back up to; three below */
  const ABOVE = 1
  const BELOW = 3
  /** Scrolled pixels to the next row */
  const WHEEL_ROW = 60

  interface Props {
    rails: Rail<T>[]
    /** Where the rows were left is kept in localStorage under this */
    remember: string
    /** The view is showing: the keys are its */
    shown: boolean
    /** The page beside the middle poster is open */
    open?: boolean
    /** The row with the keys, by key */
    focusKey?: string | undefined
    /** A poster's URL at a width, its art, and its name for the row */
    url: (item: T, px: number) => string | undefined
    art: Snippet<[T, number]>
    label: (item: T) => string
    /** On each poster (a mark, how far into it) */
    badge?: Snippet<[T]>
    /** Under the row with the keys: about what it's resting on */
    caption: Snippet<[T]>
    /** An opened poster's page, as wide as this many poster heights */
    page: Snippet<[T]>
    pageWide?: (item: T) => number
    /** The open page's keys first: 'close' shuts it, 'pass' leaves the key to the row (on to the next, the page shut) */
    pageKey?: (key: string, repeat: boolean) => 'handled' | 'close' | 'pass'
    /** The picture behind it all, for what the row rests on */
    backdrop?: (item: T) => string | undefined
    /** The view's own keys, before the rows': whether it took it */
    onkey?: (key: string, e: KeyboardEvent) => boolean
    /** Down from the last row: more rows, should the view have them */
    onend?: () => void
    /** When there are no rows */
    empty: Snippet
    /** Along the foot (the search line) */
    children?: Snippet
  }
  let {
    rails,
    remember,
    shown,
    open = $bindable(false),
    focusKey = $bindable(),
    url,
    art,
    label,
    badge,
    caption,
    page,
    pageWide = () => 1.15,
    pageKey = () => 'close',
    backdrop,
    onkey,
    onend,
    empty,
    children,
  }: Props = $props()

  interface Saved {
    shelf?: string | undefined
    /** Each row's item, by the row's key */
    at?: Record<string, string>
  }
  const saved = untrack(() => stored<Saved>(remember)) ?? {}
  /** Where each row was: rows taken off the page (out of sight) come back there */
  const at: Record<string, string> = { ...saved.at }
  if (focusKey === undefined) focusKey = saved.shelf

  let section = $state<HTMLElement>()
  let box = $state({ w: 1200, h: 700 })
  let lastFocus = 0
  /** Each row's place (fractional while it moves) and whether it's at rest */
  let poses = $state<Record<string, number>>({})
  let rests = $state<Record<string, boolean>>({})
  let rows = $state<Record<string, Row<T> | undefined>>({})
  /** The opened item, by its row and id; kept as it was, should it leave its row while its page folds shut */
  let openedAt = $state<{ rail: string; id: string } | undefined>()
  let openedLast = $state.raw<T | undefined>()

  const focus = $derived.by(() => {
    const i = rails.findIndex((r) => r.key === focusKey)
    return i >= 0 ? i : Math.max(0, Math.min(lastFocus, rails.length - 1))
  })
  /** The rows on the page: the one with the keys and those around it */
  const near = $derived(rails.map((r, i) => ({ r, i })).filter(({ i }) => i >= focus - ABOVE && i <= focus + BELOW))
  const rail = $derived<Rail<T> | undefined>(rails[focus])
  const place = $derived(rail ? Math.max(0, Math.min(rail.items.length - 1, Math.round(poses[rail.key] ?? 0))) : 0)
  const item = $derived<T | undefined>(rail?.items[place])
  const settled = $derived(rail ? (rests[rail.key] ?? true) : true)
  const opened = $derived.by(() => {
    const o = openedAt
    return (o && rails.find((r) => r.key === o.rail)?.items.find((t) => t.id === o.id)) ?? openedLast
  })

  /** Every row's stage, full size: as tall as the view, wide enough that a small one still spans it */
  const stage = $derived({ w: box.w / SMALL, h: Math.max(240, box.h - 8) })
  const fit = $derived(layout(stage, ASPECT))
  /** The scale that makes the row with the keys SHARE of the view (an opened one's is full size) */
  const zoomed = $derived(Math.max(SMALL, Math.min(1, (box.h * SHARE - LABEL_ON - CAPTION - 6) / (fit.floor + BELOW_FLOOR * fit.size))))

  $effect(() => {
    lastFocus = focus
  })

  // where the rows rest is remembered, for the next visit
  $effect(() => {
    if (settled && rail && !rail.passing) store(remember, { shelf: rail.key, at } satisfies Saved)
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
      if (open || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
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

  /** How tall a row's name is */
  function labelHeight(i: number): number {
    return i === focus ? LABEL_ON : LABEL
  }

  /** How big a row shows */
  function zoom(i: number): number {
    if (i === focus) return open ? 1 : zoomed
    return SMALL
  }

  /** A row's height on the page: its name, its posters down to a little of their reflection, the caption under the one with the keys */
  function tall(i: number): number {
    return labelHeight(i) + (fit.floor + BELOW_FLOOR * fit.size) * zoom(i) + (i === focus ? CAPTION : 0)
  }

  /** Where each row on the page stands: the one with the keys at the top (an opened one fills the view), the rest stacked around it */
  const tops = $derived.by(() => {
    const y = new Map<number, number>()
    y.set(focus, open ? -LABEL_ON : 4)
    for (let i = focus + 1; i <= Math.min(rails.length - 1, focus + BELOW); i++) y.set(i, (y.get(i - 1) ?? 0) + tall(i - 1) + GAP)
    for (let i = focus - 1; i >= Math.max(0, focus - ABOVE); i--) y.set(i, (y.get(i + 1) ?? 0) - tall(i) - GAP)
    return y
  })

  /** An opened page: as wide as there's room for, up to its share */
  function pageWidth(g: Geometry): number {
    const room = box.w - g.width * FOCUS - 64
    return Math.max(240, Math.min(room, g.size * FOCUS * (opened ? pageWide(opened) : 1.15)))
  }

  /** The item the row with the keys is heading to: what keys act on, even mid-glide */
  function heading(): T | undefined {
    if (!rail) return undefined
    return rail.items[rows[rail.key]?.target() ?? place]
  }

  /** The row with the keys and the item it's heading to */
  export function current(): { rail: Rail<T>; item: T | undefined } | undefined {
    return rail && { rail, item: heading() }
  }

  /** Puts the keys on a row, at an item (one just put back in it) */
  export function show(key: string, id: string): void {
    rows[key]?.anchorTo(id)
    at[key] = id
    focusKey = key
  }

  /** Moves a row as an arrow key would (while typing a search) */
  export function press(key: string, dir: -1 | 1, repeat: boolean, code: string): void {
    rows[key]?.press(dir, repeat, code)
  }

  function toRow(i: number): void {
    if (i >= rails.length && rails.length) onend?.()
    const to = Math.max(0, Math.min(rails.length - 1, i))
    if (to === focus) return
    const now = heading()
    if (rail && now && !rail.passing) at[rail.key] = now.id
    focusKey = rails[to]?.key
  }

  function openPage(): void {
    const t = heading()
    if (!t || !rail) return
    openedAt = { rail: rail.key, id: t.id }
    openedLast = t
    open = true
  }

  export function closePage(): void {
    open = false
  }

  /** A poster clicked, in any row: its row comes forward and glides to it, and it opens once there; the open one's poster shuts it again */
  function clickTile(row: number, index: number, middle: boolean): void {
    const key = rails[row]?.key
    if (!key) return
    if (row === focus && open) {
      closePage()
      if (middle) return
    }
    toRow(row)
    if (middle) openPage()
    else rows[key]?.select(index, true, openPage)
  }

  /** The rows' own keys: up and down, opening */
  function railKey(key: string, repeat: boolean): boolean {
    switch (key) {
      case 'j':
      case '<Down>':
        toRow(focus + 1)
        return true
      case 'k':
      case '<Up>':
        toRow(focus - 1)
        return true
      case '<Enter>':
        if (!repeat) openPage()
        return true
      default:
        return false
    }
  }

  function onkeydown(e: KeyboardEvent): void {
    if (!shown || typing(e) || e.defaultPrevented || app.help) return
    const key = keyName(e)
    if (!key) return
    const row = rail && rows[rail.key]
    let handled: boolean
    if (open) {
      const answer = pageKey(key, e.repeat)
      handled = answer !== 'pass'
      if (answer === 'close') closePage()
      // a film's page leaves the row's keys to the row: on to another film, the page shut
      else if (answer === 'pass' && row?.key(e)) {
        closePage()
        handled = true
      }
    } else handled = (onkey?.(key, e) ?? false) || railKey(key, e.repeat) || (row?.key(e) ?? false)
    if (handled) e.preventDefault()
  }

  function moved(key: string, items: T[], pos: number, rest: boolean, passing: boolean): void {
    poses[key] = pos
    rests[key] = rest
    const t = items[Math.round(pos)]
    if (rest && t && !passing) at[key] = t.id
  }

  /**
   * Behind it all, dimly: the backdrop of what the row rests on. Once the
   * row has rested a moment and the picture is loaded, it fades in over the
   * one before, which stays until it's covered: no dip to black between
   * them, no picture popping in halfway.
   */
  interface Layer {
    key: number
    url: string
  }
  let layers = $state.raw<Layer[]>([])
  let layerKey = 0
  $effect(() => {
    const url = settled && item ? backdrop?.(item) : undefined
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

<section class="rails" class:open bind:this={section}>
  <!-- each picture opaque, fading in over the last; the stack dimmed as one, so a covered one goes unseen -->
  <div class="backdrops">
    {#each layers as layer (layer.key)}
      <img class="backdrop" src={layer.url} alt="" onanimationend={() => covered(layer.key)} />
    {/each}
  </div>

  {#each near as { r, i } (r.key)}
    {@const scale = zoom(i)}
    <div
      class="rail"
      class:focused={i === focus}
      class:away={(open && i !== focus) || i < focus}
      style:transform="translateY({tops.get(i) ?? 0}px)"
      style:height="{labelHeight(i) + stage.h * scale}px"
    >
      <div
        class="scaler"
        style:width="{stage.w}px"
        style:height="{stage.h}px"
        style:margin-left="{-stage.w / 2}px"
        style:top="{labelHeight(i)}px"
        style:transform="scale({scale})"
      >
        <Row
          bind:this={rows[r.key]}
          items={r.items}
          aspect={ASPECT}
          start={at[r.key]}
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
          onmove={(pos, rest) => moved(r.key, r.items, pos, rest, r.passing ?? false)}
          {url}
          {label}
          {art}
          {badge}
          onclick={(index, middle) => clickTile(i, index, middle)}
          onfloor={closePage}
        >
          <!-- kept while the page folds shut again -->
          {#snippet beside()}
            {#if opened}
              {#key opened.id}{@render page(opened)}{/key}
            {/if}
          {/snippet}
        </Row>
      </div>
      {#if i === focus}
        <div class="caption" style:top="{labelHeight(i) + fit.floor * scale + 10}px">
          {#if item}{@render caption(item)}{/if}
        </div>
      {/if}
    </div>
  {/each}

  <!-- the sides darker: one gradient over all the rows; their names over it -->
  <div class="vignette" aria-hidden="true"></div>
  {#each near as { r, i } (r.key)}
    <h2
      class="name"
      class:focused={i === focus}
      class:away={(open && i !== focus) || i < focus}
      style:transform="translateY({tops.get(i) ?? 0}px)"
    >
      {r.name}
      {#if i === focus && r.items.length}<span class="count">{place + 1} / {r.items.length}</span>{/if}
    </h2>
  {/each}

  {#if !rails.length}
    <div class="empty">{@render empty()}</div>
  {/if}

  {@render children?.()}
</section>

<style>
  .rails {
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
  /* out of the way: the rows of an opened one's, and the one above (it's there to glide back down) */
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
    /* back once the page has swung shut, not over it */
    transition: opacity 300ms 450ms;
  }
  .open .caption {
    opacity: 0;
    transition-delay: 0ms;
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
