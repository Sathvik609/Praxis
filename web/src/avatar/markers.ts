import type { Joint } from './rig'

/** Joint markers: Focus (blue) / Watch (amber) / Stable (mint), always with a text label; red is
 *  reserved for stop (CLAUDE.md §1 Avatar, wireframes §3). Colour never carries meaning alone. */
export type MarkerStatus = 'focus' | 'watch' | 'stable' | 'stop'
export type Marker = { joint: Joint; status: MarkerStatus; label: string }

export const MARKER_STYLE: Record<MarkerStatus, { color: string; word: string; chip: string }> = {
  focus: { color: '#4FA3F7', word: 'Focus', chip: 'bg-surface text-focus' },
  watch: { color: '#C97F14', word: 'Watch', chip: 'bg-surface text-amber-ink' },
  stable: { color: '#2FA985', word: 'Stable', chip: 'bg-surface text-mint-ink' },
  stop: { color: '#B9382B', word: 'Stop', chip: 'bg-surface text-red-ink' },
}
