/** The one count-grammar helper for every rendered count (live screens, report, progress,
 *  therapist): "1 peg", "2 pegs", "1 reach", "3 reaches". English only; pass `many` for an
 *  irregular noun. */
export function plural(n: number, one: string, many?: string): string {
  if (n === 1) return one
  if (many) return many
  return /(s|x|z|ch|sh)$/.test(one) ? `${one}es` : `${one}s`
}

export const countOf = (n: number, one: string, many?: string): string => `${n} ${plural(n, one, many)}`
