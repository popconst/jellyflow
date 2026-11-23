<!-- A film's or a series' poster (2:3); its title on a plain card when it has none. -->
<script lang="ts">
  import { app } from './state.svelte.ts'

  interface Props {
    id: string
    tag: string | undefined
    /** Pixels wide to ask Jellyfin for */
    width: number
    title: string
  }
  let { id, tag, width, title }: Props = $props()

  const src = $derived(tag && app.client ? app.client.posterUrl(id, tag, width) : undefined)
  let failed = $state<string | undefined>()
</script>

{#if src && failed !== src}
  <img {src} alt={title} decoding="async" draggable="false" onerror={() => (failed = src)} />
{:else}
  <div class="card" role="img" aria-label={title}><span>{title}</span></div>
{/if}

<style>
  img,
  .card {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    background: #222;
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
