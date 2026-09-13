import type { Overlay } from '../lib/events'

interface Props {
  overlay: Overlay | null
  frameSize: { width: number; height: number }
  occupancy?: Record<string, 'empty' | 'occupied'> | null
}

/** SVG overlay in frame pixel coordinates, scaled by the parent via viewBox. */
export function HoleOverlay({ overlay, frameSize, occupancy }: Props) {
  return (
    <svg
      data-testid="hole-overlay"
      viewBox={`0 0 ${frameSize.width} ${frameSize.height}`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    >
      {overlay?.holes_px.map(([x, y, r], k) => {
        const isTarget = overlay.target === k
        const occupied = occupancy?.[`hole_${k}`] === 'occupied'
        return (
          <g key={k}>
            <circle
              data-testid="hole"
              data-target={isTarget ? 'true' : 'false'}
              cx={x}
              cy={y}
              r={isTarget ? r * 1.6 : r * 1.2}
              fill={occupied ? 'rgba(34,197,94,0.35)' : 'none'}
              stroke={isTarget ? '#facc15' : occupied ? '#22c55e' : 'rgba(255,255,255,0.8)'}
              strokeWidth={isTarget ? 4 : 2}
            />
            <text x={x} y={y - r * 1.8} fill="#fff" fontSize={14} textAnchor="middle">
              {k}
            </text>
          </g>
        )
      })}
      {overlay &&
        Object.entries(overlay.markers_px).map(([id, corners]) => (
          <polygon
            key={id}
            points={corners.map(([x, y]) => `${x},${y}`).join(' ')}
            fill="none"
            stroke="#38bdf8"
            strokeWidth={2}
          />
        ))}
    </svg>
  )
}
