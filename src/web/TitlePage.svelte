<!--
  An opened title's page, on the leaf that swings out beside its poster
  (Row.svelte): a film's (what it's about, who made it, its cast, Resume or
  Play), or a series' (where you're at, its seasons and episodes, its cast).
  Watch gives it its keys.
-->
<script lang="ts">
  import { tick } from 'svelte'
  import type { Item } from '../core/jellyfin.ts'
  import { filmChoices, seriesChoice, type Choice } from '../core/page.ts'
  import { seasonsOf, upNext, type Episode } from '../core/shows.ts'
  import { facts, left, resumable, runtime, startAt, status, type Title } from '../core/titles.ts'
  import Disc from './Disc.svelte'
  import Progress from './Progress.svelte'
  import Score from './Score.svelte'
  import { keepInView } from './scroll.ts'
  import { app } from './state.svelte.ts'
  import { videos } from './videos.svelte.ts'
  import { watch } from './watch.svelte.ts'

  interface Props {
    title: Title
    /** From Continue Watching: the episode it's at, shown until the episodes are in */
    episode?: Episode | undefined
  }
  let { title, episode }: Props = $props()

  /** 0: the first button; a series' episodes after it */
  let cursor = $state(0)
  /** Everything Jellyfin knows about it: its cast and crew, studios, keywords */
  let details = $state.raw<Item | undefined>()
  let episodes = $state.raw<Episode[] | undefined>()
  /** The season shown, by its place in the list */
  let season = $state(0)
  let list = $state<HTMLElement>()
  let placed = false

  const id = $derived(title.id)
  const seasons = $derived(episodes ? seasonsOf(episodes) : [])
  const shown = $derived(seasons[season]?.episodes ?? [])

  // its cast and crew
  $effect(() => {
    const at = id
    let live = true
    app.item(at).then(
      (item) => live && (details = item),
      () => undefined,
    )
    return () => {
      live = false
    }
  })

  // a series' episodes; again after it's been watched (the title is replaced then)
  $effect(() => {
    if (title.kind !== 'show') return
    let live = true
    videos.episodes(title.id).then(
      (all) => {
        if (!live) return
        episodes = all
        if (placed) return
        // open at the season of the episode to watch next, that episode in sight
        placed = true
        const next = upNext(all)?.episode ?? episode
        season = Math.max(0, seasonsOf(all).findIndex((s) => s.season === next?.season))
        if (next) void tick().then(() => keepInView(list, list?.querySelector(`[data-id="${next.id}"]`), true))
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  })

  /** What it offers to play: a film's buttons; a series' one, at the episode to pick it up at */
  const primary = $derived(title.kind === 'show' ? seriesChoice(episodes, episode) : undefined)
  const choices = $derived(title.kind === 'movie' ? filmChoices(title) : primary ? [primary] : [])
  const last = $derived(title.kind === 'movie' ? choices.length - 1 : shown.length)

  async function play(at: number, e?: Episode): Promise<void> {
    if (title.kind === 'movie') watch.open(await videos.film(title, at))
    else if (e) watch.open(await videos.episode(title, e, at))
  }

  function choose(c: Choice): void {
    void play(c.at, c.episode)
  }

  /** An episode: from where it was stopped, else from the beginning */
  function playEpisode(e: Episode): void {
    void play(startAt(e), e)
  }

  function enter(i: number): void {
    const e = title.kind === 'show' && i > 0 ? shown[i - 1] : undefined
    const c = choices[i]
    if (e) playEpisode(e)
    else if (c) choose(c)
  }

  /** Keeps the cursor's episode in sight */
  function reveal(): void {
    void tick().then(() => keepInView(list, list?.querySelector('.cursor')))
  }

  function toSeason(i: number): void {
    const to = Math.max(0, Math.min(seasons.length - 1, i))
    if (to === season) return
    season = to
    if (cursor > 0) cursor = 1
    list?.scrollTo({ top: 0 })
  }

  /** A key for the page: done, or close the page, or not the page's (Watch's, then) */
  export function key(k: string, repeat: boolean): 'handled' | 'close' | 'pass' {
    switch (k) {
      case '<Esc>':
      case 'q':
      case '<BS>':
        return 'close'
      case 'j':
      case '<Down>':
        cursor = Math.min(cursor + 1, last)
        break
      case 'k':
      case '<Up>':
        if (cursor === 0) return repeat ? 'handled' : 'close'
        cursor--
        break
      case 'g':
      case '<Home>':
        cursor = 0
        break
      case 'G':
      case '<End>':
        cursor = last
        break
      case '<Enter>':
        if (!repeat) enter(cursor)
        break
      // a series': its seasons; a film's page leaves them to Watch (on to the next film)
      case 'h':
      case '<Left>':
        if (title.kind !== 'show') return 'pass'
        toSeason(season - 1)
        break
      case 'l':
      case '<Right>':
        if (title.kind !== 'show') return 'pass'
        toSeason(season + 1)
        break
      default:
        return 'pass'
    }
    reveal()
    return 'handled'
  }

  const people = $derived(details?.People ?? [])
  /** The cast, as Jellyfin orders it (top billing first) */
  const cast = $derived(people.filter((p) => p.Type === 'Actor').slice(0, 16))
  /** "Gary Trousdale, Kirk Wise" */
  function names(type: string, most = 3): string {
    return [...new Set(people.filter((p) => p.Type === type).map((p) => p.Name))].slice(0, most).join(', ')
  }
  const directors = $derived(names('Director'))
  const writers = $derived(names('Writer'))
  const creators = $derived(names('Creator'))
  const studios = $derived((details?.Studios ?? []).slice(0, title.kind === 'show' ? 1 : 2).map((s) => s.Name).join(', '))
  const tags = $derived((details?.Tags ?? []).slice(0, 6))
  /** When a film would end if it started (or resumed) now: "ends at 21:42", like Jellyfin's */
  const ends = $derived.by(() => {
    if (title.kind !== 'movie' || !title.seconds) return ''
    return `ends at ${new Date(Date.now() + left(title) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  })
  /** "Taylor Swift" → "TS", for someone without a photo */
  function initials(name: string): string {
    return name
      .split(/\s+/)
      .map((w) => w[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase()
  }
  const regular = $derived(seasons.filter((s) => s.season !== 0).length)
  /** After the rating: whether it's been watched and when it would end; a series' seasons and what's left */
  const more = $derived(
    (title.kind === 'movie' ? [status(title), ends] : [regular ? `${regular} ${regular === 1 ? 'season' : 'seasons'}` : '', status(title)])
      .filter(Boolean)
      .join(' · '),
  )
  const art = $derived(videos.backdrop(title))
</script>


<div class="sheet">
  {#if art}<img class="art" src={art} alt="" />{/if}
  <header>
    <div class="name">{title.title}</div>
    <div class="facts">
      {facts(title)}{#if title.score}<Score value={title.score} />{:else if more}{' · '}{/if}{more}
    </div>
    {#if title.genres.length}<div class="genres">{title.genres.join(' · ')}</div>{/if}
  </header>

  {#if title.kind === 'movie'}
    <div class="about" data-page>
      {#if title.tagline}<p class="tagline">{title.tagline}</p>{/if}
      {#if title.overview}<p>{title.overview}</p>{/if}
      <dl class="credits">
        {#if directors}<dt>Director</dt><dd>{directors}</dd>{/if}
        {#if writers}<dt>Writers</dt><dd>{writers}</dd>{/if}
        {#if studios}<dt>Studio</dt><dd>{studios}</dd>{/if}
      </dl>
      {#if tags.length}
        <div class="tags">{#each tags as tag (tag)}<span>{tag}</span>{/each}</div>
      {/if}
    </div>
    {@render faces()}
  {:else}
    {#if title.overview}<p class="overview">{title.overview}</p>{/if}
    {#if creators || studios}
      <p class="with">
        {#if creators}<span><b>Created by</b> {creators}</span>{/if}
        {#if studios}<span>{studios}</span>{/if}
      </p>
    {/if}
  {/if}

  <!-- the cast: faces in a row, top billing first, scrolled sideways -->
  {#snippet faces()}
    {#if cast.length}
      <ul class="cast" data-page aria-label="Cast">
        {#each cast as person, i (`${person.Id ?? person.Name}${i}`)}
          <li title={person.Role ? `${person.Name} as ${person.Role}` : person.Name}>
            <span class="face">
              {#if person.Id && person.PrimaryImageTag && app.client}
                <img src={app.client.posterUrl(person.Id, person.PrimaryImageTag, 144)} alt="" loading="lazy" decoding="async" />
              {:else}
                {initials(person.Name)}
              {/if}
            </span>
            <span class="who">{person.Name}</span>
            {#if person.Role}<span class="as">{person.Role}</span>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/snippet}

  <!-- the player bar's buttons: the first a white disc, the next on glass; the cursor a pane of glass around one -->
  <div class="actions">
    {#each choices as action, i (action.label)}
      {@const more = [action.episode?.title, action.left ? `${runtime(action.left)} left` : ''].filter(Boolean).join(' · ')}
      <button class="act" class:first={i === 0} class:cursor={i === cursor} onclick={() => choose(action)}>
        <Disc sign={action.again && i > 0 ? 'again' : 'play'} size={i === 0 ? 46 : 38} plain={i > 0} />
        <span class="words">
          <span class="label">{action.label}</span>
          {#if more}<span class="what">{more}</span>{/if}
        </span>
      </button>
    {/each}
  </div>

  {#if title.kind === 'show'}
    {#if seasons.length > 1}
      <nav class="seasons">
        {#each seasons as s, i (s.season)}
          <button class:on={i === season} onclick={() => toSeason(i)}>{s.name}</button>
        {/each}
        <span class="hint"><kbd>h</kbd> <kbd>l</kbd></span>
      </nav>
    {/if}
    <ol class="episodes" bind:this={list} data-page>
      {#each shown as e, i (e.id)}
        <li class:cursor={cursor === i + 1} class:watched={e.played} class:next={e.id === primary?.episode?.id} data-id={e.id}>
          <button onclick={() => playEpisode(e)}>
            <span class="still">
              {#if e.stillTag && app.client}
                <img src={app.client.stillUrl(e.id, e.stillTag, 320)} alt="" loading="lazy" decoding="async" />
              {/if}
              {#if resumable(e)}<Progress of={e} />{/if}
              <span class="go"><Disc size={34} /></span>
            </span>
            <span class="text">
              <span class="title"><b>{e.number ?? '·'}</b> {e.title}</span>
              <span class="sub">
                {runtime(e.seconds)}{e.played ? ' · watched' : resumable(e) ? ` · ${runtime(left(e))} left` : ''}
              </span>
              {#if e.overview}<span class="blurb">{e.overview}</span>{/if}
            </span>
            {#if e.played}<span class="tick" title="Watched">✓</span>{/if}
          </button>
        </li>
      {/each}
      {#if !episodes}<li class="wait">Loading episodes…</li>{/if}
    </ol>
    <!-- at the bottom, as on a film's page -->
    {@render faces()}
  {/if}
</div>

<style>
  .sheet {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    padding: 22px 16px 14px;
    overflow: hidden;
    background: #0d0d10;
    box-shadow: 0 10px 40px rgb(0 0 0 / 0.6);
  }
  /* blurred by Jellyfin; dimmed by its opacity over the sheet's black */
  .art {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0.3;
  }
  .sheet > :not(.art) {
    position: relative;
  }
  header {
    padding: 0 10px 10px;
    border-bottom: 1px solid rgb(255 255 255 / 0.14);
  }
  .name {
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .facts,
  .genres {
    color: var(--text-2);
    font-size: 14px;
  }
  .about {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 10px;
    font-size: 15px;
    line-height: 1.45;
    color: var(--text);
  }
  .tagline {
    font-style: italic;
    color: var(--text-2);
  }
  /* who made it: slim label / name lines, like Jellyfin's */
  .credits {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 3px 14px;
    margin: 12px 0 0;
    font-size: 14px;
  }
  .credits dt {
    color: var(--text-3);
  }
  .credits dd {
    margin: 0;
    color: var(--text);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 12px 0 4px;
  }
  .tags span {
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 12px;
    color: var(--text-2);
    background: var(--glass);
    box-shadow: var(--glass-edge);
  }
  /* the cast: faces in a row, scrolled sideways */
  .cast {
    display: flex;
    gap: 6px;
    margin: 8px 0 0;
    padding: 6px 6px 2px;
    list-style: none;
    overflow-x: auto;
    scrollbar-width: none;
    flex: none;
  }
  .cast li {
    flex: none;
    width: 84px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .face {
    width: 62px;
    height: 62px;
    border-radius: 50%;
    overflow: hidden;
    display: grid;
    place-items: center;
    font-weight: 700;
    color: var(--text-2);
    background: var(--placeholder);
    box-shadow:
      0 0 0 1px rgb(255 255 255 / 0.18),
      0 6px 14px -6px rgb(0 0 0 / 0.9);
  }
  .face img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 18%;
  }
  .who {
    margin-top: 6px;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.25;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .as {
    font-size: 11px;
    line-height: 1.25;
    color: var(--text-3);
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  /* a series': who made it, one slim line */
  .with {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 14px;
    margin: 2px 10px 4px;
    font-size: 13px;
    color: var(--text-2);
  }
  .with b {
    color: var(--text-3);
    font-weight: 500;
    margin-right: 4px;
  }
  .overview {
    margin: 10px 10px 4px;
    font-size: 14px;
    line-height: 1.45;
    color: var(--text);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 20px;
    margin: 12px 0 2px;
  }
  .act {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    border: 0;
    border-radius: 999px;
    padding: 4px 18px 4px 4px;
    background: none;
    text-align: left;
    color: var(--text);
  }
  .act:hover {
    background: var(--hover);
  }
  .act.cursor {
    background: var(--glass);
    box-shadow: var(--glass-edge);
  }
  .words {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .label {
    font-size: 16px;
    font-weight: 500;
    white-space: nowrap;
  }
  .first .label {
    font-size: 17px;
    font-weight: 700;
  }
  .what {
    font-size: 13px;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .episodes button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    border: 0;
    border-radius: 6px;
    padding: 9px 10px;
    background: none;
    text-align: left;
    font-size: 16px;
    color: var(--text);
  }
  .episodes button:hover {
    background: var(--hover);
  }
  .cursor button {
    background: var(--glass);
    box-shadow: var(--glass-edge);
  }
  /* an episode's still shows the play button under the pointer */
  .go {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 0.3);
    opacity: 0;
    transition: opacity 150ms;
  }
  .episodes button:hover .go {
    opacity: 1;
  }
  .seasons {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 10px 4px 4px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .seasons button {
    flex: none;
    border: 0;
    border-radius: 999px;
    padding: 4px 12px;
    background: rgb(255 255 255 / 0.06);
    color: var(--text-2);
    font-size: 14px;
  }
  .seasons button.on {
    background: rgb(255 255 255 / 0.16);
    color: var(--text);
    font-weight: 600;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.1);
  }
  .hint {
    margin-left: auto;
    flex: none;
    font-size: 11px;
  }
  .episodes {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    list-style: none;
    margin: 6px 0 0;
    padding: 0 2px;
  }
  .episodes button {
    align-items: flex-start;
    gap: 12px;
    padding: 8px;
  }
  .still {
    position: relative;
    flex: none;
    width: 128px;
    aspect-ratio: 16 / 9;
    border-radius: 4px;
    overflow: hidden;
    background: var(--placeholder);
  }
  .still img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .text .title {
    font-size: 15px;
    font-weight: 600;
  }
  .text .title b {
    display: inline-block;
    min-width: 1.4em;
    color: var(--text-2);
  }
  .text .sub {
    font-size: 13px;
    color: var(--text-2);
  }
  .blurb {
    font-size: 13px;
    line-height: 1.35;
    color: var(--text-2);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .watched .still img {
    opacity: 0.55;
  }
  /* the one the first button plays */
  .next .still {
    box-shadow:
      0 0 0 2px var(--accent),
      0 0 14px -2px var(--accent);
  }
  .tick {
    margin-left: auto;
    flex: none;
    font-weight: 700;
    color: var(--text-2);
  }
  .wait {
    padding: 12px 10px;
    color: var(--text-2);
  }
</style>
