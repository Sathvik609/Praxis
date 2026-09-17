/** WCAG 2.1 contrast for every ink/background pair the primitives use, both themes.
 *  Values mirror design/tokens.css; change both together. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function parse(css: string, selector: string): Record<string, string> {
  const block = css.split(selector)[1]?.split('}')[0] ?? ''
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}
function lum(hex: string): number {
  const c = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function mix(fg: string, bg: string, pct: number): string {
  const f = fg.replace('#', ''), b = bg.replace('#', '')
  const ch = (i: number) => Math.round(parseInt(f.slice(i, i + 2), 16) * pct + parseInt(b.slice(i, i + 2), 16) * (1 - pct))
  return '#' + [0, 2, 4].map((i) => ch(i).toString(16).padStart(2, '0')).join('')
}
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8')
const light = parse(css, ':root {')
const dark = { ...light, ...parse(css, ":root[data-theme='dark']") }

for (const [name, t] of [['light', light], ['dark', dark]] as const) {
  describe(`${name} theme`, () => {
    const inks = ['teal-ink', 'mint-ink', 'amber-ink', 'red-ink', 'text', 'muted']
    test.each(inks)('%s on surface and bg ≥ 4.5', (ink) => {
      expect(contrast(t[ink], t.surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t[ink], t.bg)).toBeGreaterThanOrEqual(4.5)
    })
    test.each([['teal-ink', 'teal'], ['mint-ink', 'mint'], ['amber-ink', 'amber'], ['red-ink', 'red']])('%s on its 14 %% tint ≥ 4.5', (ink, base) => {
      expect(contrast(t[ink], mix(t[base], t.surface, 0.14))).toBeGreaterThanOrEqual(4.5)
    })
    test('white on the fills ≥ 4.5', () => {
      expect(contrast('#ffffff', t['teal-fill'])).toBeGreaterThanOrEqual(4.5)
      expect(contrast('#ffffff', t['red-fill'])).toBeGreaterThanOrEqual(4.5)
    })
    test('focus ring visible against surface ≥ 3', () => {
      expect(contrast(t.focus, t.surface)).toBeGreaterThanOrEqual(3)
    })
  })
}
