import { useLayoutEffect, useRef, useState } from 'react'

/** Charts draw in CSS pixels: the SVG has a fixed pixel height and its viewBox width is the
 *  figure's measured width, so labels stay 12 px and bars stay inside the height at any card width.
 *  (Until 10 Oct the charts drew into a fixed 320-unit viewBox at `w-full h-auto`, which scaled
 *  the text and height with the card: ~40 px labels and a chart taller than the window on the
 *  report.) Without ResizeObserver (tests, old browsers) the width stays at `fallback`. */
export function useChartWidth<T extends Element>(fallback = 320) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0)
      if (w > 0) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/** Chart heights are modest and fixed: never more than this many CSS px. */
export const CHART_MAX_H = 180
