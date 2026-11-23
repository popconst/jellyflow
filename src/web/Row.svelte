<!--
  Cover Flow's row: covers (album covers, film posters) side by side on a
  floor, the one in the middle 20% bigger and its neighbours turned towards
  it, each reflected on the floor. It moves with core/motion.ts: a tap glides
  one cover; holding a key runs from the keyboard's first repeat, ever
  faster, and stops on the next cover when let go; scrolling follows the
  trackpad. A page can swing out beside the middle cover, hinged on its
  edge, the row moving over to make room. What the covers are and what's on
  the page are the view's (Coverflow, Watch).
-->
<script module lang="ts">
  /** The middle cover's scale */
  export const FOCUS = 1.2
  /** The row's height: a little room, the middle cover, as much of its reflection as shows (in side-cover heights) */
  const HEIGHT = 0.06 + FOCUS + 0.36

  /** How big the covers are on a stage this size: a side cover's height and width, and where the floor is */
  export function layout(box: { w: number; h: number }, aspect: number): { size: number; width: number; floor: number } {
    const size = Math.max(100, Math.min(box.h / HEIGHT, box.w / (2.7 * aspect)))
    return { size, width: size * aspect, floor: (box.h - HEIGHT * size) / 2 + (0.06 + FOCUS) * size }
  }

  /** Where things are, for what the view draws in and around the row */
  export interface Geometry {
    /** A cover's height at rest at the side, in pixels: the unit everything's measured in */
    size: number
    /** A cover's width */
    width: number
    /** The floor the covers stand on: their bottom edges, where the reflections start */
    floor: number
    /** The stage's size */
    box: { w: number; h: number }
    /** Pixels to ask for a cover moving by */
    thumb: number
  }
</script>

<script lang="ts" generics="T extends { id: string }">
  import { untrack, type Snippet } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { SvelteSet } from 'svelte/reactivity'
  import { keyName } from '../core/keys.ts'
  import { Motion } from '../core/motion.ts'

  /** The row's geometry, in units of a cover's width: the first side cover's place (each next one's is `step`) */
  const GAP = 0.8
  /** How far side covers are turned (degrees) and pushed back (in heights) */
  const TURN = 65
  const DEPTH = 0.25
  /** The side covers' scale */
  const SIDE = 0.7
  /** Covers ahead and behind fetched while the row rests, for a smooth slide */
  const PREFETCH = 24
  /** Scrolled pixels per cover */
  const SCROLL_PX = 45
  /** A glide to a clicked cover has arrived this close (in covers): what it was for can happen */
  const ARRIVED = 0.08

  interface Props {
    items: T[]
    /** A cover's width over its height: 1 for album covers, 2/3 for film posters */
    aspect?: number
    /** The item the row starts at */
    start?: string | undefined
    /** The row being looked at: only it fetches covers ahead, and its middle one sharp */
    active?: boolean
    /** The page beside the middle cover is open: the row makes room, the others step back */
    open?: boolean
    /** How wide the page is: by default as wide as the middle cover is tall */
    pageWidth?: ((g: Geometry) => number) | undefined
    /** How far apart the side covers stand, in cover widths: tightly stacked by default */
    step?: number
    /** At most this many covers drawn on each side */
    reach?: number
    /** How much of the stage's width shows (the view may scale the row): covers are drawn to reach that far */
    span?: number | undefined
    /** How big the row shows (the view may scale it): covers are fetched for that size */
    zoom?: number
    /** The stage's size, if the view sets it (else it's measured) */
    box?: { w: number; h: number } | undefined
    /** How far down a cover's reflection shows, as a share of its height */
    reflection?: number
    /** Scrolling moves the row either way (alone on the page), or only sideways (one row of several) */
    sideways?: boolean
    /** Where the row is, fractional while it moves, and whether it's at rest: told as it changes */
    onmove?: ((pos: number, settled: boolean) => void) | undefined
    /** A cover's art, `px` pixels wide; and its URL at that size, for the sharp one in the middle and prefetching */
    art: Snippet<[T, number]>
    url: (item: T, px: number) => string | undefined
    label: (item: T) => string
    /** A cover clicked, and whether it's the one in the middle: the view decides (glide to it, or open it) */
    onclick: (index: number, middle: boolean) => void
    /** Behind the covers (the floor's glow) */
    under?: Snippet<[Geometry]>
    /** On the page beside the middle cover; elements with data-page scroll */
    beside?: Snippet<[Geometry]>
    /** On each cover (a progress bar) */
    badge?: Snippet<[T]>
    /** Over it all (the caption) */
    over?: Snippet<[Geometry]>
  }
  let {
    items,
    aspect = 1,
    start,
    active = true,
    open = false,
    pageWidth,
    step = 0.13,
    reach = 14,
    span,
    zoom = 1,
    box: given,
    reflection = 0.45,
    sideways = false,
    onmove,
    art,
    url,
    label,
    onclick,
    under,
    beside,
    badge,
    over,
  }: Props = $props()

  let stage = $state<HTMLElement>()
  let measured = $state({ w: 1200, h: 700 })
  const box = $derived(given ?? measured)
  const motion = new Motion()
  /** Where the row is, fractional while it moves */
  let pos = $state(0)
  let settled = $state(true)
  /** The item the row is at, so it stays there when the items change */
  let anchor: string | undefined = untrack(() => start)
  /** The key holding the row moving (its code), let go of to stop it */
  let held: { code: string; dir: -1 | 1 } | undefined
  /** A glide to a clicked cover, and what to do once it's there (open it); any other move drops it */
  let arrival: { index: number; then: () => void } | undefined
  let frame = 0
  let lastFrame = 0
  let wheelTimer: ReturnType<typeof setTimeout> | undefined

  const last = $derived(Math.max(0, items.length - 1))
  const place = $derived(Math.max(0, Math.min(last, Math.round(pos))))

  const fit = $derived(layout(box, aspect))
  const size = $derived(fit.size)
  const width = $derived(fit.width)
  const floor = $derived(fit.floor)
  /** Covers drawn on each side: enough to reach the edges */
  const side = $derived(Math.min(reach, Math.ceil(((span ?? box.w) / 2 / width - GAP) / step) + 2))
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1
  /** Covers moving by are fetched small; the one in the middle sharp once the row stops */
  const thumb = $derived(width * zoom * dpr <= 340 ? 300 : 500)
  const sharp = $derived(Math.min(1200, Math.ceil((width * zoom * FOCUS * dpr) / 200) * 200))
  const geometry = $derived<Geometry>({ size, width, floor, box, thumb })
  const page = $derived(pageWidth?.(geometry) ?? size * FOCUS)

  const visible = $derived.by(() => {
    const from = Math.max(0, Math.floor(pos) - side)
    const to = Math.min(last, Math.ceil(pos) + side)
    const out: { item: T; index: number; offset: number }[] = []
    for (let i = from; i <= to; i++) {
      const item = items[i]
      if (item) out.push({ item, index: i, offset: i - pos })
    }
    return out
  })

  /**
   * Where a cover sits at `offset` covers from the middle (fractional while
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
    const x = n <= 1 ? s * GAP * t : s * (GAP + (n - 1) * step)
    const scale = FOCUS + (SIDE - FOCUS) * t
    return {
      transform: `translate3d(${(x * width).toFixed(2)}px, 0, ${(-DEPTH * t * size).toFixed(2)}px) rotateY(${(-s * TURN * t).toFixed(2)}deg) scale(${scale.toFixed(4)})`,
      edge: t,
      side: s,
      scale,
    }
  }

  /** Sharp covers already loaded, by URL: they stay on while their cover folds away */
  const sharpReady = new SvelteSet<string>()

  /** The sharp cover over this one, if it's (about to be) in the middle */
  function crisp(item: T, index: number, offset: number): string | undefined {
    const near = Math.abs(offset) < 1.5
    if (!near && index !== place) return undefined
    const u = url(item, sharp)
    if (!u) return undefined
    if (sharpReady.has(u)) return near ? u : undefined
    return active && settled && index === place ? u : undefined
  }

  /** The page swinging open from behind the middle cover, hinged on its edge; and shut again */
  function fold(_node: Element) {
    return {
      duration: 650,
      easing: cubicOut,
      css: (t: number) => `transform: rotateY(${(-180 * (1 - t)).toFixed(2)}deg)`,
    }
  }

  function animate(now: number): void {
    const moving = motion.tick(Math.min(0.1, (now - lastFrame) / 1000), items.length)
    lastFrame = now
    pos = motion.pos
    anchor = items[place]?.id
    if (arrival && Math.abs(pos - arrival.index) < ARRIVED) {
      const { then } = arrival
      arrival = undefined
      then()
    }
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

  $effect(() => {
    onmove?.(pos, settled)
  })

  // while the row rests, fetch the covers around it, so sliding on finds them ready
  const fetched = new Set<string>()
  $effect(() => {
    if (!settled || !active) return
    for (let i = Math.max(0, place - PREFETCH); i <= Math.min(last, place + PREFETCH); i++) {
      const item = items[i]
      const u = item && url(item, thumb)
      if (!u || fetched.has(u)) continue
      fetched.add(u)
      const img = new Image()
      img.decoding = 'async'
      img.src = u
    }
    // and the neighbours sharp, so the next step lands on a sharp cover
    for (const i of [place - 1, place + 1]) {
      const item = items[i]
      const u = item && url(item, sharp)
      if (!u || fetched.has(u)) continue
      fetched.add(u)
      const img = new Image()
      img.onload = () => sharpReady.add(u)
      img.src = u
    }
  })

  function snap(index: number): void {
    motion.snap(index)
    pos = motion.pos
  }

  // the items changed (a filter, a reload): stay at the same one, or the same place
  let seen: T[] | undefined
  $effect.pre(() => {
    const list = items
    untrack(() => {
      if (list === seen) return
      seen = list
      const at = anchor ? list.findIndex((x) => x.id === anchor) : -1
      if (at >= 0 && at === place) return
      snap(at >= 0 ? at : Math.min(Math.round(motion.pos), Math.max(0, list.length - 1)))
    })
  })

  /** The index the row is heading to: what keys act on, even mid-glide */
  export function target(): number {
    return Math.max(0, Math.min(last, Math.round(motion.target)))
  }

  /** Stays at item `id` when the items next change (a new filter) */
  export function anchorTo(id: string | undefined): void {
    anchor = id
  }

  /** To `index`: flying there (a key), or gliding, more gently (a click), and `then` once there */
  export function select(index: number, gently = false, then?: () => void): void {
    const to = Math.max(0, Math.min(last, index))
    arrival = then && { index: to, then }
    if (gently) motion.glide(to)
    else motion.jump(to)
    kick()
  }

  /** A tap of the key with `code` moves one cover; its repeat starts a run, until it's let go of */
  export function press(dir: -1 | 1, repeat: boolean, code: string): void {
    held = { code, dir }
    arrival = undefined
    if (repeat) motion.repeat(dir)
    else motion.press(dir)
    kick()
  }

  /** `n` covers on from where it's heading */
  export function nudge(n: number): void {
    arrival = undefined
    motion.nudge(n)
    kick()
  }

  /** The row's own keys: h l (← →) one cover, held to run; H L (PgUp PgDn) ten; g G (Home End) to the ends. Whether it took the key */
  export function key(e: KeyboardEvent): boolean {
    switch (keyName(e)) {
      case 'l':
      case '<Right>':
        press(1, e.repeat, e.code)
        break
      case 'h':
      case '<Left>':
        press(-1, e.repeat, e.code)
        break
      case 'L':
      case '<PageDown>':
        nudge(10)
        break
      case 'H':
      case '<PageUp>':
        nudge(-10)
        break
      case 'g':
      case '<Home>':
        select(0)
        break
      case 'G':
      case '<End>':
        select(last)
        break
      default:
        return false
    }
    return true
  }

  function onkeyup(e: KeyboardEvent): void {
    if (!held || e.code !== held.code) return
    motion.release(held.dir)
    held = undefined
    kick()
  }

  function onblur(): void {
    held = undefined
    motion.releaseAll()
  }

  // the stage's size sets the covers' (unless the view sets it; and not while hidden, at no size at
  // all); scrolling (wheel or trackpad) moves the row
  $effect(() => {
    const el = stage
    if (!el) return
    const resize = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry?.contentRect ?? { width: 0, height: 0 }
      if (w > 0 && h > 0) measured = { w, h }
    })
    if (!given) resize.observe(el)
    const onwheel = (e: WheelEvent) => {
      // the page open: it scrolls (its tracks), the rest stays still
      if (open) {
        if (!(e.target instanceof Element && e.target.closest('[data-page]'))) e.preventDefault()
        return
      }
      const across = Math.abs(e.deltaX) > Math.abs(e.deltaY)
      // one row of several: up and down is the view's (to the next row)
      if (sideways && !across) return
      e.preventDefault()
      arrival = undefined
      const d = across ? e.deltaX : e.deltaY
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

<svelte:window {onkeyup} {onblur} />

<div class="stage" class:open class:moving={!settled} bind:this={stage} style:--reflection="{reflection * 100}%">
  {@render under?.(geometry)}
  <div
    class="row"
    style:perspective="{size * 3}px"
    style:perspective-origin="50% {floor - (size * FOCUS) / 2}px"
    style:transform="translateX({open ? -page / 2 : 0}px)"
  >
    {#each visible as { item, index, offset } (item.id)}
      {@const p = pose(offset)}
      {@const sharpUrl = crisp(item, index, offset)}
      <button
        class="cover"
        class:aside={index !== place}
        data-side={p.side}
        style:width="{width}px"
        style:height="{size}px"
        style:top="{floor - size}px"
        style:margin-left="{-width / 2}px"
        style:transform={p.transform}
        style:--edge={p.edge}
        style:--scale={p.scale}
        onclick={() => onclick(index, index === place)}
        aria-label={label(item)}
      >
        {@render art(item, thumb)}
        {#if sharpUrl}
          <img class="sharp" src={sharpUrl} alt="" decoding="async" onload={() => sharpReady.add(sharpUrl)} />
        {/if}
        {@render badge?.(item)}
        <!-- the reflection on the floor: the cover upside down, fading out -->
        <div class="reflection" aria-hidden="true">
          {@render art(item, thumb)}
        </div>
      </button>
    {/each}

    {#if open && beside}
      <div
        class="page"
        data-page
        transition:fold
        style:left="calc(50% + {(width * FOCUS) / 2}px)"
        style:top="{floor - size * FOCUS}px"
        style:width="{page}px"
        style:height="{size * FOCUS}px"
      >
        {@render beside(geometry)}
      </div>
    {/if}
  </div>

  {@render over?.(geometry)}
</div>

<style>
  .stage {
    position: relative;
    height: 100%;
    overflow: hidden;
    /* how far a cover under the pointer rises */
    --lift: calc(12px * var(--unscale, 1));
  }
  /* one 3D scene: the covers are sorted by depth, not by a fixed order (no overflow
     here, or the browser flattens it) */
  .row {
    position: absolute;
    inset: 0;
    transform-style: preserve-3d;
    /* clicks go through it to the covers behind its plane (the side ones are pushed back) */
    pointer-events: none;
    transition: transform 650ms cubic-bezier(0.22, 0.61, 0.36, 1);
  }
  .cover {
    position: absolute;
    left: 50%;
    pointer-events: auto;
    padding: 0;
    border: 0;
    background: none;
    /* turned and scaled about the bottom edge: every cover stands on the floor */
    transform-origin: 50% 100%;
    will-change: transform;
    cursor: pointer;
    transition:
      opacity 450ms,
      translate 220ms cubic-bezier(0.22, 0.61, 0.36, 1);
  }
  /* a side cover under the pointer, the row at rest, rises off the floor (its reflection sinking as
     far, as on a mirror) and is lit a little: a click opens it. --lift is in the stage's pixels: a
     row the view shows scaled down (--unscale) rises as far on screen */
  .stage:not(.moving) .cover.aside:hover {
    translate: 0 calc(-1 * var(--lift));
  }
  .stage:not(.moving) .cover.aside:hover .reflection {
    translate: 0 calc(2 * var(--lift) / var(--scale));
  }
  .stage:not(.moving) .cover.aside:hover::after {
    opacity: calc(var(--edge) * 0.35);
  }
  /* the page open: the others step back into the dark, out of reach (a click there is a click away) */
  .open .cover.aside {
    opacity: 0.12;
    pointer-events: none;
  }
  /* the ones on the right are behind it; their outer edges lean out far
     enough to poke through it, so they go altogether */
  .open .cover.aside[data-side='1'] {
    opacity: 0;
  }
  .page {
    position: absolute;
    pointer-events: auto;
    /* hinged on the cover's right edge; while folded behind it, its back shows nothing.
       A 3D layer even when open, so it's sorted in front of the covers behind it */
    transform-origin: 0 50%;
    transform: rotateY(0deg);
    will-change: transform;
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
  }
  .reflection {
    position: absolute;
    top: calc(100% + 1px);
    left: 0;
    width: 100%;
    height: 100%;
    transform: scaleY(-1);
    pointer-events: none;
    transition: translate 220ms cubic-bezier(0.22, 0.61, 0.36, 1);
    /* fading out by --reflection of the way down */
    -webkit-mask-image: linear-gradient(to top, rgb(0 0 0 / 0.3), transparent var(--reflection, 45%));
    mask-image: linear-gradient(to top, rgb(0 0 0 / 0.3), transparent var(--reflection, 45%));
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
</style>
