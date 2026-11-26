<!--
  A title's cast, on its page: faces in a row, top billing first, scrolled
  sideways; who they play under their name; someone without a photo by
  their initials.
-->
<script module lang="ts">
  export interface Person {
    /** Unique in the cast */
    key: string
    name: string
    /** The part played */
    role?: string | undefined
    /** Their photo's URL */
    photo?: string | undefined
  }
</script>

<script lang="ts">
  interface Props {
    people: Person[]
  }
  let { people }: Props = $props()

  /** "Taylor Swift" → "TS" */
  function initials(name: string): string {
    return name
      .split(/\s+/)
      .map((w) => w[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase()
  }
</script>

{#if people.length}
  <ul class="cast" aria-label="Cast">
    {#each people as person (person.key)}
      <li title={person.role ? `${person.name} as ${person.role}` : person.name}>
        <span class="face">
          {#if person.photo}
            <img src={person.photo} alt="" loading="lazy" decoding="async" />
          {:else}
            {initials(person.name)}
          {/if}
        </span>
        <span class="who">{person.name}</span>
        {#if person.role}<span class="as">{person.role}</span>{/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .cast {
    display: flex;
    gap: 6px;
    margin: 8px 0 0;
    padding: 6px 6px 2px;
    list-style: none;
    overflow-x: auto;
    scrollbar-width: none;
    flex: none;
  }
  .cast li {
    flex: none;
    width: 84px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .face {
    width: 62px;
    height: 62px;
    border-radius: 50%;
    overflow: hidden;
    display: grid;
    place-items: center;
    font-weight: 700;
    color: var(--text-2);
    background: var(--placeholder);
    box-shadow:
      0 0 0 1px rgb(255 255 255 / 0.18),
      0 6px 14px -6px rgb(0 0 0 / 0.9);
  }
  .face img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 18%;
  }
  .who {
    margin-top: 6px;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.25;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .as {
    font-size: 11px;
    line-height: 1.25;
    color: var(--text-3);
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
