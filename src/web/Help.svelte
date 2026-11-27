<!-- The keys, all of them (?): what each does, by part of the app. A click anywhere shuts it; so do ? and Esc (App.svelte's). -->
<script lang="ts">
  interface Props {
    onclose: () => void
  }
  let { onclose }: Props = $props()

  /** Each part of the app, and its keys: [keys, what they do] */
  const help: [string, [string, string][]][] = [
    [
      'Everywhere',
      [
        ['Tab', 'Watch → Discover → Listen'],
        ['Space', 'play / pause the music'],
        ['< >', 'previous / next track'],
        ['?', 'this help'],
      ],
    ],
    [
      'Listen',
      [
        ['Shift-Tab', 'Cover Flow ⇄ Folders'],
        ['c', 'go to what’s playing: its album glides in and opens at the track'],
        ['o', 'back to where you were before c (again: back to what’s playing)'],
        ['a', 'add to the queue'],
        ['i', 'album details: Jellyfin’s overview, tags, quality, links'],
        ['d w m', 'the album on Discogs, Wikipedia, MusicBrainz'],
      ],
    ],
    [
      'Cover Flow',
      [
        ['h l ← →', 'previous / next album; hold to speed up (or scroll); a click on a cover opens it'],
        ['H L', '10 back / forward'],
        ['g G', 'first / last'],
        ['/', 'filter by artist, album, year or track; Enter browses, Esc cancels'],
        ['Esc', 'whole library again, same album'],
        ['Enter j', 'open the album: its tracks swing out beside it, the spectrum under them; j k, Enter plays from there, Esc or k on the first track closes'],
      ],
    ],
    [
      'Folders',
      [
        ['j k', 'down / up (counts: 5j)'],
        ['l h', 'open / back up (also Enter on a folder, - and Backspace)'],
        ['Enter', 'play the album, or the folder from this track'],
        ['gg G 12G', 'first / last / line 12'],
        ['Ctrl-d u f b', 'half page / page down and up'],
        ['H M L zz', 'top / middle / bottom of the screen, centre'],
        ['/ n N', 'find in this folder, next, previous'],
        ['~', 'the top folder'],
      ],
    ],
    [
      'Watch',
      [
        ['h l ← →', 'previous / next in the row; hold to speed up (or scroll sideways); a click on a poster opens it'],
        ['j k ↓ ↑', 'the next row / the one above (or scroll up and down)'],
        ['H L  g G', '10 back / forward; first / last in the row'],
        ['Enter', 'open it: its page swings out beside the poster'],
        ['x u', 'take it off Continue Watching (until it’s watched again); put it back'],
        ['/', 'find a film or series by title, year or genre; Esc: all the rows again'],
      ],
    ],
    [
      'Discover',
      [
        ['Shift-Tab', 'films ⇄ series'],
        ['j k h l', 'rows and titles, as in Watch; Enter opens a title’s page'],
        ['j', 'down from the last row: the year before it (films and series both)'],
        ['w', 'on your wishlist, or off it (also Enter on a title’s page)'],
        ['x', 'not interested: left out of Discover (off your wishlist too); on a title’s page, it shuts'],
        ['u', 'puts back the last one you weren’t interested in'],
        ['k Esc', 'on a title’s page: close it'],
        ['i', 'on a title’s page: the film or series on IMDb'],
        ['/', 'search all of TMDB by title; Enter browses what’s found, Esc brings the rows back'],
      ],
    ],
    [
      'A film’s or series’ page',
      [
        ['j k', 'down / up: Resume or Play, a series’ episodes; k at the top closes'],
        ['h l', 'a series’ seasons; on a film’s page, the previous / next film'],
        ['Enter', 'play it (or resume it, where it was stopped)'],
        ['i', 'the film or series on IMDb'],
        ['Esc q', 'close the page'],
      ],
    ],
    [
      'Watching',
      [
        ['Space k', 'play / pause'],
        ['j l ← →', '10 s back / ahead; 5 s with the arrows'],
        ['0 … 9', 'to 0% … 90% of the film'],
        ['↑ ↓ m', 'volume up / down, mute'],
        ['c', 'subtitles on / off'],
        ['a s', 'next audio track; the quality, audio and subtitles menu'],
        ['f', 'full screen'],
        ['N', 'the next episode (at the end of one it follows by itself; Enter now, Esc back)'],
        ['Esc q', 'back (where you stopped is kept, in Jellyfin)'],
      ],
    ],
  ]
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="help" onclick={onclose}>
  <div class="sheet">
    {#each help as [title, keys] (title)}
      <h3>{title}</h3>
      <dl>
        {#each keys as [k, what] (k)}<dt>{k}</dt><dd>{what}</dd>{/each}
      </dl>
    {/each}
  </div>
</div>

<style>
  .help {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.7);
    display: grid;
    place-items: center;
    z-index: 1000;
  }
  .sheet {
    width: min(720px, calc(100% - 32px));
    max-height: calc(100% - 64px);
    overflow-y: auto;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 6px 24px 18px;
  }
  h3 {
    margin: 16px 0 8px;
    color: var(--accent);
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  dl {
    display: grid;
    grid-template-columns: 9em 1fr;
    gap: 5px 14px;
    margin: 0;
  }
  dt {
    font: 13px var(--mono);
    color: var(--text);
  }
  dd {
    margin: 0;
    color: var(--text-2);
  }
</style>
