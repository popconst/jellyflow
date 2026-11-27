// Reading Jellyfin's items: its ticks and dates, a folder's name on disk,
// and the natural order of names and of an album's tracks.

import type { Item } from './types.ts'

/** A folder's name on disk ("1983 - Kill ’Em All"), else Jellyfin's name for it */
export function folderName(item: Item): string {
  const path = item.Path?.replace(/[/\\]+$/, '')
  return path ? (path.split(/[/\\]/).pop() ?? item.Name) : item.Name
}

/** Natural, case-insensitive: "Disc 2" before "Disc 10" */
export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

/** An album's tracks in order: by disc, then number, then file */
export function byDiscAndNumber(a: Item, b: Item): number {
  return (
    (a.ParentIndexNumber ?? 1) - (b.ParentIndexNumber ?? 1) ||
    (a.IndexNumber ?? 0) - (b.IndexNumber ?? 0) ||
    compareNames(a.Path ?? a.Name, b.Path ?? b.Name)
  )
}

/** Jellyfin's ticks (100 ns) as seconds; 0 for none */
export function seconds(ticks: number | undefined): number {
  return ticks ? ticks / 10_000_000 : 0
}

/** Seconds as Jellyfin's ticks */
export function ticks(seconds: number): number {
  return Math.round(seconds * 10_000_000)
}

/** Jellyfin's ISO dates as milliseconds; 0 for none */
export function date(iso: string | undefined): number {
  const t = iso ? Date.parse(iso) : Number.NaN
  return Number.isFinite(t) ? t : 0
}
