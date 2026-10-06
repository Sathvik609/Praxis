import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'safety' | 'inverse' | 'link'
  full?: boolean
  icon?: ReactNode
}

const base =
  'ui-btn inline-flex min-h-14 items-center justify-center gap-2 rounded-[var(--r-control)] px-5 text-lg font-bold whitespace-nowrap ' +
  'transition-[background-color,box-shadow,transform,filter] duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--focus)]/40 active:translate-y-px ' +
  'disabled:cursor-not-allowed disabled:opacity-40 disabled:active:translate-y-0'

const styles = {
  primary: 'bg-teal-fill text-white shadow-[var(--shadow-1)] hover:brightness-110',
  secondary: 'border-2 border-teal-ink bg-surface text-teal-ink hover:bg-tint-mint',
  danger: 'bg-red-fill text-white shadow-[var(--shadow-1)] hover:brightness-110',
  ghost: 'border-2 border-red-ink bg-surface text-red-ink hover:bg-tint-red',
  /** Safety actions (Pain / feel unwell): thick red outline on a red tint, always with an icon
   *  and words, so it stands out without relying on colour. */
  safety: 'border-4 border-red-ink bg-tint-red text-red-ink hover:brightness-95',
  inverse: 'bg-white text-teal hover:brightness-95',
  link: 'min-h-12 px-2 text-teal-ink underline underline-offset-4 hover:bg-tint-mint',
}

/** Shows hover, pressed and keyboard-focus states and never relies on colour alone (the label
 *  carries the meaning). `ui-btn ui-btn--<variant>` are the hooks the designers' stylesheet
 *  (designer.css) styles; the Tailwind classes stay as the base look under it. */
export function Button({ variant = 'primary', full, icon, className = '', children, ...rest }: Props) {
  return (
    <button {...rest} className={`${base} ui-btn--${variant} ${styles[variant]} ${full ? 'w-full' : ''} ${className}`}>
      {icon && <span aria-hidden className="-ml-1 inline-flex [&>svg]:h-5 [&>svg]:w-5">{icon}</span>}
      {children}
    </button>
  )
}
