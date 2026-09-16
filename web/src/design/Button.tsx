import type { ButtonHTMLAttributes } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  full?: boolean
}

const styles = {
  primary: 'bg-teal text-white',
  secondary: 'border-2 border-teal bg-surface text-teal',
  danger: 'bg-red text-white',
  ghost: 'border-2 border-red bg-surface text-red',
}

export function Button({ variant = 'primary', full, className = '', ...rest }: Props) {
  return (
    <button
      {...rest}
      className={`min-h-14 rounded-2xl px-6 text-xl font-bold disabled:opacity-40 ${styles[variant]} ${full ? 'w-full' : ''} ${className}`}
    />
  )
}
