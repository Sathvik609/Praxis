/** The coach is caption-only since 10 Oct (product-owner decision): no source file may use the
 *  browser's speech output. Speech *input* (SpeechRecognition at check-in and in the coach chat)
 *  is unaffected. The API names are assembled here so this guard does not match itself. */
const sources = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

test('no source file speaks: no speech-synthesis output anywhere in the app', () => {
  const output = new RegExp(['speech', 'Synthesis'].join(''), 'i')
  expect(Object.keys(sources).length).toBeGreaterThan(50)
  const offenders = Object.entries(sources)
    .filter(([, text]) => output.test(text))
    .map(([path]) => path)
  expect(offenders).toEqual([])
})
