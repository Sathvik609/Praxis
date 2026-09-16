import { NavLink } from 'react-router-dom'

const hubs = [
  ['Home', '/'],
  ['Exercises', '/exercises'],
  ['Progress', '/progress'],
  ['Settings', '/settings'],
] as const

export function Nav({ program, initial }: { program: string; initial: string }) {
  return (
    <header className="flex h-20 items-center gap-6 border-b border-line bg-surface px-6">
      <span className="font-heading text-2xl font-semibold text-teal">Praxis</span>
      <nav className="flex gap-2">
        {hubs.map(([label, to]) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex h-14 items-center rounded-xl px-4 text-lg ${isActive ? 'bg-mint/15 font-bold text-teal' : 'text-ink'}`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <span className="ml-auto text-muted">Program: {program}</span>
      <span
        aria-label="account"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-mint/20 font-bold text-teal"
      >
        {initial}
      </span>
    </header>
  )
}
