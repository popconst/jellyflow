// Vim-style key sequences: a count ("12"), then a key or a two-key command
// ("gg"). Keys are named like vim's: "j", "G", "<C-d>", "<Enter>", "<Esc>".

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

/** A browser or terminal key event's name, vim style */
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
