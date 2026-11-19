// An album's colours, sampled from its cover: its strongest hues, kept close
// to how they look on the cover but bright enough to glow on black; greys for
// a black-and-white cover. For the visualiser's gradient.

/**
 * The cover is read at this size, one nothing else asks Jellyfin for. That
 * matters: Jellyfin only sends the CORS header to requests that ask for it,
 * and caches images for a year, so a size already shown on screen comes back
 * from the browser's cache without the header, and can't be read.
 */
export const PALETTE_PX = 48

const cache = new Map<string, Promise<string[]>>()

type Hsl = [h: number, s: number, l: number]

function hsl(r: number, g: number, b: number): Hsl {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const css = ([h, s, l]: Hsl) => `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`

/** Up to three colours, strongest first; greys for a cover without colour */
async function read(url: string): Promise<string[]> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = url
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = PALETTE_PX
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  ctx.drawImage(img, 0, 0, PALETTE_PX, PALETTE_PX)
  const data = ctx.getImageData(0, 0, PALETTE_PX, PALETTE_PX).data
  // 24 hue buckets, each pixel weighted by how vivid it is
  const buckets = Array.from({ length: 24 }, () => ({ weight: 0, h: 0, s: 0, l: 0 }))
  let light = 0
  let pixels = 0
  for (let i = 0; i < data.length; i += 4) {
    const [h, s, l] = hsl(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)
    light += l
    pixels++
    if (s < 0.18 || l < 0.1 || l > 0.94) continue
    const w = s * (1 - Math.abs(l - 0.5))
    const b = buckets[Math.floor(h / 15) % 24]
    if (!b) continue
    b.weight += w
    b.h += h * w
    b.s += s * w
    b.l += l * w
  }
  const picked: Hsl[] = []
  for (const b of buckets.filter((x) => x.weight > 0).sort((x, y) => y.weight - x.weight)) {
    // not a stray few pixels, and distinct hues only
    if (b.weight < 0.012 * pixels) break
    const h = b.h / b.weight
    if (picked.some(([ph]) => Math.min(Math.abs(ph - h), 360 - Math.abs(ph - h)) < 30)) continue
    // the cover's own colour, lifted just enough to glow on black
    picked.push([h, clamp(b.s / b.weight, 0.5, 0.9), clamp(b.l / b.weight + 0.12, 0.5, 0.72)])
    if (picked.length === 3) break
  }
  if (picked.length) return picked.map(css)
  // black and white: greys, as light as the cover
  const l = clamp(light / Math.max(1, pixels) + 0.35, 0.6, 0.85)
  return [css([0, 0, Math.min(0.95, l + 0.12)]), css([0, 0, l]), css([0, 0, l - 0.25])]
}

export function palette(url: string): Promise<string[]> {
  let colours = cache.get(url)
  if (!colours) {
    colours = read(url).catch(() => [])
    cache.set(url, colours)
  }
  return colours
}

/** A gradient for bars, top to bottom: lighter, the cover's colour(s), deeper */
export function stops(colours: string[]): string[] {
  const [main, second, third] = colours
  // the cover couldn't be read: the app's own colours
  if (!main) return ['#e8f6ff', '#00a4dc', '#aa5cc3']
  const lighter = main.replace(/ (\d+)%\)$/, (_, l: string) => ` ${Math.min(90, Number(l) + 18)}%)`)
  const deeper = main.replace(/ (\d+)%\)$/, (_, l: string) => ` ${Math.max(30, Number(l) - 22)}%)`)
  return [lighter, main, third ?? second ?? deeper]
}
