<!--
  At an episode's end: the next one, in Netflix's corner card on glass, with
  the seconds before it starts; Play now, or Back.
-->
<script lang="ts">
  import { app } from './state.svelte.ts'
  import type { Showing } from './watch.svelte.ts'

  interface Props {
    next: Showing
    /** Seconds before it starts */
    count: number
    onplay: () => void
    onback: () => void
  }
  let { next, count, onplay, onback }: Props = $props()
</script>

<div class="upnext" role="status">
  {#if next.poster.tag && app.client}
    <img src={app.client.posterUrl(next.poster.id, next.poster.tag, 200)} alt="" />
  {/if}
  <div class="what">
    <div class="when">Next episode in {count}</div>
    <div class="title">{next.sub}</div>
    <div class="buttons">
      <button class="play" onclick={onplay}>▶ Play now <kbd>Enter</kbd></button>
      <button onclick={onback}>Back <kbd>Esc</kbd></button>
    </div>
  </div>
</div>

<style>
  .upnext {
    position: absolute;
    right: 24px;
    bottom: 110px;
    z-index: 4;
    display: flex;
    gap: 14px;
    width: min(420px, calc(100% - 48px));
    padding: 12px;
    border-radius: 12px;
    background: var(--glass), rgb(18 18 22 / 0.92);
    box-shadow: var(--glass-edge);
  }
  .upnext img {
    width: 72px;
    height: 108px;
    object-fit: cover;
    border-radius: 4px;
    flex: none;
  }
  .upnext .what {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .upnext .when {
    font-size: 13px;
    color: var(--text-2);
  }
  .upnext .title {
    font-size: 16px;
    font-weight: 650;
  }
  .upnext .buttons {
    display: flex;
    gap: 8px;
    margin-top: auto;
  }
  .upnext button {
    border: 0;
    border-radius: 999px;
    padding: 6px 14px;
    background: rgb(255 255 255 / 0.12);
    color: var(--text);
    font-size: 14px;
  }
  .upnext button.play {
    background: var(--text);
    color: #000;
    font-weight: 650;
  }
  .upnext kbd {
    font-size: 11px;
    margin-left: 4px;
    opacity: 0.7;
  }
</style>
