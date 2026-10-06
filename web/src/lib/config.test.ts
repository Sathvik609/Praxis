import { processingPlace } from './config'

test.each(['localhost', '127.0.0.1', '::1', '[::1]'])('%s: frames stay on this device', (host) => {
  expect(processingPlace(host)).toBe('processed on this device, never stored')
})

test.each(['praxis-production.up.railway.app', 'praxis.example.org', '192.168.1.20'])('%s: frames go to the Praxis service', (host) => {
  expect(processingPlace(host)).toBe('processed on the Praxis service in memory, never stored')
})

test('defaults to the page host', () => {
  expect(processingPlace()).toBe(processingPlace(location.hostname))
})

test('DESIGN_PREVIEW is off outside the design build', async () => {
  const { DESIGN_PREVIEW } = await import('./config')
  expect(DESIGN_PREVIEW).toBe(false)
})
