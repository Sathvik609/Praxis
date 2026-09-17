import type { ReactNode } from 'react'

/** Dark stage container for the camera feed and the avatar: rounded, clipped, with corner
 *  slots for status text. */
export function Panel({ children, topLeft, topRight, bottomLeft, className = '' }: { children: ReactNode; topLeft?: ReactNode; topRight?: ReactNode; bottomLeft?: ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-[var(--r-card)] bg-[var(--stage-a)] text-white shadow-[var(--shadow-1)] ${className}`}>
      {children}
      {topLeft && <div className="pointer-events-none absolute left-4 top-3 z-10 flex items-center gap-2 text-base text-white/85">{topLeft}</div>}
      {topRight && <div className="absolute right-4 top-3 z-10 flex items-center gap-2 text-base text-white/85">{topRight}</div>}
      {bottomLeft && <div className="pointer-events-none absolute bottom-3 left-4 z-10 text-base text-white/80">{bottomLeft}</div>}
    </div>
  )
}
