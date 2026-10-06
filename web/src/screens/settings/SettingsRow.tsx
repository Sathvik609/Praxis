import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

type Props = {
  title: ReactNode
  sub?: ReactNode
  /** Trailing control (switch, segmented choice, tag). */
  control?: ReactNode
  /** Makes the whole row one button with a chevron (`st-row-btn`). */
  onClick?: () => void
  /** Like `onClick`, navigating to this path. */
  to?: string
  disabled?: boolean
  /** Accessible name of the row button when the visible text is not the right name. */
  ariaLabel?: string
}

/** One Settings row (the designers' `StRow`): `li.st-row` with a title and a muted line, and
 *  a trailing control; or, when it acts, a full-row `button.st-row.st-row-btn` ending in `›`.
 *  Look from designer.css (`.st-row`, `.st-txt`, `.st-chev`). */
export function SettingsRow({ title, sub, control, onClick, to, disabled, ariaLabel }: Props) {
  const nav = useNavigate()
  const act = onClick ?? (to ? () => nav(to) : undefined)
  const txt = (
    <span className="st-txt">
      <b>{title}</b>
      {sub && <small>{sub}</small>}
    </span>
  )
  if (!act) {
    return (
      <li className="st-row">
        {txt}
        {control}
      </li>
    )
  }
  return (
    <li>
      <button type="button" className="st-row st-row-btn" onClick={act} disabled={disabled} aria-label={ariaLabel}>
        {txt}
        {control}
        <span className="st-chev" aria-hidden>
          ›
        </span>
      </button>
    </li>
  )
}
