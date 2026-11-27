<!--
  What's playing, at the bottom, in the album page's look: the cover's art
  blurred behind it, a slim seek bar in the album's own colours.
-->
<script lang="ts">
  import { duration } from '../core/details.ts'
  import Cover from './Cover.svelte'
  import { coverColours, seekFill, stops } from './palette.ts'
  import { player } from './player.svelte.ts'
  import { app } from './state.svelte.ts'

  /** The playing album's colours, for the seek bar; the app's own without a cover */
  let colours = $state<string[]>([])
  $effect(() => {
    const t = player.current
    if (!t?.imageTag || !app.client) {
      colours = []
      return
    }
    let live = true
    void coverColours(t.albumId, t.imageTag).then((c) => {
      if (live) colours = stops(c)
    })
    return () => {
      live = false
    }
  })

  const backdrop = $derived(
    player.current?.imageTag && app.client
      ? app.client.imageUrl(player.current.albumId, player.current.imageTag, 300)
      : undefined,
  )
  const fill = $derived(seekFill(colours))
  const done = $derived(player.duration ? (player.time / player.duration) * 100 : 0)

  function seek(e: MouseEvent) {
    const bar = e.currentTarget as HTMLElement
    const at = (e.clientX - bar.getBoundingClientRect().left) / bar.clientWidth
    if (player.duration) player.seek(at * player.duration)
  }
</script>

<footer class="player">
  {#if backdrop}<img class="backdrop" src={backdrop} alt="" />{/if}
  {#if player.current}
    {@const t = player.current}
    <div class="cover"><Cover id={t.albumId} tag={t.imageTag} size={96} title={t.album} /></div>
    <div class="what">
      <div class="title">{t.title}</div>
      <div class="sub">{t.artist} — {t.album}</div>
    </div>
    <div class="controls">
      <button onclick={() => player.prev()} title="Previous (<)" aria-label="Previous">
        <svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM20 5v14L9 12z" /></svg>
      </button>
      <button class="play" onclick={() => player.toggle()} title="Play / pause (Space)" aria-label="Play or pause">
        {#if player.paused}
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
        {:else}
          <svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
        {/if}
      </button>
      <button onclick={() => player.next()} title="Next (>)" aria-label="Next">
        <svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM4 5l11 7-11 7z" /></svg>
      </button>
    </div>
    <div class="time">{duration(player.time)}</div>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="bar"
      role="slider"
      tabindex="-1"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(player.duration)}
      aria-valuenow={Math.round(player.time)}
      onclick={seek}
    >
      <div class="done" style:width="{done}%" style:background={fill}></div>
      <div class="knob" style:left="{done}%"></div>
    </div>
    <div class="time">{duration(player.duration)}</div>
    {#if player.waiting}
      <div class="chip waiting" title="The browser only lets sound start from a key press or click">any key plays on</div>
    {/if}
    {#if player.quality}
      <div class="chip" class:hires={player.quality.hiRes} title={player.quality.note}>{player.quality.text}</div>
    {/if}
    <div class="chip queue" title="In the queue">{player.index + 1} / {player.queue.length}</div>
  {:else}
    <div class="idle">
      Nothing playing{player.queue.length ? ` · ${player.queue.length} in the queue (Space)` : ''} · <kbd>?</kbd> keys
    </div>
  {/if}
</footer>

<style>
  .player {
    position: relative;
    display: flex;
    align-items: center;
    gap: 16px;
    height: 68px;
    padding: 0 18px;
    overflow: hidden;
    background: #0b0b0d;
    border-top: 1px solid rgb(255 255 255 / 0.07);
  }
  /* the playing album's art, blurred into the dark: the back cover again */
  .backdrop {
    position: absolute;
    inset: -60px;
    width: calc(100% + 120px);
    height: calc(100% + 120px);
    object-fit: cover;
    filter: blur(40px) brightness(0.33) saturate(1.3);
    pointer-events: none;
  }
  .player > :not(.backdrop) {
    position: relative;
  }
  .cover {
    width: 46px;
    height: 46px;
    flex: none;
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.5);
  }
  .what {
    min-width: 0;
    width: min(320px, 28vw);
  }
  .title,
  .sub {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title {
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  .sub {
    color: var(--text-2);
    font-size: 13px;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  button {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--text);
  }
  button:hover {
    background: rgb(255 255 255 / 0.1);
  }
  svg {
    width: 18px;
    height: 18px;
    fill: currentColor;
  }
  .play {
    width: 38px;
    height: 38px;
    background: var(--text);
    color: #000;
  }
  .play:hover {
    background: #fff;
    transform: scale(1.05);
  }
  .play svg {
    width: 20px;
    height: 20px;
  }
  .bar {
    position: relative;
    flex: 1;
    height: 4px;
    border-radius: 2px;
    background: rgb(255 255 255 / 0.14);
    cursor: pointer;
    transition: height 120ms;
  }
  .bar:hover {
    height: 6px;
  }
  .done {
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--accent-2), var(--accent));
  }
  .knob {
    position: absolute;
    top: 50%;
    width: 12px;
    height: 12px;
    margin: -6px 0 0 -6px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.5);
    opacity: 0;
    transition: opacity 120ms;
  }
  .bar:hover .knob {
    opacity: 1;
  }
  .time {
    font: 12px var(--mono);
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  .chip {
    font: 11px var(--mono);
    color: var(--text);
    background: rgb(255 255 255 / 0.09);
    border-radius: 999px;
    padding: 3px 10px;
    white-space: nowrap;
  }
  .chip.hires {
    color: #000;
    background: var(--hi);
    font-weight: 600;
  }
  .queue {
    color: var(--text-2);
  }
  /* after a reload, until a key press lets the sound start */
  .waiting {
    color: var(--text);
    background: var(--glass);
    box-shadow: var(--glass-edge);
    animation: breathe 1.6s ease-in-out infinite alternate;
  }
  @keyframes breathe {
    from {
      opacity: 0.6;
    }
    to {
      opacity: 1;
    }
  }
  .idle {
    color: var(--text-2);
  }
</style>
