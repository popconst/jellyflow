<!--
  A Discover title's page, like Watch's (Sheet.svelte): from TMDB, through
  jellyflow's server, what it's about, who made it and its cast; whether
  it's in the library; the wishlist button (w, Enter: Discover's keys) and
  not interested (x).
-->
<script lang="ts">
  import { imdbUrl, runtime } from '../core/titles.ts'
  import About from './About.svelte'
  import Cast, { type Person } from './Cast.svelte'
  import { discover, type Pick } from './discover.svelte.ts'
  import Sheet from './Sheet.svelte'

  /** TMDB's details of a film or series, with its credits (the fields used) */
  interface Details {
    tagline?: string
    overview?: string
    /** A film's, in minutes */
    runtime?: number
    number_of_seasons?: number
    /** A series': which season is out last (number_of_seasons counts one only announced too) */
    last_episode_to_air?: { season_number: number } | null
    genres?: { name: string }[]
    production_companies?: { name: string }[]
    created_by?: { name: string }[]
    /** A film's IMDb id; a series' is in its external ids */
    imdb_id?: string | null
    external_ids?: { imdb_id?: string | null }
    credits?: {
      cast: { id: number; name: string; character?: string; profile_path?: string | null }[]
      crew: { name: string; job: string }[]
    }
  }

  interface Props {
    pick: Pick
    /** On the wishlist, or off it */
    onwish: () => void
    /** Not interested (or, marked so, of interest again) */
    ondismiss: () => void
  }
  let { pick, onwish, ondismiss }: Props = $props()

  let details = $state.raw<Details | undefined>()

  $effect(() => {
    const { kind, tmdbId } = pick
    let live = true
    discover.tmdb<Details>(`/${kind}/${tmdbId}?append_to_response=credits,external_ids`).then(
      (d) => live && (details = d),
      () => undefined,
    )
    return () => {
      live = false
    }
  })

  const wished = $derived(discover.wished.has(pick.ref))
  const dismissed = $derived(discover.dismissed.has(pick.ref))
  /** Its page on IMDb (i opens it) */
  const imdb = $derived(imdbUrl(details?.imdb_id ?? details?.external_ids?.imdb_id))

  /** Its IMDb page, for Discover's i */
  export function imdbPage(): string | undefined {
    return imdb
  }
  /** "2025 · 2h 17m", "2019 · 3 seasons" */
  const facts = $derived.by(() => {
    const d = details
    const seasons = d?.last_episode_to_air?.season_number ?? d?.number_of_seasons
    const length = d?.runtime ? runtime(d.runtime * 60) : seasons ? `${seasons} ${seasons === 1 ? 'season' : 'seasons'}` : ''
    return [pick.year, length].filter(Boolean).join(' · ')
  })
  /** Not out yet: when it is */
  const more = $derived(pick.date && pick.date > new Date().toISOString().slice(0, 10) ? `out ${pick.date}` : '')
  function names(of: { name: string }[] | undefined, most = 3): string {
    return [...new Set((of ?? []).map((p) => p.name))].slice(0, most).join(', ')
  }
  const crew = $derived(details?.credits?.crew ?? [])
  const credits = $derived<[string, string][]>([
    [pick.kind === 'tv' ? 'Created by' : 'Director', pick.kind === 'tv' ? names(details?.created_by) : names(crew.filter((c) => c.job === 'Director'))],
    ['Writers', names(crew.filter((c) => c.job === 'Screenplay' || c.job === 'Writer'))],
    ['Studio', names(details?.production_companies, 2)],
  ])
  const cast = $derived<Person[]>(
    (details?.credits?.cast ?? []).slice(0, 16).map((c, i) => ({
      key: `${c.id}-${i}`,
      name: c.name,
      role: c.character || undefined,
      photo: discover.image(c.profile_path ?? undefined, 144),
    })),
  )

</script>

<Sheet
  art={discover.backdrop(pick.backdrop)}
  name={pick.title}
  {facts}
  score={pick.score}
  votes={pick.votes}
  {more}
  genres={(details?.genres ?? []).map((g) => g.name)}
  links={imdb ? [{ label: 'IMDb', url: imdb, key: 'i' }] : []}
>
  <About tagline={details?.tagline} overview={details?.overview ?? pick.overview} {credits} />
  <Cast people={cast} />
  <div class="actions">
    <button class="act wish" class:on={wished} onclick={onwish}>
      <span class="sign">{wished ? '♥' : '♡'}</span>
      <span>{wished ? 'On your wishlist' : 'Add to your wishlist'}</span>
      <kbd>w</kbd>
    </button>
    <button class="act dismiss" class:on={dismissed} onclick={ondismiss}>
      <span class="sign">✕</span>
      <span>{dismissed ? 'Not interested: take it back' : 'Not interested'}</span>
      <kbd>x</kbd>
    </button>
    {#if pick.owned}<span class="owned">✓ In your library</span>{/if}
  </div>
</Sheet>

<style>
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 20px;
    margin: 12px 0 2px;
  }
  .act {
    display: flex;
    align-items: center;
    gap: 10px;
    border: 0;
    border-radius: 999px;
    padding: 8px 16px 8px 8px;
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
    background: var(--glass), rgb(255 255 255 / 0.06);
    box-shadow: var(--glass-edge);
  }
  .act:hover {
    background: var(--hover);
  }
  .sign {
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    font-size: 18px;
    color: #111;
    background: #fff;
  }
  .wish.on .sign {
    color: #fff;
    background: #e5484d;
  }
  .dismiss .sign {
    font-size: 15px;
    color: var(--text);
    background: rgb(255 255 255 / 0.14);
  }
  .dismiss.on .sign {
    color: #111;
    background: #fff;
  }
  .owned {
    color: var(--text-2);
    font-size: 15px;
  }
</style>
