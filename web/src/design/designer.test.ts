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
