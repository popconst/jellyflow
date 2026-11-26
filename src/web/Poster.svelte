<!--
  A film's or a series' poster (2:3), Jellyfin's or TMDB's; its title on a
  plain card when it has none. Shown once it's loaded, not drawn in top-down
  as it arrives (a fast scroll asks for many at once, and they come slowly);
  till then, the plain card without the title. A bigger size asked for later
  replaces it once that's loaded too (the browser keeps the first till then).
-->
<script lang="ts">
  interface Props {
    src: string | undefined
    title: string
  }
  let { src, title }: Props = $props()

  let failed = $state<string | undefined>()
  let loaded = $state(false)
</script>

{#if src && failed !== src}
  <div class="poster" role="img" aria-label={title}>
    <img {src} alt="" class:loaded decoding="async" draggable="false" onload={() => (loaded = true)} onerror={() => (failed = src)} />
  </div>
{:else}
  <div class="poster card" role="img" aria-label={title}><span>{title}</span></div>
{/if}

<style>
  .poster {
    width: 100%;
    height: 100%;
    background: #222;
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 150ms;
  }
  img.loaded {
    opacity: 1;
  }
  .card {
    display: grid;
    place-items: center;
    padding: 12%;
    background: var(--placeholder);
    text-align: center;
    font-weight: 700;
    font-size: 15px;
    color: var(--text);
  }
</style>
