<!--
  A title's page (Watch's, Discover's), on the leaf that swings out beside
  its poster: a dark sheet with the backdrop dimly behind; the title's name,
  what it is (its score apart, in gold) and its genres, links elsewhere
  (IMDb) on the right; then the rest, the page's own.
-->
<script module lang="ts">
  /** Somewhere else about it, opened in a new tab; `key` opens it too (the page's) */
  export interface Link {
    label: string
    url: string
    key?: string
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'
  import Score from './Score.svelte'

  interface Props {
    /** The backdrop, blurred */
    art?: string | undefined
    name: string
    /** "2021 · PG-13 · 2h 35m" */
    facts: string
    score?: number | undefined
    /** How many voted for the score */
    votes?: number | undefined
    /** After the score: "watched", "ends at 21:42" */
    more?: string
    genres: string[]
    links?: Link[]
    children: Snippet
  }
  let { art, name, facts, score, votes, more = '', genres, links = [], children }: Props = $props()
</script>

<div class="sheet">
  {#if art}<img class="art" src={art} alt="" />{/if}
  <header>
    {#if links.length}
      <nav class="links">
        {#each links as link (link.url)}
          <a href={link.url} target="_blank" rel="noopener noreferrer">{link.label} ↗{#if link.key}<kbd>{link.key}</kbd>{/if}</a>
        {/each}
      </nav>
    {/if}
    <div class="name">{name}</div>
    <div class="facts">
      {facts}{#if score}<Score value={score} {votes} />{#if votes && more}{'· '}{/if}{:else if more}{' · '}{/if}{more}
    </div>
    {#if genres.length}<div class="genres">{genres.join(' · ')}</div>{/if}
  </header>
  {@render children()}
</div>

<style>
  .sheet {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    padding: 22px 16px 14px;
    overflow: hidden;
    background: #0d0d10;
    box-shadow: 0 10px 40px rgb(0 0 0 / 0.6);
  }
  /* blurred already; dimmed by its opacity over the sheet's black */
  .art {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0.3;
  }
  /* everything on the sheet over the backdrop, the page's own parts too */
  .sheet > :global(:not(.art)) {
    position: relative;
  }
  header {
    padding: 0 10px 10px;
    border-bottom: 1px solid rgb(255 255 255 / 0.14);
  }
  .name {
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .facts,
  .genres {
    color: var(--text-2);
    font-size: 14px;
  }
  .links {
    float: right;
    display: flex;
    gap: 6px;
    margin: 2px 0 0 12px;
  }
  .links a {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px 3px 11px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    text-decoration: none;
    background: var(--glass), rgb(0 0 0 / 0.3);
    box-shadow: var(--glass-edge);
  }
  .links a:hover {
    background: var(--hover);
  }
</style>
