/** WCAG 2.1 contrast for every ink/background pair the primitives use, both themes.
 *  Values mirror design/tokens.css (the designers' final palette, 6 Oct 2026); change both together.
 *  The palette is adopted exactly as the artifact (decision D-CONTRAST): no hex nudges. Pairs that
 *  miss AA are named in KNOWN_MISSES with their measured ratio and recorded in docs/ACCESSIBILITY.md, so any
 *  palette change re-opens the decision instead of silently passing or failing. */
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
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
/** First colour stop of a `linear-gradient(...)` token: the lightest stop of the primary fill. */
function firstStop(gradient: string | undefined): string {
  const hex = gradient?.match(/#[0-9a-fA-F]{6}/)?.[0]
  if (!hex) throw new Error(`no colour stop in ${gradient}`)
  return hex
}

const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const light = parse(css, ':root {')
const dark = { ...light, ...parse(css, ":root[data-theme='dark']") }

/** Known AA misses in the artifact palette (D-CONTRAST, docs/ACCESSIBILITY.md). */
const KNOWN_MISSES: Record<string, number> = {
  'light amber-ink on bg': 4.43,
  'light white on sel-bg first stop': 3.3,
  'dark white on sel-bg first stop': 3.54,
}
function expectAA(label: string, ratio: number, min = 4.5) {
  const miss = KNOWN_MISSES[label]
  if (miss !== undefined) {
    // Pinned: the miss is documented, so the ratio must stay exactly what was accepted.
    expect(ratio, label).toBeLessThan(min)
    expect(ratio, label).toBeCloseTo(miss, 1)
    return
  }
  expect(ratio, label).toBeGreaterThanOrEqual(min)
}

test("tokens are the artifact's final palette", () => {
  expect(light).toMatchObject({
    teal: '#3D62E3', 'teal-ink': '#2D4FC7', 'teal-fill': '#3D62E3', mint: '#3D62E3', 'mint-ink': '#2D4FC7',
    amber: '#A15C00', 'amber-ink': '#A15C00', red: '#C0362C', 'red-ink': '#C0362C', 'red-fill': '#C0362C',
    bg: '#ECEDF0', surface: '#FFFFFF', text: '#0E1433', muted: '#4A5578', line: '#E1E3E7', focus: '#3D62E3',
    'tint-mint': '#E3EAFB', 'tint-amber': '#FFF1DC', 'tint-red': '#FDE7E5', 'tint-focus': '#E3EAFB',
    'sel-bg': 'linear-gradient(180deg, #6A88EE, #4A6BE2)',
  })
  expect(dark).toMatchObject({
    teal: '#3A84FF', 'teal-ink': '#8DB5FF', 'teal-fill': '#2F6FE0', mint: '#5B95FF', 'mint-ink': '#8DB5FF',
    amber: '#E7A447', 'amber-ink': '#E7A447', red: '#FF7A6E', 'red-ink': '#FF7A6E', 'red-fill': '#C0362C',
    bg: '#0F1217', surface: '#181C22', text: '#EAF0FA', muted: '#8391AA', line: '#262B33', focus: '#5B95FF',
    'tint-mint': '#1B2A45', 'tint-amber': '#2C2112', 'tint-red': '#2E1614', 'tint-focus': '#1B2A45',
    'sel-bg': 'linear-gradient(180deg, #3A84FF, #1F5FE0)',
  })
  expect(light['font-body']).toMatch(/^"Mulish"/)
  expect(light['font-heading']).toMatch(/^"Mulish"/)
})

for (const [name, t] of [['light', light], ['dark', dark]] as const) {
  describe(`${name} theme`, () => {
    const inks = ['teal-ink', 'mint-ink', 'amber-ink', 'red-ink', 'text', 'muted']
    test.each(inks)('%s on surface and bg ≥ 4.5', (ink) => {
      expectAA(`${name} ${ink} on surface`, contrast(t[ink], t.surface))
      expectAA(`${name} ${ink} on bg`, contrast(t[ink], t.bg))
    })
    test.each([
      ['teal-ink', 'tint-mint'],
      ['mint-ink', 'tint-mint'],
      ['amber-ink', 'tint-amber'],
      ['red-ink', 'tint-red'],
    ])('%s on %s ≥ 4.5', (ink, tint) => {
      expectAA(`${name} ${ink} on ${tint}`, contrast(t[ink], t[tint]))
    })
    test('white on the fills ≥ 4.5', () => {
      expectAA(`${name} white on teal-fill`, contrast('#ffffff', t['teal-fill']))
      expectAA(`${name} white on red-fill`, contrast('#ffffff', t['red-fill']))
      expectAA(`${name} white on sel-bg first stop`, contrast('#ffffff', firstStop(t['sel-bg'])))
    })
    test('focus ring visible against surface ≥ 3', () => {
      expect(contrast(t.focus, t.surface)).toBeGreaterThanOrEqual(3)
    })
  })
}
