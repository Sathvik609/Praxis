/** designer.css is the designers' stylesheet ported verbatim. Vitest runs with `css: false`, so the
 *  privacy and honesty markers it must never hide are checked on the file text: the red
 *  "Live · not recording" marker (`.sx-rec`) and the "Sample" labels on sample data. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(__dirname, 'designer.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
/** Innermost rules (`selector{decls}`), including rules nested in @media blocks. */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }))
const HIDES = /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d])/

function hidingRules(cls: RegExp) {
  return rules.filter((r) => r.selector.split(',').some((s) => cls.test(s.trim())) && HIDES.test(r.body))
}

test('designer.css is present and non-trivial', () => {
  expect(rules.length).toBeGreaterThan(1000)
})

test('no rule hides the red "Live · not recording" marker (.sx-rec)', () => {
  // `.sx-rec` as a whole class, not `.sx-rec-dot`.
  expect(hidingRules(/\.sx-rec(?![\w-])/)).toEqual([])
})

test('no rule hides Sample labels (judge-only gate, hp-sample, pg-sample)', () => {
  expect(hidingRules(/\.judge-only(?![\w-])|\.hp-sample(?![\w-])|\.pg-sample(?![\w-])/)).toEqual([])
})

test('-webkit-backdrop-filter comes before its unprefixed twin (the build keeps both)', () => {
  // Tailwind's lightningcss pass keeps only the -webkit- line when the unprefixed one comes first,
  // so Chrome kept the glass blur an override switches off (the Home avatar went blurry on the hosted build).
  const unprefixedFirst = rules.filter((r) => /(?<![-\w])backdrop-filter\s*:[^;}]+;\s*-webkit-backdrop-filter/.test(r.body))
  expect(unprefixedFirst.map((r) => r.selector)).toEqual([])
})

test('the report never shrinks to the window: the page scrolls instead of clipping its cards', () => {
  // 10 Oct walkthrough: `.rp{min-height:100%}` inside the flex-column `main.ui-main` let the report
  // shrink to the window (the artifact's fit engine handled this; the app has none), and the
  // right column's cards (overflow hidden) were cut off at 1336 × 759 and 1280 × 800.
  const last = (sel: string, prop: RegExp) => [...rules].reverse().find((r) => r.selector.split(',').some((s) => s.trim() === sel) && prop.test(r.body))
  expect(last('.rp', /min-height\s*:\s*100%/)).toBeTruthy()
  expect(last('.rp', /flex-shrink\s*:/)?.body).toMatch(/flex-shrink\s*:\s*0/)
})

test('pages fit the window by layout, never by zooming the page (no fit engine)', () => {
  // 10 Oct: a page-zoom fit engine blurs text below readable size and skews pointer coordinates on
  // the Three.js avatar hotspots and the camera overlays. Spacing and control heights fit the pages.
  expect(rules.filter((r) => /(^|[;\s])zoom\s*:/.test(r.body)).map((r) => r.selector)).toEqual([])
  const pageRoots = /^(html|body|#root|main|\.ui-main|\.ui-shell|\.rp|\.ci-form|\.th-grid|\.pg|\.st)$/
  const scaled = rules.filter((r) => r.selector.split(',').some((s) => pageRoots.test(s.trim())) && /transform\s*:\s*scale/.test(r.body))
  expect(scaled.map((r) => r.selector)).toEqual([])
})
