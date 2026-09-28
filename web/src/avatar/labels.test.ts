import { CHIP_H, chooseGutter, gutterSide, placeLabels, stageInsets } from './labels'

test('the gutter is beyond the practising arm (front) or behind the figure (side): leaders never cross the torso', () => {
  expect(gutterSide('front', 'left')).toBe('right') // the figure's left arm is on screen right
  expect(gutterSide('front', 'right')).toBe('left')
  expect(gutterSide('side', 'left')).toBe('right') // the figure faces screen left
  expect(gutterSide('side', 'right')).toBe('left')
})

test('a stage too narrow for a side column puts the labels in a band on top', () => {
  expect(chooseGutter(616, 190, 'left')).toBe('left')
  expect(chooseGutter(420, 190, 'right')).toBe('right')
  expect(chooseGutter(288, 190, 'left')).toBe('top')
})

test('insets keep the figure clear of the gutter, the caption bar, the view line and host overlays', () => {
  const left = stageInsets({ gutter: 'left', chipW: 190, captionH: 48, overlayTop: 64, rows: 1 })
  expect(left.left).toBe(206)
  expect(left.right).toBe(8)
  expect(left.bottom).toBe(52)
  expect(left.top).toBe(64) // the overlay buttons sit over the figure side
  const right = stageInsets({ gutter: 'right', chipW: 190, captionH: 48, overlayTop: 64, rows: 1 })
  expect(right.right).toBe(206)
  expect(right.top).toBe(32) // the view line sits over the figure side
  const top = stageInsets({ gutter: 'top', chipW: 190, captionH: 48, overlayTop: 0, rows: 1 })
  expect(top.top).toBe(32 + CHIP_H + 8)
  expect(top.left).toBe(8)
})

describe('placeLabels', () => {
  const w = 420
  const h = 525
  const chipW = { a: 180, b: 170, c: 150 }
  const anchors = [
    { id: 'a', x: 300, y: 200 },
    { id: 'b', x: 310, y: 205 },
    { id: 'c', x: 320, y: 480 }, // near the caption bar
  ]
  const ins = stageInsets({ gutter: 'left', chipW: 180, captionH: 48, overlayTop: 64, rows: 1 })
  const placed = placeLabels(anchors, chipW, { w, h, gutter: 'left', insets: ins, captionH: 48, overlayTop: 64 })
  const byId = Object.fromEntries(placed.map((p) => [p.id, p]))

  test('a column in the gutter, in the anchors\' top-to-bottom order, never overlapping', () => {
    expect(placed.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    for (const p of placed) {
      expect(p.x).toBe(8)
      expect(p.x + p.w).toBeLessThanOrEqual(ins.left)
      expect(p.h).toBe(CHIP_H)
    }
    expect(byId.b.y).toBeGreaterThanOrEqual(byId.a.y + CHIP_H)
    expect(byId.c.y).toBeGreaterThanOrEqual(byId.b.y + CHIP_H)
  })

  test('inside the stage: below the view line, above the caption bar', () => {
    for (const p of placed) {
      expect(p.y).toBeGreaterThanOrEqual(32)
      expect(p.y + p.h).toBeLessThanOrEqual(h - 48)
    }
  })

  test('each leader line runs from the joint to the chip\'s inner edge', () => {
    for (const p of placed) {
      const a = anchors.find((x) => x.id === p.id)!
      expect([p.x1, p.y1]).toEqual([a.x, a.y])
      expect(p.x2).toBe(p.x + p.w)
      expect(p.y2).toBe(p.y + p.h / 2)
    }
  })

  test('the right gutter mirrors it; a crowded column is pushed back up above the caption bar', () => {
    const many = [0, 1, 2, 3, 4].map((i) => ({ id: `m${i}`, x: 100, y: 470 + i }))
    const ws = Object.fromEntries(many.map((m) => [m.id, 160]))
    const insR = stageInsets({ gutter: 'right', chipW: 160, captionH: 48, overlayTop: 0, rows: 1 })
    const out = placeLabels(many, ws, { w, h, gutter: 'right', insets: insR, captionH: 48, overlayTop: 0 })
    for (const p of out) {
      expect(p.x).toBe(w - 8 - 160)
      expect(p.x2).toBe(p.x)
      expect(p.y + p.h).toBeLessThanOrEqual(h - 48)
    }
    for (let i = 1; i < out.length; i++) expect(out[i].y).toBeGreaterThanOrEqual(out[i - 1].y + CHIP_H)
  })

  test('the top band lays chips left to right below the view line, clear of the figure', () => {
    const insT = stageInsets({ gutter: 'top', chipW: 190, captionH: 48, overlayTop: 0, rows: 1 })
    const out = placeLabels([{ id: 'f', x: 200, y: 150 }], { f: 190 }, { w: 288, h: 360, gutter: 'top', insets: insT, captionH: 48, overlayTop: 0 })
    expect(out[0].y).toBe(36)
    expect(out[0].y + out[0].h).toBeLessThanOrEqual(insT.top)
    expect(out[0].x).toBeGreaterThanOrEqual(8)
    expect(out[0].x + out[0].w).toBeLessThanOrEqual(280)
    expect(out[0].y2).toBe(out[0].y + out[0].h) // leader from the chip's bottom edge
    expect(out[0].x2).toBe(200) // straight down to the joint where the pill is over it
    // a joint far to the right pulls its pill right (the pill stays on the stage)
    const r = placeLabels([{ id: 'f', x: 270, y: 150 }], { f: 190 }, { w: 288, h: 360, gutter: 'top', insets: insT, captionH: 48, overlayTop: 0 })
    expect(r[0].x).toBe(288 - 8 - 190)
    // two pills in one row keep their order and do not overlap
    const two = placeLabels([{ id: 'b', x: 300, y: 100 }, { id: 'a', x: 60, y: 100 }], { a: 150, b: 150 }, { w: 420, h: 525, gutter: 'top', insets: insT, captionH: 48, overlayTop: 0 })
    expect(two.map((p) => p.id)).toEqual(['a', 'b'])
    expect(two[1].x).toBeGreaterThanOrEqual(two[0].x + two[0].w)
    expect(two[1].x + two[1].w).toBeLessThanOrEqual(412)
  })
})
