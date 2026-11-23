<!--
  The line along the foot of a view (Cover Flow, Watch): searching (/), the
  query typed in it; else the filter on, a note or a hint; and a count on the
  right. Its keys are the search's: Ctrl-U clears, Esc cancels, Enter is done,
  the arrows move the row while typing. What they do is the view's.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { fade } from 'svelte/transition'

  interface Props {
    searching: boolean
    query: string
    placeholder: string
    /** The filter on, shown when not searching ('' for none), and what Esc goes back to: "whole library" */
    applied: string
    everything: string
    /** On the right: how many, or where the row is */
    count?: string | undefined
    /** A word for a while (what was just done), else a hint (keys) */
    note?: string | undefined
    hint?: Snippet | undefined
    /** The app is quiet (a page open, nothing done for a while): the line fades */
    quiet?: boolean
    oninput: () => void
    onclear: () => void
    oncancel: () => void
    ondone: () => void
    onmove: (dir: -1 | 1, e: KeyboardEvent) => void
  }
  let {
    searching,
    query = $bindable(),
    placeholder,
    applied,
    everything,
    count,
    note,
    hint,
    quiet = false,
    oninput,
    onclear,
    oncancel,
    ondone,
    onmove,
  }: Props = $props()

  let input = $state<HTMLInputElement>()

  $effect(() => {
    if (searching) input?.focus()
  })

  function onkeydown(e: KeyboardEvent): void {
    if (e.ctrlKey && e.key === 'u') onclear()
    else if (e.key === 'Escape') oncancel()
    else if (e.key === 'Enter') ondone()
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') onmove(-1, e)
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') onmove(1, e)
    else return
    e.preventDefault()
  }
</script>

<div class="line" class:quiet>
  {#if searching}
    <span class="slash">/</span>
    <input bind:this={input} bind:value={query} {oninput} {onkeydown} spellcheck="false" autocomplete="off" {placeholder} />
  {:else}
    {#if applied.trim()}
      <span class="filter">/{applied}</span>
      <span class="hint"><kbd>Esc</kbd> {everything} · <kbd>/</kbd> edit</span>
    {/if}
    {#if note}
      <span class="note" transition:fade={{ duration: 200 }}>{note}</span>
    {:else if hint}
      <span class="hint">{@render hint()}</span>
    {/if}
  {/if}
  {#if count}<span class="count">{count}</span>{/if}
</div>

<style>
  .line {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 4000;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 40px;
    padding: 0 18px;
    font: 13px var(--mono);
    background: linear-gradient(to top, rgb(0 0 0 / 0.75), transparent);
    transition: opacity 700ms;
  }
  .line.quiet {
    opacity: 0;
  }
  .slash,
  .filter {
    color: var(--accent);
    font-weight: 700;
  }
  input {
    flex: 1;
    background: none;
    border: 0;
    outline: 0;
    font: 15px var(--mono);
  }
  .hint,
  .note {
    font-family: var(--font);
    font-size: 13px;
    color: var(--text-3);
  }
  .note {
    color: var(--text);
  }
  .count {
    margin-left: auto;
    color: var(--text-2);
  }
</style>
