import type { ComponentType, SVGProps } from 'react'
// Hub icons. `Activity` is in design/Icon; the other three are not in the shared set yet and
import { NavLink } from 'react-router-dom'
import { Activity, Home as HomeIcon, Settings as SettingsIcon, TrendingUp } from '../design/Icon'

type Icon = ComponentType<SVGProps<SVGSVGElement>>
const hubs: { label: string; to: string; icon: Icon }[] = [
  { label: 'Home', to: '/', icon: HomeIcon },
  { label: 'Exercises', to: '/exercises', icon: Activity },
  { label: 'Progress', to: '/progress', icon: TrendingUp },
  { label: 'Settings', to: '/settings', icon: SettingsIcon },
]

/** Patient hub navigation. The active hub is filled (tint + ink, AA in both themes) and
 *  bold, and NavLink sets aria-current so the state is not colour-only. */
export function Nav({ program, initial }: { program: string; initial: string }) {
  return (
    <header className="flex h-16 items-center gap-6 border-b border-line bg-surface px-6">
      <span className="font-heading text-2xl font-semibold text-teal-ink">Praxis</span>
      <nav aria-label="Hubs" className="flex gap-1">
        {hubs.map(({ label, to, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex h-14 items-center gap-2 rounded-[var(--r-control)] px-4 text-lg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--focus)]/40 ${isActive ? 'bg-tint-mint font-bold text-teal-ink' : 'text-ink hover:bg-tint-mint'}`
            }
          >
            <Icon aria-hidden className="h-5 w-5" />
            {label}
          </NavLink>
        ))}
      </nav>
      <span className="ml-auto min-w-0 truncate text-muted" title={program}>Program: {program}</span>
      <NavLink
        to="/settings"
        aria-label="Account and settings"
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-tint-mint text-xl font-bold text-teal-ink transition-[filter] hover:brightness-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--focus)]/40"
      >
        {initial}
      </NavLink>
    </header>
  )
}
