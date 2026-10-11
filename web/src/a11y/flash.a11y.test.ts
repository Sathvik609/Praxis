/** WCAG 2.3.1 (three flashes or below threshold): every repeating CSS animation cycles slower
 *  than 3 per second, and the stylesheets stop animation under reduced motion (system setting
 *  and Settings › Reduced motion). A source scan, since jsdom runs no CSS. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = ['../design/designer.css', '../design/tokens.css', '../index.css', '../designPreview/preview.css']
  .map((p) => readFileSync(resolve(__dirname, p), 'utf8'))
  .join('\n')

test('every infinite animation runs below 3 cycles per second', () => {
  const loops = [...css.matchAll(/animation:\s*[\w-]+\s+([\d.]+)(m?s)[^;}]*infinite/g)]
  expect(loops.length).toBeGreaterThan(0)
  for (const m of loops) {
    const seconds = m[2] === 'ms' ? Number(m[1]) / 1000 : Number(m[1])
    expect(seconds, m[0]).toBeGreaterThan(1 / 3)
  }
})

test('reduced motion stops animation globally, from the system setting and from Settings', () => {
  expect(css).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)\{\s*\*,\*::before,\*::after\{animation:none!important/)
  expect(css).toMatch(/:root\[data-motion=["']reduced["']\] \*/)
})
