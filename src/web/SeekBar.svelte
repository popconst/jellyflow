<!--
  The film's seek bar, YouTube's way: what's played in the poster's colours
  over what's loaded; under the pointer it thickens, shows its knob and the
  time there; a drag scrubs (the time follows it), and lets go to seek.
-->
<script lang="ts">
  import { duration } from '../core/details.ts'

  interface Props {
    /** Seconds: where it's playing, how long it is, how far it's loaded */
    time: number
    length: number
    buffered: number
    /** What's played, painted: the poster's colours */
    fill: string | undefined
    /** Where a drag is taking it, while it does */
    scrubAt?: number | undefined
    onseek: (seconds: number) => void
  }
  let { time, length, buffered, fill, scrubAt = $bindable(), onseek }: Props = $props()

  let bar = $state<HTMLElement>()
  /** Where the pointer is over it */
  let hoverAt = $state<number | undefined>()
  const at = $derived(scrubAt ?? time)

  function timeAt(e: PointerEvent): number {
    const r = bar?.getBoundingClientRect()
    if (!r || !r.width) return 0
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * length
  }

  function onpointerdown(e: PointerEvent): void {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    scrubAt = timeAt(e)
  }

  function onpointermove(e: PointerEvent): void {
    hoverAt = timeAt(e)
    if (scrubAt !== undefined) scrubAt = hoverAt
  }

  function onpointerup(): void {
    if (scrubAt === undefined) return
    onseek(scrubAt)
    scrubAt = undefined
  }
</script>

<div
  class="seek"
  bind:this={bar}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  onpointercancel={() => (scrubAt = undefined)}
  onpointerleave={() => (hoverAt = undefined)}
  role="slider"
  tabindex="-1"
  aria-label="Seek"
  aria-valuemin={0}
  aria-valuemax={Math.round(length)}
  aria-valuenow={Math.round(at)}
>
  <div class="rail">
    <div class="buffered" style:width="{(buffered / length) * 100}%"></div>
    <div class="done" style:width="{(at / length) * 100}%" style:background={fill}></div>
  </div>
  <div class="knob" style:left="{(at / length) * 100}%"></div>
  {#if hoverAt !== undefined}
    <div class="tip" style:left="{(hoverAt / length) * 100}%">{duration(hoverAt)}</div>
  {/if}
</div>

<style>
  .seek {
    position: relative;
    height: 18px;
    display: flex;
    align-items: center;
    cursor: pointer;
    touch-action: none;
  }
  .rail {
    position: relative;
    width: 100%;
    height: 4px;
    border-radius: 2px;
    background: rgb(255 255 255 / 0.22);
    overflow: hidden;
    transition: height 120ms;
  }
  .seek:hover .rail {
    height: 6px;
  }
  .buffered,
  .done {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
  }
  .buffered {
    background: rgb(255 255 255 / 0.35);
  }
  .done {
    background: linear-gradient(90deg, var(--accent-2), var(--accent));
  }
  .knob {
    position: absolute;
    top: 50%;
    width: 14px;
    height: 14px;
    margin: -7px 0 0 -7px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.6);
    transform: scale(0);
    transition: transform 120ms;
  }
  .seek:hover .knob {
    transform: scale(1);
  }
  .tip {
    position: absolute;
    bottom: 22px;
    transform: translateX(-50%);
    padding: 3px 8px;
    border-radius: 6px;
    font: 12px var(--mono);
    background: var(--glass), rgb(20 20 24 / 0.85);
    box-shadow: var(--glass-edge);
    pointer-events: none;
  }
</style>
