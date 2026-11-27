// Series and their episodes, as the Watch view lists them; and where to pick
// a series up: the episode stopped partway, if it was the last one watched,
// else the one after the last watched to the end.

import { date, seconds, type Item } from '../lib/jellyfin/index.ts'
import { titleBase, type TitleBase } from './titles.ts'

export interface Show extends TitleBase {
  kind: 'show'
  /** Episodes not watched yet */
  unwatched: number
}

export interface Episode {
  id: string
  seriesId: string
  /** Its season's number (0: specials) and name; its number in the season */
  season: number
  seasonName: string
  number: number | undefined
  title: string
  overview: string
  seconds: number
  /** Where it was stopped (seconds; 0 if it wasn't, or was watched to the end) */
  resume: number
  played: boolean
  /** When it was last watched (ms; 0: never) */
  lastPlayed: number
  stillTag: string | undefined
}

export function toShow(item: Item): Show {
  const from = item.ProductionYear
  const to = item.EndDate ? new Date(item.EndDate).getUTCFullYear() : undefined
  const year = !from ? '' : item.Status === 'Continuing' ? `${from}–` : to && to !== from ? `${from}–${to}` : String(from)
  return {
    ...titleBase(item, year, Math.max(date(item.DateLastMediaAdded), date(item.DateCreated))),
    kind: 'show',
    unwatched: item.UserData?.UnplayedItemCount ?? 0,
  }
}

function toEpisode(item: Item): Episode {
  const season = item.ParentIndexNumber ?? 1
  return {
    id: item.Id,
    seriesId: item.SeriesId ?? '',
    season,
    seasonName: season === 0 ? 'Specials' : (item.SeasonName ?? `Season ${season}`),
    number: item.IndexNumber,
    title: item.Name,
    overview: item.Overview ?? '',
    seconds: seconds(item.RunTimeTicks),
    resume: seconds(item.UserData?.PlaybackPositionTicks),
    played: item.UserData?.Played ?? false,
    lastPlayed: date(item.UserData?.LastPlayedDate),
    stillTag: item.ImageTags?.['Primary'],
  }
}

/** Specials go after the seasons */
const seasonOrder = (season: number) => (season === 0 ? Number.POSITIVE_INFINITY : season)

/** A series' episodes in order: by season (specials last), then by number */
export function episodesFrom(items: Item[]): Episode[] {
  return items.map(toEpisode).sort((a, b) => seasonOrder(a.season) - seasonOrder(b.season) || (a.number ?? 0) - (b.number ?? 0))
}

/** "S1:E3"; "Special 2" */
export function episodeCode(e: Episode): string {
  if (e.season === 0) return e.number ? `Special ${e.number}` : 'Special'
  return e.number === undefined ? `S${e.season}` : `S${e.season}:E${e.number}`
}

export interface Season {
  season: number
  name: string
  episodes: Episode[]
}

/** The seasons in order, each with its episodes */
export function seasonsOf(episodes: Episode[]): Season[] {
  const out: Season[] = []
  for (const e of episodes) {
    const last = out.at(-1)
    if (last?.season === e.season) last.episodes.push(e)
    else out.push({ season: e.season, name: e.seasonName, episodes: [e] })
  }
  return out
}

export interface UpNext {
  episode: Episode
  /** It was stopped partway: resume it */
  resume: boolean
  /** Any of the series has been watched */
  started: boolean
}

/** Not a special: what "next" means skips those */
const regular = (e: Episode) => !e.played && e.season !== 0

/**
 * Where to pick a series up: the episode watched last, if it was stopped
 * partway; else the next one not watched after it (or before it, if it was
 * the last). Never started: the first one. Undefined when every episode has
 * been watched.
 */
export function upNext(episodes: Episode[]): UpNext | undefined {
  let latest: Episode | undefined
  for (const e of episodes) {
    if (e.lastPlayed && (e.played || e.resume > 0) && (!latest || e.lastPlayed > latest.lastPlayed)) latest = e
  }
  if (!latest) {
    const first = episodes.find(regular) ?? episodes.find((e) => !e.played)
    return first && { episode: first, resume: first.resume > 0, started: episodes.some((e) => e.played) }
  }
  if (!latest.played) return { episode: latest, resume: true, started: true }
  const next = episodes.slice(episodes.indexOf(latest) + 1).find(regular) ?? episodes.find(regular)
  return next && { episode: next, resume: next.resume > 0, started: true }
}

/** The episode to go on to after `id`: the next in order, skipping the specials (unless it is one) */
export function nextEpisode(episodes: Episode[], id: string): Episode | undefined {
  const at = episodes.findIndex((e) => e.id === id)
  const special = episodes[at]?.season === 0
  return at < 0 ? undefined : episodes.slice(at + 1).find((e) => e.season !== 0 || special)
}

/** When any of a series was last watched (ms; 0: never) */
export function lastWatched(episodes: Episode[]): number {
  let last = 0
  for (const e of episodes) if ((e.played || e.resume > 0) && e.lastPlayed > last) last = e.lastPlayed
  return last
}
