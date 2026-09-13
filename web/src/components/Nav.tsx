import { NavLink } from 'react-router-dom'
import { NAV_ITEMS } from '../lib/nav'

/** Persistent navigation. Every link is a 56px tap target (min-h-14 = 3.5rem = 56px). */
export function Nav() {
  return (
    <nav aria-label="Primary" className="border-t border-slate-200 bg-white">
      <ul className="mx-auto flex max-w-5xl">
        {NAV_ITEMS.map((item) => (
          <li key={item.to} className="flex-1">
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex min-h-14 items-center justify-center px-2 text-lg font-medium ${
                  isActive ? 'text-blue-700 underline underline-offset-8' : 'text-slate-700'
                }`
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
