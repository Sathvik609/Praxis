import { Link } from 'react-router-dom'
import { ChevronRight } from '../../design/Icon'

/** The quiet way out of the guided path. Everything built to wireframes v1.1 — choose an
 *  exercise, the peg test, the cup, progress, settings, the therapist view — still lives under
 *  `/details`. It is never a primary action: the patient only needs Start. */
export function DetailsLink({ className = '' }: { className?: string }) {
  return (
    <Link
      to="/details"
      className={`inline-flex min-h-14 items-center gap-1 rounded-[var(--r-control)] px-2 text-base text-muted underline underline-offset-4 transition-colors duration-150 hover:bg-tint-mint hover:text-teal-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--focus)]/40 ${className}`}
    >
      Details: all exercises, progress and settings
      <ChevronRight aria-hidden className="h-4 w-4" />
    </Link>
  )
}
