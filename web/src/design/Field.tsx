import { useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'

const box =
  'w-full rounded-[var(--r-control)] border-2 border-line bg-surface px-4 text-lg text-ink placeholder:text-muted ' +
  'focus:border-teal-ink focus:outline-none focus-visible:ring-4 focus-visible:ring-[var(--focus)]/40'

/** Labelled text input. The label is always visible (no placeholder-only fields). */
export function Field({ label, hint, className = '', ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block font-bold">{label}</label>
      <input id={id} {...rest} className={`${box} min-h-14`} />
      {hint && <div className="mt-1 text-base text-muted">{hint}</div>}
    </div>
  )
}

export function TextArea({ label, hint, className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string }) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block font-bold">{label}</label>
      <textarea id={id} {...rest} className={`${box} min-h-28 py-3`} />
      {hint && <div className="mt-1 text-base text-muted">{hint}</div>}
    </div>
  )
}
