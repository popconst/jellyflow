// Vim-style keys: a key event's name the way vim writes it ("j", "G",
// "<C-d>", "<Enter>", "<Esc>"), and sequences of them: a count ("12"), then
// a key or a two-key command ("gg"). Plain TypeScript, no DOM: it names a
// browser's key events and a terminal's alike.
//
//   const keys = new Keys()
//   onkeydown = (e) => {
//     if (typing(e)) return
//     const name = keyName(e)
//     const command = name && keys.feed(name)   // { key: 'gg', count: 12 } once there's one
//   }

export interface Command {
  key: string
  /** The count typed before it, if any */
  count: number | undefined
}

/** Keys that start a two-key command */
const PREFIXES = new Set(['g', 'z'])

export class Keys {
  private count = ''
  private prefix = ''

  /** Feeds one key; returns a whole command once there is one */
  feed(key: string): Command | undefined {
    if (/^[0-9]$/.test(key) && !this.prefix && (this.count || key !== '0')) {
      this.count += key
      return undefined
    }
    if (!this.prefix && PREFIXES.has(key)) {
      this.prefix = key
      return undefined
    }
    const command = { key: this.prefix + key, count: this.count ? Number(this.count) : undefined }
    this.reset()
    return command
  }

  /** What's been typed so far, to show while a command is half done */
  get pending(): string {
    return this.count + this.prefix
  }

  reset(): void {
    this.count = ''
    this.prefix = ''
  }
}

/** A browser or terminal key event's name, vim style; undefined with Cmd or Alt held, or for a key with no name here */
export function keyName(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): string | undefined {
  if (e.metaKey || e.altKey) return undefined
  const named: Record<string, string> = {
    Enter: '<Enter>',
    Escape: '<Esc>',
    Backspace: '<BS>',
    Tab: '<Tab>',
    ArrowUp: '<Up>',
    ArrowDown: '<Down>',
    ArrowLeft: '<Left>',
    ArrowRight: '<Right>',
    PageUp: '<PageUp>',
    PageDown: '<PageDown>',
    Home: '<Home>',
    End: '<End>',
    ' ': '<Space>',
  }
  const key = named[e.key] ?? (e.key.length === 1 ? e.key : undefined)
  if (!key) return undefined
  return e.ctrlKey ? `<C-${key.replace(/^<|>$/g, '').toLowerCase()}>` : key
}

/** Keys typed into a text field are the field's, not commands */
export function typing(e: { target: unknown }): boolean {
  const tag = (e.target as { tagName?: unknown } | null)?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA'
}
