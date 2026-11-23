<!--
  The library's folders as on disk, in columns (ranger / yazi style): the
  folder above, this folder, and a preview of what's under the cursor, with
  album art all the way. Vim motions: counts, gg/G, Ctrl-d/u/f/b, H/M/L, zz,
  / with n/N.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import { duration, links } from '../core/details.ts'
  import { folderName, seconds, type Item } from '../core/jellyfin.ts'
  import { Keys, keyName } from '../core/keys.ts'
  import { fold, toAlbum, toTrack, type Album } from '../core/library.ts'
  import Cover from './Cover.svelte'
  import Details from './Details.svelte'
  import Disc from './Disc.svelte'
  import { player } from './player.svelte.ts'
  import Playing from './Playing.svelte'
  import { app, store, stored, typing } from './state.svelte.ts'
  import TrackList from './TrackList.svelte'

  /** A row's height in the lists, px: H / M / L and paging count on it */
  const ROW = 52

  /** The folders from the library's top down to the one shown */
  let stack = $state.raw<Item[]>([])
  /** What's in each folder visited, by id */
  let lists = $state.raw(new Map<string, Item[]>())
  let cursor = $state(0)
  /** Where the cursor was in each folder left */
  const cursors = new Map<string, number>()
  const inflight = new Map<string, Promise<Item[]>>()
  let info = $state(false)
  let searching = $state(false)
  let searchQuery = $state('')
  let searchFrom = 0
  /** The last search, for n / N */
  let pattern = $state('')
  let list = $state<HTMLOListElement>()
  let searchInput = $state<HTMLInputElement>()
  const keys = new Keys()
  /** A count or g typed so far */
  let pending = $state('')
  let generation = 0
  /** Where c came from, for o to go back to (and o again to return) */
  let back: { stack: Item[]; cursor: number } | undefined

  const folder = $derived(stack.at(-1))
  const parent = $derived(stack.at(-2))
  const items = $derived(folder ? (lists.get(folder.Id) ?? []) : [])
  const parentItems = $derived(parent ? (lists.get(parent.Id) ?? []) : [])
  const selected = $derived<Item | undefined>(items[cursor])
  const preview = $derived(selected?.IsFolder ? lists.get(selected.Id) : undefined)
  const album = $derived(albumOf(selected))
  /** Up to four album covers under each folder, by its path: art for folders without their own */
  const art = $derived.by(() => {
    const under = new Map<string, Album[]>()
    for (const a of app.albums) {
      if (!a.imageTag) continue
      for (let dir = a.path; (dir = dir.slice(0, dir.lastIndexOf('/'))).length > 1; ) {
        const covers = under.get(dir) ?? []
        if (covers.length < 4) under.set(dir, [...covers, a])
      }
    }
    return under
  })

  function label(item: Item): string {
    return item.IsFolder ? folderName(item) : item.Name
  }

  function albumOf(item: Item | undefined): Album | undefined {
    const id = item?.Type === 'MusicAlbum' ? item.Id : item?.Type === 'Audio' ? item.AlbumId : undefined
    if (!id) return undefined
    return app.albums.find((a) => a.id === id) ?? (item?.Type === 'MusicAlbum' ? toAlbum(item) : undefined)
  }

  async function load(id: string): Promise<Item[]> {
    const have = lists.get(id)
    if (have) return have
    const client = app.client
    if (!client) return []
    let request = inflight.get(id)
    if (!request) {
      request = client.children(id)
      inflight.set(id, request)
    }
    try {
      const children = await request
      lists = new Map(lists).set(id, children)
      return children
    } catch (e) {
      app.fail(e)
      return []
    } finally {
      inflight.delete(id)
    }
  }

  // start at the library's top; after a library change, read the open folders again in place
  $effect(() => {
    const library = app.library
    const reloaded = app.reloaded
    if (!library) return
    untrack(() => {
      if (stack[0]?.Id !== library.Id) {
        // where it was last time, if that was in this library
        const saved = stored<{ stack: Item[]; cursor: number }>('jellyflow.folders')
        const resume = saved?.stack[0]?.Id === library.Id ? saved : undefined
        lists = new Map()
        stack = resume?.stack ?? [library]
        cursor = resume?.cursor ?? 0
        for (const f of stack) void load(f.Id)
      } else if (reloaded !== generation) void refresh()
      generation = reloaded
    })
  })

  async function refresh(): Promise<void> {
    const keep = selected?.Id
    lists = new Map()
    await Promise.all(stack.map((f) => load(f.Id)))
    const at = items.findIndex((i) => i.Id === keep)
    move(at >= 0 ? at : cursor)
  }

  // the open folder and the cursor are remembered, for the next visit
  $effect(() => {
    const folders = stack.map(({ Id, Name, Type, IsFolder, Path, ImageTags }) => ({ Id, Name, Type, IsFolder, Path, ImageTags }))
    const at = cursor
    if (!folders.length) return
    const timer = setTimeout(() => store('jellyflow.folders', { stack: folders, cursor: at }), 400)
    return () => clearTimeout(timer)
  })

  // the folder under the cursor, read ahead for the preview
  $effect(() => {
    const item = selected
    if (!item?.IsFolder || lists.has(item.Id)) return
    const timer = setTimeout(() => void load(item.Id), 90)
    return () => clearTimeout(timer)
  })

  $effect(() => {
    list?.children[cursor]?.scrollIntoView({ block: 'nearest' })
  })

  function move(to: number): void {
    if (items.length) cursor = Math.max(0, Math.min(to, items.length - 1))
  }

  async function enter(item: Item | undefined = selected): Promise<void> {
    if (!item?.IsFolder || !folder) return
    cursors.set(folder.Id, cursor)
    stack = [...stack, item]
    cursor = cursors.get(item.Id) ?? 0
    info = false
    await load(item.Id)
  }

  /** A tile in the preview: into the folder under the cursor, onto that item */
  async function openAt(item: Item): Promise<void> {
    await enter()
    move(items.findIndex((i) => i.Id === item.Id))
  }

  /** Back to the folder above, the cursor on the one just left */
  function up(levels = 1): void {
    const target = Math.max(1, stack.length - levels)
    if (target === stack.length || !folder) return
    cursors.set(folder.Id, cursor)
    const left = stack[target]
    stack = stack.slice(0, target)
    cursor = Math.max(0, items.findIndex((i) => i.Id === left?.Id))
  }

  /** Enter: an album plays, a track plays its folder from there, a folder opens */
  async function activate(): Promise<void> {
    const item = selected
    if (!item) return
    if (item.Type === 'Audio') playFrom(items, item)
    else if (item.Type === 'MusicAlbum') await playAlbum(item)
    else await enter(item)
  }

  function playFrom(siblings: Item[], item: Item): void {
    const tracks = siblings.filter((i) => i.Type === 'Audio')
    player.play(tracks.map(toTrack), Math.max(0, tracks.indexOf(item)))
    app.say(`Playing ${item.Name}`)
  }

  async function playAlbum(item: Item): Promise<void> {
    try {
      player.play((await app.albumTracks(item.Id)).map(toTrack))
      app.say(`Playing ${label(item)}`)
    } catch (e) {
      app.fail(e)
    }
  }

  /** a: the track, the album, or everything under the folder, to the end of the queue */
  async function add(): Promise<void> {
    const item = selected
    const client = app.client
    if (!item || !client) return
    try {
      const tracks =
        item.Type === 'Audio'
          ? [item]
          : item.Type === 'MusicAlbum'
            ? await app.albumTracks(item.Id)
            : await client.tracksUnder(item.Id)
      player.add(tracks.map(toTrack))
      app.say(`Added ${tracks.length === 1 ? '1 track' : `${tracks.length} tracks`} to the queue`)
    } catch (e) {
      app.fail(e)
    }
  }

  /** c: the folder of the track playing, the cursor on it */
  async function reveal(): Promise<void> {
    const track = player.current
    const client = app.client
    const library = app.library
    if (!track || !client || !library) return
    try {
      const ancestors = await client.ancestors(track.id)
      const top = ancestors.findIndex((a) => a.Id === library.Id)
      if (top < 0) return app.say('That track isn’t in this library’s folders')
      const path = ancestors.slice(0, top + 1).reverse()
      await Promise.all(path.map((f) => load(f.Id)))
      if (folder) cursors.set(folder.Id, cursor)
      back = { stack, cursor }
      stack = path
      move(items.findIndex((i) => i.Id === track.id))
    } catch (e) {
      app.fail(e)
    }
  }

  /** o: back to where c came from; o again goes back there */
  async function jumpBack(): Promise<void> {
    if (!back) return
    const to = back
    back = { stack, cursor }
    await Promise.all(to.stack.map((f) => load(f.Id)))
    if (folder) cursors.set(folder.Id, cursor)
    stack = to.stack
    move(to.cursor)
  }

  function goTo(depth: number): void {
    up(stack.length - 1 - depth)
  }

  function rows(): number {
    return Math.max(1, Math.floor((list?.clientHeight ?? ROW * 10) / ROW))
  }

  function topRow(): number {
    return Math.ceil((list?.scrollTop ?? 0) / ROW)
  }

  function center(): void {
    if (list) list.scrollTop = cursor * ROW - list.clientHeight / 2 + ROW / 2
  }

  /** The next item (from `start`, going `dir`, wrapping) whose name has `query` in it */
  function findFrom(start: number, query: string, dir: 1 | -1): number {
    const n = items.length
    const q = fold(query)
    for (let k = 0; k < n; k++) {
      const i = (((start + dir * k) % n) + n) % n
      const item = items[i]
      if (item && fold(label(item)).includes(q)) return i
    }
    return -1
  }

  function onSearchInput(): void {
    pattern = searchQuery
    const at = searchQuery ? findFrom(searchFrom, searchQuery, 1) : searchFrom
    if (at >= 0) cursor = at
  }

  function onSearchKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') searching = false
    else if (e.key === 'Escape') {
      cursor = searchFrom
      searching = false
    } else return
    e.preventDefault()
  }

  function run(key: string, count: number | undefined): boolean {
    const n = count ?? 1
    switch (key) {
      case 'j':
      case '<Down>':
        move(cursor + n)
        break
      case 'k':
      case '<Up>':
        move(cursor - n)
        break
      case 'l':
      case '<Right>':
        void (selected?.IsFolder ? enter() : activate())
        break
      case 'h':
      case '<Left>':
      case '-':
      case '<BS>':
        up(n)
        break
      case '<Enter>':
        void activate()
        break
      case 'gg':
      case '<Home>':
        move(count ? count - 1 : 0)
        break
      case 'G':
      case '<End>':
        move(count ? count - 1 : items.length - 1)
        break
      case '<C-d>':
        move(cursor + Math.max(1, Math.floor(rows() / 2)))
        break
      case '<C-u>':
        move(cursor - Math.max(1, Math.floor(rows() / 2)))
        break
      case '<C-f>':
      case '<PageDown>':
        move(cursor + rows() * n)
        break
      case '<C-b>':
      case '<PageUp>':
        move(cursor - rows() * n)
        break
      case 'H':
        move(topRow())
        break
      case 'M':
        move(topRow() + Math.floor((Math.min(rows(), items.length - topRow()) - 1) / 2))
        break
      case 'L':
        move(topRow() + rows() - 1)
        break
      case 'zz':
        center()
        break
      case '/':
        searching = true
        searchQuery = ''
        searchFrom = cursor
        break
      case 'n':
      case 'N': {
        const at = pattern ? findFrom(cursor + (key === 'n' ? 1 : -1), pattern, key === 'n' ? 1 : -1) : -1
        if (at >= 0) cursor = at
        break
      }
      case 'a':
        void add()
        break
      case 'i':
        info = !info && album !== undefined
        break
      case 'c':
        void reveal()
        break
      case 'o':
        void jumpBack()
        break
      case '~':
      case 'gh':
        goTo(0)
        break
      case 'd':
      case 'w':
      case 'm': {
        const link = album ? links(album).find((l) => l.key === key) : undefined
        if (!link) return false
        window.open(link.url, '_blank', 'noopener')
        app.say(`Opened ${link.name}`)
        break
      }
      case '<Esc>':
        if (!info) return false
        info = false
        break
      default:
        return false
    }
    return true
  }

  function onkeydown(e: KeyboardEvent): void {
    if (app.view !== 'folders' || typing(e) || e.defaultPrevented || app.help) return
    const name = keyName(e)
    if (!name) return
    const command = keys.feed(name)
    pending = keys.pending
    if (!command) e.preventDefault()
    else if (run(command.key, command.count)) e.preventDefault()
  }

  $effect(() => {
    if (searching) searchInput?.focus()
  })
</script>

<svelte:window {onkeydown} />

{#snippet thumb(item: Item, size: number, play?: () => void)}
  {#if item.Type === 'Audio'}
    {@const playing = player.current?.id === item.Id}
    <span class="num">
      <span class="number">{#if playing}<Playing />{:else}{item.IndexNumber ?? '·'}{/if}</span>
      <!-- a track's play button, under the pointer: a click plays from it, or pauses (and plays on) the one
           playing; a click on the row only moves the cursor -->
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <span
        class="go"
        onclick={(e) => {
          e.stopPropagation()
          if (playing) player.toggle()
          else play?.()
        }}><Disc sign={playing && !player.paused ? 'pause' : 'play'} size={22} /></span
      >
    </span>
  {:else if item.ImageTags?.['Primary'] || item.Type === 'MusicAlbum'}
    <Cover id={item.Id} tag={item.ImageTags?.['Primary']} {size} title={label(item)} />
  {:else}
    {@const covers = art.get(item.Path ?? '') ?? []}
    {#if covers.length >= 4}
      <span class="mosaic">
        {#each covers as a (a.id)}<Cover id={a.id} tag={a.imageTag} size={size / 2} title={a.title} />{/each}
      </span>
    {:else if covers[0]}
      <Cover id={covers[0].id} tag={covers[0].imageTag} {size} title={label(item)} />
    {:else}
      <span class="folder">{label(item).slice(0, 1).toUpperCase()}</span>
    {/if}
  {/if}
{/snippet}

{#snippet row(item: Item, active: boolean, onclick: () => void, ondblclick?: () => void)}
  <!-- a track's play button: the cursor to it, then what a double click does (play from it) -->
  {@const play = ondblclick
    ? () => {
        onclick()
        ondblclick()
      }
    : undefined}
  <li class:cursor={active} class:playing={player.current?.id === item.Id}>
    <button {onclick} {ondblclick}>
      <span class="thumb">{@render thumb(item, 96, play)}</span>
      <span class="name">{label(item)}</span>
      {#if item.Type === 'Audio'}<span class="meta">{duration(seconds(item.RunTimeTicks))}</span>
      {:else if item.IsFolder}<span class="meta">›</span>{/if}
    </button>
  </li>
{/snippet}

<section class="folders">
  <nav class="crumbs">
    {#each stack as f, depth (f.Id)}
      <button onclick={() => goTo(depth)} class:here={depth === stack.length - 1}>
        {depth === 0 ? f.Name : label(f)}
      </button>
      {#if depth < stack.length - 1}<span class="sep">/</span>{/if}
    {/each}
    <span class="pos">{items.length ? cursor + 1 : 0} / {items.length}</span>
  </nav>

  <div class="cols">
    <ol class="col parent">
      {#each parentItems as item (item.Id)}
        {@render row(item, item.Id === folder?.Id, () => goTo(stack.length - 2))}
      {/each}
    </ol>

    <ol class="col here" bind:this={list}>
      {#each items as item, i (item.Id)}
        {@render row(
          item,
          i === cursor,
          () => (cursor = i),
          () => void activate(),
        )}
      {/each}
    </ol>

    <div class="col preview">
      {#if info && album}
        <Details {album} />
      {:else if selected?.Type === 'MusicAlbum'}
        <div class="album">
          <div class="art"><Cover id={selected.Id} tag={selected.ImageTags?.['Primary']} size={600} title={selected.Name} /></div>
          <div class="title">{selected.Name}</div>
          <div class="sub">{album?.artist ?? ''}{album?.year ? ` · ${album.year}` : ''}</div>
        </div>
        {#if preview}
          {@const tracks = preview.filter((i) => i.Type === 'Audio')}
          <TrackList tracks={tracks.map(toTrack)} onplay={(i) => tracks[i] && playFrom(tracks, tracks[i])} />
        {/if}
      {:else if selected?.IsFolder}
        {#if preview}
          <div class="grid">
            {#each preview as item (item.Id)}
              <button class="tile" onclick={() => void openAt(item)}>
                <span class="tile-art">{@render thumb(item, 300)}</span>
                <span class="tile-name">{label(item)}</span>
              </button>
            {/each}
          </div>
        {:else}
          <p class="muted">Reading the folder…</p>
        {/if}
      {:else if selected?.Type === 'Audio'}
        <div class="album">
          <div class="art"><Cover id={selected.AlbumId} tag={selected.AlbumPrimaryImageTag} size={600} title={selected.Album ?? ''} /></div>
          <div class="title">{selected.Name}</div>
          <div class="sub">{selected.Artists?.join(', ') ?? ''} · {duration(seconds(selected.RunTimeTicks))}</div>
          <div class="sub">{selected.Album ?? ''}</div>
        </div>
      {/if}
    </div>
  </div>

  <div class="line">
    {#if searching}
      <span class="slash">/</span>
      <input
        bind:this={searchInput}
        bind:value={searchQuery}
        oninput={onSearchInput}
        onkeydown={onSearchKey}
        spellcheck="false"
        autocomplete="off"
        placeholder="name in this folder"
      />
    {:else}
      <span class="pending">{pending}</span>
      {#if pattern}<span class="hint">/{pattern} · <kbd>n</kbd> <kbd>N</kbd></span>{/if}
    {/if}
  </div>
</section>

<style>
  .folders {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .crumbs {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
    overflow: hidden;
  }
  .crumbs button {
    background: none;
    border: 0;
    padding: 2px 4px;
    color: var(--text-2);
    border-radius: 4px;
  }
  .crumbs button:hover {
    background: var(--panel-2);
  }
  .crumbs .here {
    color: var(--text);
    font-weight: 600;
  }
  .sep {
    color: var(--text-3);
  }
  .pos {
    margin-left: auto;
    font: 13px var(--mono);
    color: var(--text-2);
  }
  .cols {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 22fr) minmax(0, 36fr) minmax(0, 42fr);
  }
  .col {
    min-height: 0;
    overflow-y: auto;
    margin: 0;
    padding: 6px;
    list-style: none;
  }
  .col + .col {
    border-left: 1px solid var(--line);
  }
  .parent {
    opacity: 0.85;
  }
  li button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 52px;
    padding: 0 8px;
    background: none;
    border: 0;
    border-radius: 6px;
    text-align: left;
  }
  li button:hover {
    background: var(--hover);
  }
  li.cursor button {
    background: var(--glass);
    box-shadow: var(--glass-edge);
  }
  li.playing .name {
    color: var(--text);
    font-weight: 600;
  }
  .thumb {
    width: 40px;
    height: 40px;
    flex: none;
    border-radius: 3px;
    overflow: hidden;
    display: grid;
    place-items: center;
  }
  /* the number, and over it the play button, in one place; the button shows under the pointer */
  .num .number,
  .num .go {
    grid-area: 1 / 1;
  }
  .num .go {
    opacity: 0;
    cursor: pointer;
  }
  li:hover .go {
    opacity: 1;
  }
  li:hover .number {
    opacity: 0;
  }
  .num,
  .folder {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    font: 13px var(--mono);
    color: var(--text-2);
    background: var(--panel);
  }
  .mosaic {
    width: 100%;
    height: 100%;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
  }
  .folder {
    font: 600 18px var(--font);
    color: var(--text);
    background: linear-gradient(135deg, var(--accent-2), var(--accent));
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font: 13px var(--mono);
    color: var(--text-3);
  }
  .preview {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
  }
  .album {
    text-align: center;
  }
  .art {
    width: min(100%, 38vh);
    aspect-ratio: 1;
    margin: 0 auto 10px;
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 8px 30px rgb(0 0 0 / 0.6);
  }
  .title {
    font-size: 18px;
    font-weight: 700;
  }
  .sub {
    color: var(--text-2);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 14px;
    align-content: start;
  }
  .tile {
    background: none;
    border: 0;
    padding: 0;
    text-align: left;
  }
  .tile-art {
    display: block;
    aspect-ratio: 1;
    border-radius: 4px;
    overflow: hidden;
  }
  .tile-art .folder {
    font-size: 40px;
  }
  .tile-name {
    display: block;
    margin-top: 5px;
    font-size: 13px;
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .muted {
    color: var(--text-3);
  }
  .line {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 36px;
    padding: 0 16px;
    border-top: 1px solid var(--line);
    font: 14px var(--mono);
  }
  .slash {
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
  .pending {
    color: var(--hi);
  }
  .hint {
    color: var(--text-2);
  }
</style>
