// Films, as the Watch view lists them: a title (titles.ts) with its length,
// tagline, and where it was stopped.

import { date, seconds, type Item } from './jellyfin.ts'
import { titleBase, type TitleBase } from './titles.ts'

export interface Movie extends TitleBase {
  kind: 'movie'
  seconds: number
  tagline: string | undefined
  /** Where it was stopped, in seconds: 0 if it wasn't, or was watched to the end */
  resume: number
  /** When it was last watched (ms; 0: never) */
  lastPlayed: number
}

export function toMovie(item: Item): Movie {
  const original = item.OriginalTitle && item.OriginalTitle !== item.Name ? item.OriginalTitle : ''
  return {
    ...titleBase(item, item.ProductionYear ? String(item.ProductionYear) : '', date(item.DateCreated), original),
    kind: 'movie',
    seconds: seconds(item.RunTimeTicks),
    tagline: item.Taglines?.[0],
    resume: seconds(item.UserData?.PlaybackPositionTicks),
    lastPlayed: date(item.UserData?.LastPlayedDate),
  }
}
