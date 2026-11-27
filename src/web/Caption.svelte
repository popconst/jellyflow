<!--
  Under the row with the keys (Rails.svelte): the title the row is resting
  on, a line about it (its score apart, in gold), and its main genres (the
  first three, as Jellyfin or TMDB list them).
-->
<script lang="ts">
  import Score from './Score.svelte'

  interface Props {
    title: string
    /** "2021 · PG-13 · 2h 35m" */
    text: string
    score?: number | undefined
    /** How many voted for the score */
    votes?: number | undefined
    /** After the score: "stopped at 1:02:10", "Directed by …" */
    more?: string | undefined
    genres?: string[]
  }
  let { title, text, score, votes, more = '', genres = [] }: Props = $props()

  /** How many genres it shows */
  const GENRES = 3
</script>

<div class="title">{title}</div>
<div class="sub">
  {text}{#if score}<Score value={score} {votes} />{#if votes && more}{'· '}{/if}{:else if text && more}{' · '}{/if}{more}
</div>
{#if genres.length}
  <div class="genres">{#each genres.slice(0, GENRES) as genre (genre)}<span>{genre}</span>{/each}</div>
{/if}

<style>
  .title {
    font-size: clamp(20px, 2.1vw, 30px);
    font-weight: 700;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    color: var(--text-2);
    font-size: clamp(15px, 1.3vw, 19px);
  }
  .genres {
    display: flex;
    justify-content: center;
    gap: 6px;
    margin-top: 8px;
  }
  .genres span {
    padding: 3px 11px;
    border-radius: 999px;
    font-size: clamp(12px, 0.95vw, 14px);
    font-weight: 600;
    color: var(--text);
    text-shadow: none;
    background: var(--glass), rgb(0 0 0 / 0.35);
    box-shadow: var(--glass-edge);
  }
</style>
