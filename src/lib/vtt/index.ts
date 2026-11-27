// WebVTT subtitles, read into cues for a player to draw itself (styled its
// own way, and with nothing left to the browser's track handling). Plain
// TypeScript, no DOM.
//
//   const cues = parseVtt(await (await fetch(url)).text())
//   const lines = linesAt(cues, video.currentTime)   // what to show now

export interface Cue {
  /** Seconds */
  start: number
  end: number
  /** Plain text, one string per line */
  lines: string[]
}

/** "01:02:03.456" or "02:03.456" → seconds */
function time(stamp: string): number | undefined {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(stamp.trim())
  if (!m) return undefined
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number((m[4] ?? '0').padEnd(3, '0')) / 1000
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', nbsp: ' ', quot: '"', apos: "'", lrm: '‎', rlm: '‏' }

/** A cue's text without its markup (<i>, <b>, <c.yellow>, <v Name>, timestamps) */
function plain(line: string): string {
  return line
    .replace(/<[^>]*>/g, '')
    .replace(/&(\w+);/g, (all, name: string) => ENTITIES[name] ?? all)
    .trim()
}

export function parseVtt(text: string): Cue[] {
  const cues: Cue[] = []
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n')
    const at = lines.findIndex((l) => l.includes('-->'))
    if (at < 0) continue
    const [from, rest] = (lines[at] ?? '').split('-->')
    const start = time(from ?? '')
    // the end time may be followed by cue settings
    const end = time((rest ?? '').trim().split(/\s+/)[0] ?? '')
    if (start === undefined || end === undefined || end <= start) continue
    const content = lines.slice(at + 1).map(plain).filter(Boolean)
    if (content.length) cues.push({ start, end, lines: content })
  }
  return cues.sort((a, b) => a.start - b.start)
}

/** The lines showing at `t` seconds (overlapping cues stack, earliest first) */
export function linesAt(cues: Cue[], t: number): string[] {
  // the last cue starting by t, then back through any still showing
  let lo = 0
  let hi = cues.length - 1
  let last = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if ((cues[mid]?.start ?? Infinity) <= t) {
      last = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  const showing: string[][] = []
  // cues rarely last long: looking back a few is enough
  for (let i = last; i >= 0 && i > last - 12; i--) {
    const cue = cues[i]
    if (cue && cue.end > t) showing.unshift(cue.lines)
  }
  return showing.flat()
}
