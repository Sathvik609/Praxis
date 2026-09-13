import { isHeartbeat, parseEvent } from './events'

describe('parseEvent', () => {
  it('parses a heartbeat event from the session service', () => {
    const ev = parseEvent('{"type":"heartbeat","t":1.5,"frame_index":3,"frame":{"width":640,"height":480,"bytes":100}}')
    expect(ev).toEqual({
      type: 'heartbeat',
      t: 1.5,
      frame_index: 3,
      frame: { width: 640, height: 480, bytes: 100 },
    })
  })

  it('returns null for malformed or untyped messages', () => {
    expect(parseEvent('not json')).toBeNull()
    expect(parseEvent('{"t":1}')).toBeNull()
  })
})

describe('isHeartbeat', () => {
  it('narrows only well-formed heartbeat events', () => {
    expect(isHeartbeat(parseEvent('{"type":"heartbeat","t":1,"frame_index":0,"frame":{"width":1,"height":1,"bytes":1}}'))).toBe(true)
    expect(isHeartbeat(parseEvent('{"type":"heartbeat","t":1}'))).toBe(false)
    expect(isHeartbeat(null)).toBe(false)
  })
})
