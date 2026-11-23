<!--
  The mark of the track playing in a list: four bars in its album's colours,
  like the spectrum's, that move with its sound (bass to treble); paused,
  two of them stand still, a pause sign.
-->
<script lang="ts">
  import { levels, tap } from './levels.ts'
  import { coverColours, stops } from './palette.ts'
  import { player } from './player.svelte.ts'

  /** How tall the bars stand at the quietest */
  const LOW = 0.12

  let colours = $state(stops([]))
  $effect(() => {
    const t = player.current
    if (!t) return
    let live = true
    void coverColours(t.albumId, t.imageTag).then((c) => {
      if (live) colours = stops(c)
    })
    return () => {
      live = false
    }
  })

  // the bars follow the sound, frame by frame, while it plays
  let heights = $state([LOW, LOW, LOW, LOW])
  $effect(() => {
    const source = player.source
    if (!source || player.paused) return
    const analyser = tap(source)
    const data = new Uint8Array(analyser.frequencyBinCount)
    let frame = 0
    const tick = () => {
      heights = levels(analyser, data).map((l) => LOW + (1 - LOW) * l)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  })
</script>

<span
  class="bars"
  class:paused={player.paused}
  style:--fill="linear-gradient(to bottom, {colours.join(', ')})"
  role="img"
  aria-label={player.paused ? 'Paused' : 'Playing'}
>
  {#if player.paused}<i></i><i></i>
  {:else}
    {#each heights as h, i (i)}<i style:transform="scaleY({h.toFixed(3)})"></i>{/each}
  {/if}
</span>

<style>
  .bars {
    display: inline-flex;
    align-items: flex-end;
    gap: 2px;
    height: 13px;
    vertical-align: -1px;
  }
  i {
    width: 3px;
    height: 100%;
    border-radius: 1px;
    background: var(--fill);
    transform-origin: 50% 100%;
    filter: drop-shadow(0 0 3px rgb(255 255 255 / 0.25));
  }
  /* paused: ❚❚, as wide as the four bars */
  .paused {
    gap: 4px;
  }
  .paused i {
    width: 4px;
  }
</style>
