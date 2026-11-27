<script lang="ts">
  import { onMount } from 'svelte'
  import { keyName, typing } from '../lib/keys/index.ts'
  import Coverflow from './Coverflow.svelte'
  import Discover from './Discover.svelte'
  import { discover } from './discover.svelte.ts'
  import Folders from './Folders.svelte'
  import Help from './Help.svelte'
  import Login from './Login.svelte'
  import { player } from './player.svelte.ts'
  import PlayerBar from './PlayerBar.svelte'
  import { app, type Section } from './state.svelte.ts'
  import VideoPlayer from './VideoPlayer.svelte'
  import { videos } from './videos.svelte.ts'
  import Watch from './Watch.svelte'
  import { watch } from './watch.svelte.ts'

  /** Around the player: what goes full screen */
  let theatre = $state<HTMLElement>()

  /** With a page open, after this long with nothing done, the header and the player bar glide away (ms) */
  const QUIET_MS = 5000
  const pageOpen = $derived(app.view === 'folders' ? false : app.pageOpen[app.view])
  $effect(() => {
    if (!pageOpen) {
      app.quiet = false
      return
    }
    const hush = () => (app.quiet = true)
    let timer = setTimeout(hush, QUIET_MS)
    const wake = () => {
      app.quiet = false
      clearTimeout(timer)
      timer = setTimeout(hush, QUIET_MS)
    }
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const
    for (const event of events) addEventListener(event, wake, { passive: true })
    return () => {
      clearTimeout(timer)
      for (const event of events) removeEventListener(event, wake)
    }
  })

  onMount(() => {
    if (app.session) void app.load()
  })

  /** Keys for every view: switching, playing, help */
  function onkeydown(e: KeyboardEvent): void {
    if (!app.session || typing(e)) return
    switch (keyName(e)) {
      // Tab: the next section (Watch, Discover, Listen); Shift-Tab: films ⇄ series in Discover, Cover Flow ⇄ Folders in Listen
      case '<Tab>':
        if (e.shiftKey && app.section === 'discover') discover.setKind(discover.kind === 'movie' ? 'tv' : 'movie')
        else if (e.shiftKey) app.setView(app.view === 'flow' ? 'folders' : 'flow')
        else if (app.sections.length > 1) app.setSection(app.sections[(app.sections.indexOf(app.section) + 1) % app.sections.length] ?? 'listen')
        break
      case '<Space>':
        player.toggle()
        break
      case '>':
        player.next()
        break
      case '<':
        player.prev()
        break
      case '?':
        app.help = !app.help
        break
      case '<Esc>':
        if (!app.help) return
        app.help = false
        break
      default:
        return
    }
    e.preventDefault()
  }

  /** Clicking a button doesn't give it the keyboard: Enter and Space stay the app's */
  function onmousedown(e: MouseEvent): void {
    if (app.session && (e.target as HTMLElement).closest('button')) e.preventDefault()
  }

  const NAMES: Record<Section, string> = { watch: 'Watch', discover: 'Discover', listen: 'Listen' }

  /** "61 films · 20 series" */
  function watchCount(): string {
    if (!videos.read) return videos.loading ? 'Loading films and series…' : ''
    const films = videos.movies.length
    const series = videos.shows.length
    return [films ? `${films} ${films === 1 ? 'film' : 'films'}` : '', series ? `${series} series` : ''].filter(Boolean).join(' · ')
  }

  /** "3 films on your wishlist", of the kind shown */
  function discoverCount(): string {
    if (!discover.read) return discover.loading ? 'Finding films and series…' : ''
    const n = discover.wishlist.filter((s) => s.kind === discover.kind).length
    const what = discover.kind === 'tv' ? 'series' : n === 1 ? 'film' : 'films'
    return n ? `${n} ${what} on your wishlist` : `No ${what} on your wishlist yet`
  }
</script>

<svelte:window {onkeydown} {onmousedown} />

{#if !app.session}
  <Login />
{:else}
  <div class="app" class:quiet={app.quiet}>
    <header>
      <span class="logo">jelly<span>flow</span></span>
      {#if app.sections.length > 1}
        <nav>
          {#each app.sections as section (section)}
            <button class:on={app.section === section} onclick={() => app.setSection(section)}>{NAMES[section]}</button>
          {/each}
        </nav>
        <kbd class="tabhint" title="Tab switches">Tab</kbd>
      {/if}
      {#if app.section === 'listen'}
        <nav class="sub">
          <button class:on={app.view === 'flow'} onclick={() => app.setView('flow')}>Cover Flow</button>
          <button class:on={app.view === 'folders'} onclick={() => app.setView('folders')}>Folders</button>
        </nav>
        <kbd class="tabhint" title="Shift-Tab switches">⇧Tab</kbd>
      {:else if app.section === 'discover'}
        <nav class="sub">
          <button class:on={discover.kind === 'movie'} onclick={() => discover.setKind('movie')}>Movies</button>
          <button class:on={discover.kind === 'tv'} onclick={() => discover.setKind('tv')}>Series</button>
        </nav>
        <kbd class="tabhint" title="Shift-Tab switches">⇧Tab</kbd>
      {/if}
      <span class="status">
        {#if app.status}{app.status}{:else if app.section === 'watch'}{watchCount()}{:else if app.section === 'discover'}{discoverCount()}{:else if app.loading}Loading {app.loading}…{:else}{app.albums.length} albums{/if}
      </span>
      <button class="user" onclick={() => app.logout()} title="Log out">{app.session.userName} · log out</button>
    </header>
    <main>
      {#if app.videoLibraries.length}
        <div class="view" hidden={app.view !== 'watch'}><Watch /></div>
      {/if}
      {#if app.hasDiscover}
        <div class="view" hidden={app.view !== 'discover'}><Discover /></div>
      {/if}
      <div class="view" hidden={app.view !== 'flow'}><Coverflow /></div>
      <div class="view" hidden={app.view !== 'folders'}><Folders /></div>
    </main>
    <div class="bottom"><PlayerBar /></div>
  </div>

  {#if watch.showing}
    <!-- what goes full screen: it stays so from one episode to the next (each is a new player) -->
    <div class="theatre" bind:this={theatre}>
      {#key watch.showing}
        <VideoPlayer showing={watch.showing} {theatre} />
      {/key}
    </div>
  {/if}

  {#if app.help}
    <Help onclose={() => (app.help = false)} />
  {/if}
{/if}

<style>
  .app {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  /* glassy and quiet, like the album page: the covers are the show */
  header {
    display: flex;
    align-items: center;
    gap: 14px;
    height: 46px;
    padding: 0 18px;
    background: linear-gradient(to bottom, rgb(255 255 255 / 0.05), rgb(255 255 255 / 0.015));
    border-bottom: 1px solid rgb(255 255 255 / 0.07);
  }
  /* a page open and nothing done for a while: the header and the player bar glide off the edges
     (the views fade their own lines): nothing but the page and its covers */
  header,
  .bottom {
    transition:
      transform 700ms cubic-bezier(0.22, 0.61, 0.36, 1),
      opacity 700ms;
  }
  .quiet header {
    transform: translateY(-100%);
    opacity: 0;
    pointer-events: none;
  }
  .quiet .bottom {
    transform: translateY(100%);
    opacity: 0;
    pointer-events: none;
  }
  .logo {
    font-weight: 800;
    font-size: 17px;
    letter-spacing: -0.03em;
  }
  .logo span {
    color: var(--accent);
  }
  nav {
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: 999px;
    background: rgb(255 255 255 / 0.06);
  }
  nav button {
    background: none;
    border: 0;
    padding: 4px 14px;
    border-radius: 999px;
    color: var(--text-2);
    font-size: 13px;
  }
  nav button.on {
    background: rgb(255 255 255 / 0.14);
    color: var(--text);
    font-weight: 600;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.08);
  }
  /* a section's own two (Cover Flow | Folders, Movies | Series): smaller, quieter than the sections' */
  nav.sub {
    padding: 2px;
    background: rgb(255 255 255 / 0.04);
  }
  nav.sub button {
    padding: 3px 11px;
    font-size: 12px;
  }
  .theatre {
    position: fixed;
    inset: 0;
    z-index: 6000;
    background: #000;
  }
  .tabhint {
    font-size: 11px;
    border-bottom-width: 1px;
    background: transparent;
  }
  .status {
    flex: 1;
    text-align: right;
    color: var(--text-2);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .user {
    background: rgb(255 255 255 / 0.06);
    border: 0;
    border-radius: 999px;
    padding: 5px 12px;
    color: var(--text-2);
    font-size: 12px;
  }
  .user:hover {
    background: rgb(255 255 255 / 0.12);
    color: var(--text);
  }
  main {
    flex: 1;
    min-height: 0;
  }
  .view {
    height: 100%;
  }
  .view[hidden] {
    display: none;
  }
</style>
