<!-- An album's tracks, with a cursor; the one playing is marked. -->
<script lang="ts">
  import { duration } from '../core/details.ts'
  import type { Track } from '../core/library.ts'
  import { player } from './player.svelte.ts'
  import Playing from './Playing.svelte'

  interface Props {
    tracks: Track[]
    cursor?: number | undefined
    onplay: (index: number) => void
  }
  let { tracks, cursor, onplay }: Props = $props()

  const discs = $derived(new Set(tracks.map((t) => t.disc ?? 1)).size)
  let list = $state<HTMLOListElement>()

  function number(t: Track): string {
    if (t.number === undefined) return ''
    return discs > 1 ? `${t.disc ?? 1}-${String(t.number).padStart(2, '0')}` : String(t.number)
  }

  // the cursor's row in view: the list scrolls, nothing around it (it may sit in a 3D scene)
  $effect(() => {
    if (cursor === undefined || !list) return
    const row = list.children[cursor]
    if (!(row instanceof HTMLElement)) return
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight
  })
</script>

<ol bind:this={list}>
  {#each tracks as track, i (track.id)}
    <li class:cursor={i === cursor} class:playing={player.current?.id === track.id}>
      <button onclick={() => onplay(i)}>
        <span class="n">{#if player.current?.id === track.id}<Playing />{:else}{number(track)}{/if}</span>
        <span class="t">{track.title}</span>
        <span class="d">{duration(track.seconds)}</span>
      </button>
    </li>
  {/each}
</ol>

<style>
  ol {
    position: relative;
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
  }
  button {
    display: grid;
    grid-template-columns: 3.2em 1fr auto;
    gap: 10px;
    width: 100%;
    background: none;
    border: 0;
    border-radius: 5px;
    padding: 5px 10px;
    text-align: left;
    color: var(--text-2);
  }
  button:hover {
    background: var(--hover);
  }
  .cursor button {
    background: var(--glass);
    box-shadow: var(--glass-edge);
    color: var(--text);
  }
  .playing .t {
    color: var(--text);
    font-weight: 600;
  }
  .n,
  .d {
    font: 13px var(--mono);
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
    align-self: center;
  }
  .n {
    text-align: right;
  }
  .t {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
