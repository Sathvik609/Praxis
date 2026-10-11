import { crop43 } from './useWebcamStream'

// 11 Oct 2026 robustness sweep: a 16:9 camera drawn straight into the 640×480 canvas is squashed
// 4:3, which breaks the square-pixel camera model the service's camera-angle row uses (45° read
// as 23° on renders) and misaligns the overlay with the cover-cropped preview.
describe('crop43', () => {
  it('centre-crops a 16:9 camera to 4:3 instead of squashing it', () => {
    const [sx, sy, sw, sh] = crop43(1280, 720)
    expect(sw / sh).toBeCloseTo(4 / 3, 6)
    expect([sx, sy, sh]).toEqual([160, 0, 720])
  })

  it('leaves a 4:3 camera untouched', () => {
    expect(crop43(640, 480)).toEqual([0, 0, 640, 480])
  })

  it('crops a portrait or tall camera top and bottom', () => {
    const [sx, sy, sw, sh] = crop43(480, 640)
    expect(sx).toBe(0)
    expect(sw / sh).toBeCloseTo(4 / 3, 6)
    expect(sy).toBeCloseTo((640 - 360) / 2, 6)
  })

  it('passes an unknown size through (video not ready yet)', () => {
    expect(crop43(0, 0)).toEqual([0, 0, 0, 0])
  })
})
