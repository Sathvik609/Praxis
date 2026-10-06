import { useId } from 'react'

/** The Praxis mark (same artwork as public/favicon.svg): blue rounded square, white figure lifting
 *  an arm. Decorative: the link or heading around it carries the accessible name. */
export function PraxisMark({ size, className }: { size?: number; className?: string }) {
  const gradient = `praxis-mark-${useId().replace(/[^\w-]/g, '')}`
  const px = size ?? 32
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width={px} height={px} aria-hidden="true" focusable="false" className={className}>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5277F0" />
          <stop offset="1" stopColor="#3458D6" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill={`url(#${gradient})`} />
      <circle cx="27" cy="16" r="5.5" fill="#fff" />
      <path d="M27 27V49" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
      <path d="M27 28C35 28 42 25 46 18" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      <path d="M27 28C20 30 18 34 18 40" fill="none" stroke="#9FD3F0" strokeWidth="5" strokeLinecap="round" />
      <circle cx="46" cy="18" r="3.4" fill="#9FD3F0" />
    </svg>
  )
}
