// Searching as you type: a query's words, in any order, matched without
// case or accents ("leon" finds Léon), in albums (library.ts) and in films
// and series (titles.ts) alike.

/** Letters that don't come apart into a letter and an accent */
const PLAIN: Record<string, string> = { ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i' }

/** Lowercased, accents off: "Léon" and "leon", "Björk" and "bjork", "Știrile" and "stirile" all match */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[øæœßłđðþı]/g, (c) => PLAIN[c] ?? c)
}

/** A query's words, folded */
export function words(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean)
}
