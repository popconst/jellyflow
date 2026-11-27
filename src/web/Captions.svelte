<!--
  The subtitles over the picture, drawn from Jellyfin's WebVTT: the lines of
  the moment, followed frame by frame while it plays (not only on each
  timeupdate); up a little while the controls show.
-->
<script lang="ts">
  import { linesAt, type Cue } from '../lib/vtt/index.ts'

  interface Props {
    video: HTMLVideoElement | undefined
    cues: Cue[]
    paused: boolean
    /** The controls are showing: the lines go up out of their way */
    raised: boolean
  }
  let { video, cues, paused, raised }: Props = $props()

  /** The time the lines are for */
  let now = $state(0)
  const lines = $derived(linesAt(cues, now))

  $effect(() => {
    const v = video
    if (!v) return
    now = v.currentTime
    if (!cues.length || paused) return
    let frame = 0
    const tick = () => {
      now = v.currentTime
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  })
</script>

{#if lines.length}
  <div class="captions" class:raised>
    {#each lines as line, i (i)}<span>{line}</span>{/each}
  </div>
{/if}

<style>
  /* white on a dark box, like YouTube's */
  .captions {
    position: absolute;
    left: 50%;
    bottom: 6%;
    z-index: 1;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    width: max-content;
    max-width: 86%;
    text-align: center;
    transition: bottom 250ms;
    pointer-events: none;
  }
  .captions.raised {
    bottom: calc(6% + 70px);
  }
  .captions span {
    padding: 1px 8px;
    font-size: clamp(18px, 2.6vw, 36px);
    line-height: 1.3;
    color: #fff;
    background: rgb(8 8 8 / 0.75);
    border-radius: 3px;
    white-space: pre-wrap;
  }
</style>
