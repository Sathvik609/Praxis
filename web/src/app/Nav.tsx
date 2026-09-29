import type { ComponentType, SVGProps } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Activity, CalendarDays, Home as HomeIcon, Settings as SettingsIcon, Stethoscope, TrendingUp } from '../design/Icon'

type Icon = ComponentType<SVGProps<SVGSVGElement>>
const hubs: { label: string; to: string; icon: Icon }[] = [
  { label: 'Home', to: '/details', icon: HomeIcon },
  { label: 'Exercises', to: '/details/exercises', icon: Activity },
  { label: 'Progress', to: '/details/progress', icon: TrendingUp },
  { label: 'Calendar', to: '/details/calendar', icon: CalendarDays },
  { label: 'Settings', to: '/details/settings', icon: SettingsIcon },
]

/** Hub navigation (the app lives under `/details`; `/` redirects there). The active hub is filled (tint + ink, AA in both themes) and
 *  bold, and NavLink sets aria-current so the state is not colour-only. */
export function Nav({ program, initial }: { program: string; initial: string }) {
  return (
    <header className="flex h-16 items-center gap-6 border-b border-line bg-surface px-6">
      <Link
        to="/details"
        aria-label="Praxis · home"
        className="rounded-[var(--r-control)] px-1 font-heading text-2xl font-semibold text-teal-ink transition-colors duration-150 hover:bg-tint-mint focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--focus)]/40"
      >
        Praxis
      </Link>
      <nav aria-label="Hubs" className="flex gap-1">
        {hubs.map(({ label, to, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/details'}
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
      {/* Screen 11 lives outside the patient shell; this is its only way in (no clinician
          accounts until Cognito in W6). Since 28 Sep it edits practice days, so it is no
          longer labelled read-only. */}
      <Link
        to="/therapist"
        className="flex h-14 shrink-0 items-center gap-2 rounded-[var(--r-control)] border-2 border-teal-ink px-3 text-lg font-bold text-teal-ink transition-colors duration-150 hover:bg-tint-mint focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--focus)]/40"
      >
        <Stethoscope aria-hidden className="h-5 w-5" />
        Therapist view
      </Link>
      <NavLink
        to="/details/settings"
        aria-label="Account and settings"
        className="flex h-14 shrink-0 items-center gap-2 rounded-full bg-tint-mint pl-1 pr-4 text-lg font-bold text-teal-ink transition-[filter] hover:brightness-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--focus)]/40"
      >
        <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-fill text-xl text-white">{initial}</span>
      </NavLink>
    </header>
  )
}
