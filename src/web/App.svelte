<script lang="ts">
  import { onMount } from 'svelte'
  import { keyName } from '../core/keys.ts'
  import Coverflow from './Coverflow.svelte'
  import Folders from './Folders.svelte'
  import Login from './Login.svelte'
  import { player } from './player.svelte.ts'
  import PlayerBar from './PlayerBar.svelte'
  import { app, typing } from './state.svelte.ts'
  import VideoPlayer from './VideoPlayer.svelte'
  import { videos } from './videos.svelte.ts'
  import Watch from './Watch.svelte'
  import { watch } from './watch.svelte.ts'

  /** Around the player: what goes full screen */
  let theatre = $state<HTMLElement>()

  /** With a page open, after this long with nothing done, the header and the player bar glide away (ms) */
  const QUIET_MS = 5000
  const pageOpen = $derived(app.view === 'flow' ? app.pageOpen.flow : app.view === 'watch' ? app.pageOpen.watch : false)
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
      // Tab: Watch ⇄ Listen; Shift-Tab: Cover Flow ⇄ Folders
      case '<Tab>':
        if (e.shiftKey) app.setView(app.view === 'flow' ? 'folders' : 'flow')
        else if (app.sections.length > 1) app.setSection(app.section === 'watch' ? 'listen' : 'watch')
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

  /** "61 films · 20 series" */
  function watchCount(): string {
    if (!videos.read) return videos.loading ? 'Loading films and series…' : ''
    const films = videos.movies.length
    const series = videos.shows.length
    return [films ? `${films} ${films === 1 ? 'film' : 'films'}` : '', series ? `${series} series` : ''].filter(Boolean).join(' · ')
  }

  const help: [string, [string, string][]][] = [
    [
      'Everywhere',
      [
        ['Tab', 'Watch ⇄ Listen'],
        ['Space', 'play / pause the music'],
        ['< >', 'previous / next track'],
        ['?', 'this help'],
      ],
    ],
    [
      'Listen',
      [
        ['Shift-Tab', 'Cover Flow ⇄ Folders'],
        ['c', 'go to what’s playing: its album glides in and opens at the track'],
        ['o', 'back to where you were before c (again: back to what’s playing)'],
        ['a', 'add to the queue'],
        ['i', 'album details: Jellyfin’s overview, tags, quality, links'],
        ['d w m', 'the album on Discogs, Wikipedia, MusicBrainz'],
      ],
    ],
    [
      'Cover Flow',
      [
        ['h l ← →', 'previous / next album; hold to speed up (or scroll); a click on a cover opens it'],
        ['H L', '10 back / forward'],
        ['g G', 'first / last'],
        ['/', 'filter by artist, album, year or track; Enter browses, Esc cancels'],
        ['Esc', 'whole library again, same album'],
        ['Enter j', 'open the album: its tracks swing out beside it, the spectrum under them; j k, Enter plays from there, Esc or k on the first track closes'],
      ],
    ],
    [
      'Folders',
      [
        ['j k', 'down / up (counts: 5j)'],
        ['l h', 'open / back up (also Enter on a folder, - and Backspace)'],
        ['Enter', 'play the album, or the folder from this track'],
        ['gg G 12G', 'first / last / line 12'],
        ['Ctrl-d u f b', 'half page / page down and up'],
        ['H M L zz', 'top / middle / bottom of the screen, centre'],
        ['/ n N', 'find in this folder, next, previous'],
        ['~', 'the top folder'],
      ],
    ],
    [
      'Watch',
      [
        ['h l ← →', 'previous / next in the row; hold to speed up (or scroll sideways); a click on a poster opens it'],
        ['j k ↓ ↑', 'the next row / the one above (or scroll up and down)'],
        ['H L  g G', '10 back / forward; first / last in the row'],
        ['Enter', 'open it: its page swings out beside the poster'],
        ['x u', 'take it off Continue Watching (until it’s watched again); put it back'],
        ['/', 'find a film or series by title, year or genre; Esc: all the rows again'],
      ],
    ],
    [
      'A film’s or series’ page',
      [
        ['j k', 'down / up: Resume or Play, a series’ episodes; k at the top closes'],
        ['h l', 'a series’ seasons; on a film’s page, the previous / next film'],
        ['Enter', 'play it (or resume it, where it was stopped)'],
        ['Esc q', 'close the page'],
      ],
    ],
    [
      'Watching',
      [
        ['Space k', 'play / pause'],
        ['j l ← →', '10 s back / ahead; 5 s with the arrows'],
        ['0 … 9', 'to 0% … 90% of the film'],
        ['↑ ↓ m', 'volume up / down, mute'],
        ['c', 'subtitles on / off'],
        ['a s', 'next audio track; the quality, audio and subtitles menu'],
        ['f', 'full screen'],
        ['N', 'the next episode (at the end of one it follows by itself; Enter now, Esc back)'],
        ['Esc q', 'back (where you stopped is kept, in Jellyfin)'],
      ],
    ],
  ]
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
          <button class:on={app.section === 'watch'} onclick={() => app.setSection('watch')}>Watch</button>
          <button class:on={app.section === 'listen'} onclick={() => app.setSection('listen')}>Listen</button>
        </nav>
        <kbd class="tabhint" title="Tab switches">Tab</kbd>
      {/if}
      {#if app.section === 'listen'}
        <nav class="sub">
          <button class:on={app.view === 'flow'} onclick={() => app.setView('flow')}>Cover Flow</button>
          <button class:on={app.view === 'folders'} onclick={() => app.setView('folders')}>Folders</button>
        </nav>
        <kbd class="tabhint" title="Shift-Tab switches">⇧Tab</kbd>
      {/if}
      <span class="status">
        {#if app.status}{app.status}{:else if app.section === 'watch'}{watchCount()}{:else if app.loading}Loading {app.loading}…{:else}{app.albums.length} albums{/if}
      </span>
      <button class="user" onclick={() => app.logout()} title="Log out">{app.session.userName} · log out</button>
    </header>
    <main>
      {#if app.videoLibraries.length}
        <div class="view" hidden={app.view !== 'watch'}><Watch /></div>
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
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="help" onclick={() => (app.help = false)}>
      <div class="sheet">
        {#each help as [title, keys] (title)}
          <h3>{title}</h3>
          <dl>
            {#each keys as [k, what] (k)}<dt>{k}</dt><dd>{what}</dd>{/each}
          </dl>
        {/each}
      </div>
    </div>
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
  /* Listen's own two: smaller, quieter than Watch | Listen */
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
  .help {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.7);
    display: grid;
    place-items: center;
    z-index: 1000;
  }
  .sheet {
    width: min(720px, calc(100% - 32px));
    max-height: calc(100% - 64px);
    overflow-y: auto;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 6px 24px 18px;
  }
  h3 {
    margin: 16px 0 8px;
    color: var(--accent);
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  dl {
    display: grid;
    grid-template-columns: 9em 1fr;
    gap: 5px 14px;
    margin: 0;
  }
  dt {
    font: 13px var(--mono);
    color: var(--text);
  }
  dd {
    margin: 0;
    color: var(--text-2);
  }
</style>
