<!-- How far into a film or an episode it was stopped: a bar along the foot of its picture -->
<script lang="ts">
  import { progress } from '../core/titles.ts'

  interface Props {
    of: { resume: number; seconds: number; played: boolean }
  }
  let { of }: Props = $props()
</script>

<span class="progress"><span style:width="{progress(of) * 100}%"></span></span>

<style>
  /* where the picture shows scaled (a row of posters), --unscale sizes it back up to read the same */
  .progress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: calc(4px * var(--unscale, 1));
    background: rgb(255 255 255 / 0.25);
  }
  .progress span {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, var(--accent-2), var(--accent));
  }
</style>
