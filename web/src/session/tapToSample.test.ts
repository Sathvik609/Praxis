import { lastEventId, latestSampleReply, tapToFramePx } from './tapToSample'

const box = { left: 100, top: 50, width: 800, height: 600 } // the 4:3 picture, 1.25× the frame

describe('tapToFramePx', () => {
  it('maps a tap on the picture to frame pixels, scaled to 640 × 480', () => {
    expect(tapToFramePx(100 + 400, 50 + 300, box, false)).toEqual([320, 240])
    expect(tapToFramePx(100 + 80, 50 + 60, box, false)).toEqual([64, 48])
  })

  it('undoes the mirrored live preview (the frames sent are not mirrored)', () => {
    // a tap near the picture's left edge is the frame's right edge
    expect(tapToFramePx(100 + 80, 50 + 60, box, true)).toEqual([576, 48])
  })

  it('ignores a tap in the letterbox bars around the picture or on an unsized box', () => {
    expect(tapToFramePx(90, 300, box, true)).toBeNull()
    expect(tapToFramePx(500, 49, box, false)).toBeNull()
    expect(tapToFramePx(500, 300, { left: 0, top: 0, width: 0, height: 0 }, false)).toBeNull()
  })
})

describe('latestSampleReply', () => {
  const ev = (id: number, extra: Record<string, unknown>) => ({ type: 'command', t: id, id, cmd: 'sample_colour', ...extra })

  it("returns the newest sample_colour answer after the send, with the service's caption", () => {
    const events = [
      ev(3, { ok: false, message: 'old' }),
      { type: 'frame', t: 4, id: 4 },
      ev(5, { ok: true, applied: true, detected: true, message: 'Cup colour set. I can see the cup now.' }),
    ]
    expect(latestSampleReply(events, 4)).toEqual({ id: 5, ok: true, message: 'Cup colour set. I can see the cup now.', reason: undefined, detected: true })
    expect(latestSampleReply(events, 5)).toBeNull()
    expect(lastEventId(events)).toBe(5)
  })

  it('a refusal keeps its reason', () => {
    const r = latestSampleReply([ev(9, { ok: false, reason: 'no_colour', message: 'That spot has almost no colour' })], 0)
    expect(r?.ok).toBe(false)
    expect(r?.reason).toBe('no_colour')
  })
})
