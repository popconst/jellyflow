<!--
  Discover: films or series (Shift-Tab, the header's two) beyond the
  library, from TMDB through jellyflow's server (discover.svelte.ts), in
  rows like Watch's (Rails.svelte), each the best scored first: your
  wishlist, then the best of this year and the three before, without what's
  in the library, wished for or not of interest; down from the last row, the
  year before it is asked for. / searches all of TMDB by title. Enter opens
  a title's page (DiscoverPage.svelte); w puts it on the wishlist or takes
  it off; x: not interested, u puts it back. What's in the library has a
  tick, what's wished for a heart.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import { byScore, type Kind } from '../core/discover.ts'
  import Caption from './Caption.svelte'
  import { discover, pick, type Pick } from './discover.svelte.ts'
  import DiscoverPage from './DiscoverPage.svelte'
  import Mark from './Mark.svelte'
  import Poster from './Poster.svelte'
  import Rails, { type Rail } from './Rails.svelte'
  import { FOLD } from './Row.svelte'
  import SearchLine from './SearchLine.svelte'
  import { app, store, stored } from './state.svelte.ts'

  /** The search on, kept across reloads */
  const SEARCH = 'jellyflow.discoverSearch'
  /** TMDB is asked once typing pauses this long (ms) */
  const PAUSE = 250

  let rails = $state<Rails<Pick>>()
  let filmPage = $state<DiscoverPage>()
  let open = $state(false)
  let note = $state('')
  let noteTimer: ReturnType<typeof setTimeout> | undefined
  /** Searching: what was on before, for Esc */
  let searching = $state<{ prev: string } | undefined>()
  let query = $state(stored<string>(SEARCH) ?? '')
  let applied = $state(stored<string>(SEARCH) ?? '')
  /** What TMDB found last, and for what (kept on show while the next is asked) */
  let found = $state.raw<{ query: string; items: Pick[] } | undefined>()
  /** The last one marked not interested, where it was, and whether it was wished for: u puts it back */
  let removed = $state.raw<{ pick: Pick; rail: string; wished: boolean } | undefined>()

  const asked = $derived(applied.trim())
  const finding = $derived(asked !== '' && found?.query !== asked)
  const kind = $derived(discover.kind)
  /** The kind shown, films or series */
  const ofKind = (s: Pick): boolean => s.kind === kind
  /** Done with: in the library, wished for, or not of interest; left out of Discover's own rows */
  const done = (s: Pick): boolean => Boolean(s.owned) || discover.wished.has(s.ref) || discover.dismissed.has(s.ref)
  const wishlist = $derived(discover.wishlist.map(pick).filter(ofKind).sort(byScore))
  /** Found of this kind; how many of the other (said when none are of this one) */
  const foundHere = $derived(found?.items.filter(ofKind) ?? [])
  const foundOther = $derived((found?.items.length ?? 0) - foundHere.length)
  const live = $derived<Rail<Pick>[]>(
    asked
      ? [{ key: 'search', name: `Found on TMDB for “${asked}”`, items: foundHere, passing: true }]
      : [
          ...(wishlist.length ? [{ key: `wishlist:${kind}`, name: 'Your wishlist', items: wishlist }] : []),
          ...discover.lists
            .map((l) => ({ key: l.key, name: l.name, items: l.items.map(pick).filter((s) => ofKind(s) && !done(s)) }))
            .filter((r) => r.items.length),
        ],
  )
  /** While a page is open, and as it swings shut, the rows stay as they were: what's done on it shows once it's shut */
  let frozen = $state.raw<Rail<Pick>[] | undefined>()
  const shown = $derived(frozen ?? live)

  // the lists are read the first time Discover is opened
  $effect(() => {
    if (app.view === 'discover') void discover.load()
  })

  $effect(() => {
    app.pageOpen.discover = open
  })

  // films ⇄ series: an open page shuts (the rows change once it has)
  $effect(() => {
    void discover.kind
    untrack(() => rails?.closePage())
  })

  $effect(() => {
    if (open) {
      untrack(() => (frozen ??= live))
      return
    }
    const timer = setTimeout(() => (frozen = undefined), FOLD)
    return () => clearTimeout(timer)
  })

  // TMDB is asked what's searched for, once typing pauses
  $effect(() => {
    const q = asked
    if (!q || !discover.on) return
    let live = true
    const timer = setTimeout(() => {
      discover.search(q).then(
        (items) => live && (found = { query: q, items: items.map(pick) }),
        (e: unknown) => {
          if (!live) return
          found = { query: q, items: [] }
          say(e instanceof Error ? e.message : String(e))
        },
      )
    }, PAUSE)
    return () => {
      live = false
      clearTimeout(timer)
    }
  })

  /** A word in the line at the bottom for a while */
  function say(message: string): void {
    note = message
    clearTimeout(noteTimer)
    noteTimer = setTimeout(() => (note = ''), 4000)
  }

  /** w: on the wishlist, or off it */
  async function wish(p: Pick | undefined): Promise<void> {
    if (!p) return
    const on = !discover.wished.has(p.ref)
    await discover.toggle(p)
    say(on ? `“${p.title}” is on your wishlist` : `“${p.title}” is off your wishlist`)
  }

  function search(again: string): void {
    applied = again
    store(SEARCH, again)
  }

  // the search's keys (SearchLine)

  function clearSearch(): void {
    query = ''
    search('')
  }

  /** Esc: the rows as they were */
  function cancelSearch(): void {
    if (!searching) return
    const { prev } = searching
    searching = undefined
    query = prev
    search(prev)
  }

  /** Enter: browse what was found; nothing found is the same as Esc */
  function doneSearch(): void {
    if (!searching) return
    const { prev } = searching
    searching = undefined
    if (!finding && !foundHere.length) {
      query = prev
      search(prev)
    }
  }

  /**
   * x: not interested in what the row's at, left out of Discover (off the
   * wishlist too), u puts it back; whether it's done (in a search, where it's
   * still found, x again takes it back)
   */
  function dismiss(): boolean {
    const at = rails?.current()
    const p = at?.item
    if (!at || !p) return false
    if (discover.dismissed.has(p.ref)) {
      removed = undefined
      void discover.undismiss(p, false)
      say(`“${p.title}” is back in Discover`)
      return false
    }
    removed = { pick: p, rail: at.rail.key, wished: discover.wished.has(p.ref) }
    void discover.dismiss(p)
    say(`Not interested in “${p.title}” · u puts it back`)
    return true
  }

  function undo(): void {
    const r = removed
    if (!r) return
    removed = undefined
    void discover.undismiss(r.pick, r.wished)
    discover.setKind(r.pick.kind)
    rails?.show(r.wished ? `wishlist:${r.pick.kind}` : r.rail, r.pick.id)
    say(`“${r.pick.title}” is back`)
  }

  /** Down from the last row: the year before the oldest one's (both kinds), one year at a time; said if it has nothing new of this kind */
  function more(): void {
    if (asked) return
    void discover.more().then((got) => {
      if (got && !got.lists.some((l) => l.items.some((s) => s.kind === discover.kind && !done(pick(s)))))
        say(`Nothing new from ${got.year} · down again for ${got.year - 1}`)
    })
  }

  const KINDS: Record<Kind, string> = { movie: 'films', tv: 'series' }

  /** Discover's own keys (the rows' are Rails'): the wishlist, not interested, search */
  function onkey(key: string): boolean {
    switch (key) {
      case 'w':
        void wish(rails?.current()?.item)
        return true
      case 'x':
        dismiss()
        return true
      case 'u':
        undo()
        return true
      case '/':
        query = applied
        searching = { prev: applied }
        return true
      case '<Esc>':
        if (!asked) return false
        clearSearch()
        return true
      default:
        return false
    }
  }

  /** An open page's keys: w or Enter, the wishlist; x, not interested (and shut); i, the title on IMDb; Esc, q, k or Backspace shut it (k as on Watch's, up from the top); the rest are the row's (on to the next) */
  function pageKey(key: string): 'handled' | 'close' | 'pass' {
    switch (key) {
      case 'w':
      case '<Enter>':
        void wish(rails?.current()?.item)
        return 'handled'
      case 'x':
        return dismiss() ? 'close' : 'handled'
      case 'i': {
        const imdb = filmPage?.imdbPage()
        if (imdb) window.open(imdb, '_blank', 'noopener')
        return 'handled'
      }
      case '<Esc>':
      case 'q':
      case 'k':
      case '<Up>':
      case '<BS>':
        return 'close'
      default:
        return 'pass'
    }
  }
</script>

<Rails
  bind:this={rails}
  bind:open
  rails={shown}
  remember="jellyflow.discovering"
  shown={app.view === 'discover'}
  url={(p, px) => discover.image(p.poster, px)}
  label={(p) => `${p.title}${p.year ? ` (${p.year})` : ''}`}
  backdrop={(p) => discover.backdrop(p.backdrop)}
  {pageKey}
  {onkey}
  onend={more}
>
  {#snippet art(p, px)}
    <Poster src={discover.image(p.poster, px)} title={p.title} />
  {/snippet}

  {#snippet badge(p)}
    {#if discover.wished.has(p.ref)}<Mark sign="♥" title="On your wishlist" corner="left" />{/if}
    {#if discover.dismissed.has(p.ref)}<Mark sign="✕" title="Not interested" corner="left" />{/if}
    {#if p.owned}<Mark sign="✓" title="In your library" />{/if}
  {/snippet}

  {#snippet caption(p)}
    <Caption
      title={p.title}
      text={p.year ? String(p.year) : ''}
      score={p.score}
      votes={p.votes}
      more={p.owned ? 'in your library' : discover.dismissed.has(p.ref) ? 'not interested' : p.why}
      genres={p.genres}
    />
  {/snippet}

  {#snippet page(p)}
    <DiscoverPage
      bind:this={filmPage}
      pick={p}
      onwish={() => void wish(p)}
      ondismiss={() => {
        if (dismiss()) rails?.closePage()
      }}
    />
  {/snippet}

  {#snippet empty()}
    {#if asked}
      {#if finding}Searching TMDB for “{asked}”…{:else if foundOther}No {KINDS[kind]} on TMDB for “{asked}”; {foundOther} {KINDS[kind === 'movie' ? 'tv' : 'movie']}: <kbd>⇧Tab</kbd>{:else}Nothing on TMDB for “{asked}”{/if}
    {:else if discover.loading || !discover.read}Finding films and series…{:else}No {KINDS[kind]} to discover yet{/if}
  {/snippet}

  <SearchLine
    searching={searching !== undefined}
    bind:query
    placeholder="a film or series, on TMDB"
    {applied}
    everything="all rows"
    count={searching && !finding ? `${foundHere.length} found` : undefined}
    note={note || (discover.finding ? `Finding the best of ${discover.finding}…` : undefined)}
    hint={open ? undefined : wishHint}
    quiet={app.quiet}
    oninput={() => search(query)}
    onclear={clearSearch}
    oncancel={cancelSearch}
    ondone={doneSearch}
    onmove={(dir, e) => rails?.press('search', dir, e.repeat, e.code)}
  />
</Rails>

{#snippet wishHint()}<kbd>w</kbd> puts it on your wishlist · <kbd>x</kbd> not interested{/snippet}
