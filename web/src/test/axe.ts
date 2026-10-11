/** axe-core (4.13.0, MPL-2.0) over a rendered screen in jsdom: every WCAG 2.0 / 2.1 A and AA rule,
 *  plus the best-practice rules that matter for a screen-reader user here (heading order, one
 *  `main`, landmarks). See docs/ACCESSIBILITY.md.
 *
 *  One rule is off in jsdom and only one: `color-contrast`. jsdom has no layout engine and the
 *  vitest run loads no CSS (`css: false`), so axe cannot know any colour and reports every text
 *  node as "incomplete". Contrast is checked instead by `design/contrast.test.ts` (every token
 *  pair, both themes) and by `tools/a11y-browser.mjs` (axe in headless Chrome over the built
 *  pages, with the three D-CONTRAST exceptions named there). Nothing else is excluded. */
import axe from 'axe-core'

const BEST_PRACTICE = ['heading-order', 'landmark-unique', 'landmark-no-duplicate-main', 'landmark-main-is-top-level', 'page-has-heading-one', 'empty-heading', 'aria-allowed-role', 'presentation-role-conflict']

export type AxeOptions = {
  /** A screen that renders without the patient Shell has no page `main` in the test; set when
   *  the screen is checked as a whole page (it owns its own `main`). */
  page?: boolean
}

export async function axeViolations(root: Element = document.body, { page = false }: AxeOptions = {}) {
  const rules = page ? [...BEST_PRACTICE, 'landmark-one-main', 'region'] : BEST_PRACTICE.filter((r) => r !== 'page-has-heading-one')
  const result = await axe.run(root, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: {
      'color-contrast': { enabled: false }, // jsdom: no layout, no CSS (see the module comment)
      ...Object.fromEntries(rules.map((r) => [r, { enabled: true }])),
    },
    resultTypes: ['violations'],
  })
  return result.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => `${n.target.join(' ')} :: ${n.failureSummary?.split('\n').slice(1).join(' ').trim()}`),
  }))
}

/** Fails with a readable list (rule, help, offending nodes) when axe finds anything. */
export async function expectNoAxeViolations(root?: Element, options?: AxeOptions) {
  const violations = await axeViolations(root, options)
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
}
