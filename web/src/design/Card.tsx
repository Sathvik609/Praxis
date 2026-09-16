import type { ReactNode } from 'react'

export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-surface p-6 ${className}`}>
      {title && <h2 className="mb-3 text-2xl">{title}</h2>}
      {children}
    </section>
  )
}
