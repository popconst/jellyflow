<!-- An album's front cover; a plain record sleeve when it has none. -->
<script lang="ts">
  import { app } from './state.svelte.ts'

  interface Props {
    id: string | undefined
    tag: string | undefined
    /** Pixels to ask Jellyfin for (square) */
    size?: number
    title?: string
    lazy?: boolean
  }
  let { id, tag, size = 300, title = '', lazy = true }: Props = $props()

  const src = $derived(id && tag && app.client ? app.client.imageUrl(id, tag, size) : undefined)
  let failed = $state<string | undefined>()
</script>

{#if src && failed !== src}
  <img
    {src}
    alt={title}
    loading={lazy ? 'lazy' : 'eager'}
    decoding="async"
    draggable="false"
    onerror={() => (failed = src)}
  />
{:else}
  <div class="sleeve" role="img" aria-label={title}><div class="disc"></div></div>
{/if}

<style>
  img,
  .sleeve {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    background: #222;
  }
  .sleeve {
    background: linear-gradient(135deg, #2c2c33, #17171b);
    position: relative;
    overflow: hidden;
  }
  .disc {
    position: absolute;
    inset: 18%;
    border-radius: 50%;
    background: radial-gradient(circle, #555 0 8%, #0d0d0f 9% 30%, #1a1a1e 31% 32%, #0d0d0f 33% 100%);
    transform: translateX(28%);
  }
</style>
