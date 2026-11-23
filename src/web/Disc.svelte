<!--
  The app's play button, as in the player bar: a white disc with a black
  sign; or, for a second choice, the sign on glass. It grows a little under
  the pointer, with the button it's in.
-->
<script lang="ts">
  interface Props {
    /** ▶ play, ❚❚ pause, or ↺ over again */
    sign?: 'play' | 'pause' | 'again'
    /** Across, in pixels */
    size?: number
    /** On glass rather than white: a second choice */
    plain?: boolean
  }
  let { sign = 'play', size = 38, plain = false }: Props = $props()
</script>

<span class="disc" class:plain style:--d="{size}px" aria-hidden="true">
  {#if sign === 'play'}
    <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
  {:else if sign === 'pause'}
    <svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
  {:else}
    <svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z" /></svg>
  {/if}
</span>

<style>
  .disc {
    flex: none;
    display: grid;
    place-items: center;
    width: var(--d);
    height: var(--d);
    border-radius: 50%;
    background: var(--text);
    color: #000;
    box-shadow: 0 4px 14px -4px rgb(0 0 0 / 0.8);
    transition:
      transform 150ms,
      background 150ms;
  }
  .plain {
    background: var(--glass), rgb(255 255 255 / 0.06);
    box-shadow: var(--glass-edge);
    color: var(--text);
  }
  :global(button:hover) .disc {
    transform: scale(1.06);
  }
  svg {
    width: 52%;
    height: 52%;
    fill: currentColor;
  }
</style>
