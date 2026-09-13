import { formatElapsed, humanState } from './format'

describe('formatElapsed', () => {
  it('formats seconds as m:ss.t', () => {
    expect(formatElapsed(0)).toBe('0:00.0')
    expect(formatElapsed(12.34)).toBe('0:12.3')
    expect(formatElapsed(75.06)).toBe('1:15.1')
  })
})

describe('humanState', () => {
  it('turns FSM state ids into coach-friendly labels', () => {
    expect(humanState('at_source')).toBe('Pick up a peg')
    expect(humanState('in_transit')).toBe('Moving')
    expect(humanState('hand_clear')).toBe('Rep done')
    expect(humanState('unknown_state')).toBe('unknown_state')
  })
})
