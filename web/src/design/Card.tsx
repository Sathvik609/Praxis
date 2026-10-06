import type { ReactNode } from 'react'

const tones = {
  default: 'border border-line bg-surface shadow-[var(--shadow-1)]',
  coach: 'border border-line border-l-8 border-l-teal-ink bg-tint-mint',
  watch: 'border border-line border-l-8 border-l-amber-ink bg-tint-amber',
  highlight: 'border-2 border-teal-ink bg-surface shadow-[var(--shadow-1)]',
  /** Hero card: soft surface + ink (designer.css paints it the same; no white-on-teal). */
  brand: 'bg-[var(--surface-soft)] text-ink shadow-[var(--shadow-1)]',
}

type Props = {
  title?: ReactNode
  action?: ReactNode
  tone?: keyof typeof tones
  padding?: 'md' | 'sm' | 'none'
  className?: string
  children: ReactNode
  as?: 'section' | 'div' | 'article'
  'aria-label'?: string
}

/** The one card. Title row (h2) with an optional action on the right. `ui-card ui-card--<tone>` and
 *  `ui-card-title` are the designer.css hooks (glass surface, 6 px accent dot before the title). */
export function Card({ title, action, tone = 'default', padding = 'md', className = '', children, as = 'section', 'aria-label': ariaLabel }: Props) {
  const Tag = as
  const pad = padding === 'md' ? 'p-6' : padding === 'sm' ? 'px-4 py-3' : ''
  return (
    <Tag aria-label={ariaLabel} className={`ui-card ui-card--${tone} rounded-[var(--r-card)] ${tones[tone]} ${pad} ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          {title && <h2 className="ui-card-title text-2xl">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </Tag>
  )
}
