export function ProgressDots({ total, done, current }: { total: number; done: number; current?: number }) {
  return (
    <div aria-label={`${done} of ${total}`} className="flex gap-2">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-6 w-6 rounded-full border-2 ${i < done ? 'border-mint bg-mint' : i === current ? 'border-amber bg-amber' : 'border-line bg-surface'}`}
        />
      ))}
    </div>
  )
}
