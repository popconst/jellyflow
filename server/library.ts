// What a user has and has watched, as Discover needs it: their films and
// series by TMDB id (to mark what's in the library, and to weigh who made
// what they watch) and what they watched last. Read from Jellyfin as them.

import { refOf, type Kind, type Ref } from '../src/core/discover.ts'
import { date, type Item, type Jellyfin } from '../src/core/jellyfin.ts'

export interface Owned {
  kind: Kind
  tmdbId: number
  /** Its Jellyfin id */
  id: string
  title: string
  /** Watched (a film to the end, a series in part) */
  played: boolean
}

export interface Library {
  /** "tmdb:movie:603" → its Jellyfin id */
  owned: Map<Ref, string>
  titles: Owned[]
  /** The films and series watched lately, the most recent first, each once */
  recent: Owned[]
}

/** How many of the latest watched films and episodes say what was watched lately */
const RECENT = 40

export async function libraryOf(jellyfin: Jellyfin): Promise<Library> {
  const lean = { recursive: true, enableUserData: true, enableImages: false, enableTotalRecordCount: false }
  const [titles, watched] = await Promise.all([
    jellyfin.items({ ...lean, includeItemTypes: 'Movie,Series', fields: 'ProviderIds' }),
    jellyfin.items({ ...lean, includeItemTypes: 'Movie,Episode', sortBy: 'DatePlayed', sortOrder: 'Descending', limit: RECENT }),
  ])
  const owned = titles.flatMap((item): Owned[] => {
    const tmdbId = Number(item.ProviderIds?.['Tmdb'])
    if (!tmdbId) return []
    const kind: Kind = item.Type === 'Series' ? 'tv' : 'movie'
    return [{ kind, tmdbId, id: item.Id, title: item.Name, played: Boolean(item.UserData?.Played) }]
  })
  const recent = recentOf(watched, new Map(owned.map((o) => [o.id, o])))
  // a series watched in part counts as watched
  for (const o of recent) o.played = true
  return {
    owned: new Map(owned.map((o) => [refOf(o.kind, o.tmdbId), o.id])),
    titles: owned,
    recent,
  }
}

/** Films and episodes as last played → the films and series they are, newest first, each once */
export function recentOf(watched: Item[], byId: Map<string, Owned>): Owned[] {
  const seen = new Set<string>()
  return watched
    .filter((item) => date(item.UserData?.LastPlayedDate) > 0)
    .sort((a, b) => date(b.UserData?.LastPlayedDate) - date(a.UserData?.LastPlayedDate))
    .map((item) => byId.get(item.Type === 'Episode' ? (item.SeriesId ?? '') : item.Id))
    .filter((o): o is Owned => o !== undefined && !seen.has(o.id) && Boolean(seen.add(o.id)))
}
