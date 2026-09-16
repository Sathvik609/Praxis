import { isType, parseEvent } from './events'

test('parseEvent returns null on junk and typed event on JSON', () => {
  expect(parseEvent('{')).toBeNull()
  const e = parseEvent('{"type":"heartbeat","t":1,"id":2,"frame_index":0}')
  expect(e?.type).toBe('heartbeat')
  expect(isType(e!, 'heartbeat')).toBe(true)
})
