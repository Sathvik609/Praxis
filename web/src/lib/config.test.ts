import { processingPlace } from './config'

test('frames are described as processed on this device only when the service is local', () => {
  expect(processingPlace('localhost')).toBe('processed on this device, never stored')
  expect(processingPlace('127.0.0.1')).toBe('processed on this device, never stored')
  expect(processingPlace('::1')).toBe('processed on this device, never stored')
  expect(processingPlace('praxis.up.railway.app')).toBe('processed on the Praxis service in memory, never stored')
})
