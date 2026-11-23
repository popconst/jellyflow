<!-- A title's rating out of 10, in IMDb's gold, lit like the covers: pale at the top, deep below, glowing -->
<script lang="ts">
  interface Props {
    value: number | undefined
  }
  let { value }: Props = $props()
</script>

{#if value}
  <span class="score" title="Rating, out of 10"><span class="gold">★ {value.toFixed(1)}</span></span>
{/if}

<style>
  .score {
    margin: 0 0.45em;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-shadow: none;
    white-space: nowrap;
  }
  .gold {
    background: linear-gradient(to bottom, #fff6c2, var(--gold) 48%, #c89400);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    /* a dark edge to stand on any backdrop, and the gold's own glow */
    filter: drop-shadow(0 1px 1px rgb(0 0 0 / 0.9)) drop-shadow(0 0 7px rgb(245 197 24 / 0.45));
  }
</style>
