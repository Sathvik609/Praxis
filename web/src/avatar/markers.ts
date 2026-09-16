import type { Joint } from './rig'

export type MarkerStatus = 'focus' | 'watch' | 'stable'
export type Marker = { joint: Joint; status: MarkerStatus; label: string }

export const MARKER_STYLE: Record<MarkerStatus, { color: string; word: string; chip: string }> = {
  focus: { color: '#4FA3F7', word: 'Focus', chip: 'bg-[#DDEBFF] text-[#1F4E9E]' },
  watch: { color: '#C97F14', word: 'Watch', chip: 'bg-amber/15 text-amber' },
  stable: { color: '#2FA985', word: 'Stable', chip: 'bg-mint/15 text-teal' },
}
