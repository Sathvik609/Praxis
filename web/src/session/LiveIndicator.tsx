export function LiveIndicator({ active, replay = false }: { active: boolean; replay?: boolean }) {
  if (!active) return null
  return (
    <span role="status" className="inline-flex items-center gap-2 text-lg">
      <span aria-hidden className={`h-3 w-3 rounded-full ${replay ? 'bg-amber' : 'bg-red'}`} />
      {replay ? 'Replay' : 'Live · not recording'}
    </span>
  )
}
