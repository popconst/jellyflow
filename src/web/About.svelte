<!--
  What a film is about, on its page (Sheet.svelte): its tagline and
  overview, who made it (slim label / names lines, like Jellyfin's), its
  keywords. Scrolls if it's long.
-->
<script lang="ts">
  interface Props {
    tagline?: string | undefined
    overview?: string | undefined
    /** [label, names]: ["Director", "Denis Villeneuve"]; those with no names are left out */
    credits: [string, string][]
    tags?: string[]
  }
  let { tagline, overview, credits, tags = [] }: Props = $props()

  const named = $derived(credits.filter(([, names]) => names))
</script>

<div class="about">
  {#if tagline}<p class="tagline">{tagline}</p>{/if}
  {#if overview}<p>{overview}</p>{/if}
  {#if named.length}
    <dl class="credits">
      {#each named as [label, names] (label)}<dt>{label}</dt><dd>{names}</dd>{/each}
    </dl>
  {/if}
  {#if tags.length}
    <div class="tags">{#each tags as tag (tag)}<span>{tag}</span>{/each}</div>
  {/if}
</div>

<style>
  .about {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 10px;
    font-size: 15px;
    line-height: 1.45;
    color: var(--text);
  }
  .tagline {
    font-style: italic;
    color: var(--text-2);
  }
  .credits {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 3px 14px;
    margin: 12px 0 0;
    font-size: 14px;
  }
  .credits dt {
    color: var(--text-3);
  }
  .credits dd {
    margin: 0;
    color: var(--text);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 12px 0 4px;
  }
  .tags span {
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 12px;
    color: var(--text-2);
    background: var(--glass);
    box-shadow: var(--glass-edge);
  }
</style>
