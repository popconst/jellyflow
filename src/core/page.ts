// What a title's page offers to play: a film's Resume (and start over) or
// Play; a series' one button, at the episode to pick it up at.

import { duration } from './details.ts'
import type { Movie } from './movies.ts'
import { episodeCode, upNext, type Episode } from './shows.ts'
import { left, resumable } from './titles.ts'

export interface Choice {
  label: string
  /** The second it starts at */
  at: number
  /** A series': the episode it plays */
  episode?: Episode | undefined
  /** Seconds left, when it resumes */
  left?: number | undefined
  /** Over again: ↺ rather than ▶ */
  again?: boolean
}

export function filmChoices(m: Movie): Choice[] {
  if (resumable(m)) {
    return [
      { label: `Resume from ${duration(m.resume)}`, at: m.resume, left: left(m) },
      { label: 'Play from the beginning', at: 0, again: true },
    ]
  }
  return [{ label: m.played ? 'Play again' : 'Play', at: 0, again: m.played }]
}

/**
 * A series' button: resume the episode stopped partway, the next one, the
 * first, or all over again once every one has been watched. While the
 * episodes load (`undefined`), the one Continue Watching had (`at`).
 */
export function seriesChoice(episodes: Episode[] | undefined, at?: Episode): Choice | undefined {
  const next = episodes ? upNext(episodes) : at && { episode: at, resume: resumable(at), started: true }
  if (next) {
    const e = next.episode
    return next.resume
      ? { label: `Resume ${episodeCode(e)}`, at: e.resume, episode: e, left: left(e) }
      : { label: `${next.started ? 'Next' : 'Play'} ${episodeCode(e)}`, at: 0, episode: e }
  }
  const first = episodes?.find((e) => e.season !== 0) ?? episodes?.[0]
  return first && { label: `Watch again from ${episodeCode(first)}`, at: 0, episode: first, again: true }
}
