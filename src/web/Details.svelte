<!-- The album's details (coverflow's `i` panel), and its d / w / m links. -->
<script lang="ts">
  import { details, duration, links } from '../core/details.ts'
  import type { Album } from '../core/library.ts'
  import { app } from './state.svelte.ts'

  let { album }: { album: Album } = $props()

  const info = $derived(app.albumTracks(album.id).then((tracks) => details(album, tracks)))
  /** What Jellyfin itself knows: the overview and its links (fine without, if it can't say) */
  const extra = $derived(app.item(album.id).catch(() => undefined))
  const ours = $derived(links(album))
  /** Jellyfin's links to the album elsewhere, but for the ones above; web pages only (they come from tags) */
  const theirs = (urls: { Name: string; Url: string }[] = []) =>
    urls.filter((u) => /^https?:\/\//i.test(u.Url) && !ours.some((l) => l.url === u.Url))
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
</script>

<div class="details">
  <h2>{album.title}</h2>
  {#await extra then item}
    {#if item?.Overview}<p class="overview">{item.Overview.replace(/<[^>]+>/g, ' ')}</p>{/if}
  {/await}
  {#await info}
    <p class="muted">Reading the tags…</p>
  {:then d}
    <dl>
      <dt>Artist</dt>
      <dd>{d.artist || 'Unknown artist'}</dd>
      {#if d.trackArtists.length}
        <dt>Artists</dt>
        <dd>{d.trackArtists.join(', ')}</dd>
      {/if}
      {#if d.year}<dt>Year</dt><dd>{d.year}</dd>{/if}
      {#if d.labels.length}<dt>Label</dt><dd>{d.labels.join(', ')}</dd>{/if}
      {#if d.genres.length}<dt>Genre</dt><dd>{d.genres.join(', ')}</dd>{/if}
      <dt>Tracks</dt>
      <dd>
        {d.discs > 1 ? `${d.tracks} on ${d.discs} discs` : plural(d.tracks, 'track')} · {duration(d.seconds)}
      </dd>
      <dt>Quality</dt>
      <dd>
        {#each d.quality as q (q.text)}
          <div>
            {q.text}{d.quality.length > 1 ? ` · ${plural(q.tracks, 'track')}` : ''}
            {#if q.hiRes}<span class="hires">Hi-Res</span>{/if}
          </div>
        {/each}
      </dd>
      {#if d.composers.length}<dt>Composers</dt><dd>{d.composers.join(', ')}</dd>{/if}
      {#if d.credits.length}<dt>Credits</dt><dd>{d.credits.join(', ')}</dd>{/if}
      {#if d.musicbrainz}<dt>MusicBrainz</dt><dd class="mono">{d.musicbrainz}</dd>{/if}
      <dt>Folder</dt>
      <dd class="mono">{d.folder}</dd>
      <dt>Links</dt>
      <dd>
        {#each ours as link (link.key)}
          <a href={link.url} target="_blank" rel="noreferrer"><kbd>{link.key}</kbd> {link.name}</a>
        {/each}
        {#await extra then item}
          {#each theirs(item?.ExternalUrls) as url (url.Url)}
            <a href={url.Url} target="_blank" rel="noreferrer">{url.Name}</a>
          {/each}
        {/await}
      </dd>
    </dl>
  {:catch e}
    <p class="error">Error: {e instanceof Error ? e.message : e}</p>
  {/await}
</div>

<style>
  .details {
    padding: 16px 18px;
    overflow-y: auto;
  }
  h2 {
    margin: 0 0 12px;
    font-size: 18px;
  }
  .overview {
    margin: 0 0 14px;
    color: var(--text-2);
    font-size: 14px;
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 7;
    line-clamp: 7;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .overview:hover {
    -webkit-line-clamp: unset;
    line-clamp: unset;
  }
  dl {
    display: grid;
    grid-template-columns: 7.5em 1fr;
    gap: 6px 12px;
    margin: 0;
  }
  dt {
    color: var(--text-3);
    font-size: 13px;
    padding-top: 1px;
  }
  dd {
    margin: 0;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .mono {
    font: 12px var(--mono);
    color: var(--text-2);
  }
  .hires {
    margin-left: 6px;
    color: #000;
    background: var(--hi);
    font-weight: 700;
    font-size: 11px;
    padding: 1px 5px;
    border-radius: 3px;
    white-space: nowrap;
  }
  a {
    color: var(--text);
    text-decoration: none;
    margin-right: 14px;
    white-space: nowrap;
  }
  a:hover {
    color: var(--accent);
  }
  .muted {
    color: var(--text-3);
  }
  .error {
    color: #ff8a8a;
  }
</style>
