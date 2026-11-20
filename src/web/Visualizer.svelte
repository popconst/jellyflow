<!--
  The spectrum of what's playing (audioMotion-analyzer): 1/24-octave bands,
  about 240 bars on a log scale, peaks that hang and fall, a soft reflection,
  coloured from the album's cover. It listens to the player's sound without
  touching it, and rests while nothing plays.
-->
<script lang="ts">
  import AudioMotionAnalyzer from 'audiomotion-analyzer'
  import { untrack } from 'svelte'
  import { coverColours, stops } from './palette.ts'
  import { player } from './player.svelte.ts'

  interface Props {
    /** The album whose cover the colours come from, and that cover's tag */
    albumId: string
    tag: string | undefined
    /** The share of the height below the bars, for their reflection */
    reflex?: number
    /** Off while the album in focus isn't the one playing: it rests (the parent fades it out) */
    active?: boolean
  }
  let { albumId, tag, reflex = 0.25, active = true }: Props = $props()

  let box = $state<HTMLDivElement>()
  let analyzer = $state.raw<AudioMotionAnalyzer>()

  $effect(() => {
    const source = player.source
    if (!source || !box) return
    const a = new AudioMotionAnalyzer(box, {
      source,
      connectSpeakers: false,
      mode: 1,
      frequencyScale: 'log',
      minFreq: 25,
      maxFreq: 18000,
      weightingFilter: 'D',
      // decibels, tuned for mastered music: full bars without clipping at the top
      minDecibels: -80,
      maxDecibels: -18,
      smoothing: 0.62,
      barSpace: 0.25,
      showPeaks: true,
      peakHoldTime: 350,
      gravity: 3.2,
      // read once here; the effect below follows it (or the analyzer would be made anew on resize)
      reflexRatio: untrack(() => Math.min(0.6, reflex)),
      reflexAlpha: 0.3,
      reflexBright: 1,
      overlay: true,
      showBgColor: false,
      bgAlpha: 0,
      showScaleX: false,
      maxFPS: 60,
    })
    analyzer = a
    return () => {
      analyzer = undefined
      a.destroy()
    }
  })

  // the reflection's share follows the space below the page
  $effect(() => {
    if (analyzer) analyzer.reflexRatio = Math.min(0.6, reflex)
  })

  // the album's colours
  $effect(() => {
    const a = analyzer
    if (!a) return
    let current = true
    void coverColours(albumId, tag).then((colours) => {
      if (!current) return
      a.registerGradient('album', { bgColor: 'transparent', colorStops: stops(colours) })
      a.gradient = 'album'
    })
    return () => {
      current = false
    }
  })

  // paused: let the bars fall, then rest; out of focus: rest once faded out
  $effect(() => {
    const a = analyzer
    if (!a) return
    if (active && !player.paused) {
      a.toggleAnalyzer(true)
      return
    }
    const timer = setTimeout(() => a.toggleAnalyzer(false), active ? 1500 : 600)
    return () => clearTimeout(timer)
  })
</script>

<div class="spectrum" bind:this={box}></div>

<style>
  .spectrum {
    width: 100%;
    height: 100%;
  }
</style>
