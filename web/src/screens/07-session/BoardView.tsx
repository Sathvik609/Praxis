/** Top-down verification view of the 3×3 board from occupancy events (wireframe 07 right
 *  panel). Marker squares in the corners echo the printed sheet. */
export function BoardView({
  occupancy,
  nextHole,
}: {
  occupancy: Record<string, 'empty' | 'occupied'>
  nextHole: number | null
}) {
  type HoleState = 'occupied' | 'next' | 'empty'
  const cells = Array.from({ length: 9 }, (_, k) => {
    const occ = occupancy[`hole_${k}`] === 'occupied'
    const state: HoleState = occ ? 'occupied' : k === nextHole ? 'next' : 'empty'
    return { k, state }
  })
  const style = {
    occupied: 'border-mint bg-mint text-white',
    next: 'border-amber bg-surface text-amber',
    empty: 'border-line bg-[#1B2C2B] text-muted',
  } as const
  return (
    <div aria-label="board view" className="relative rounded-2xl bg-[var(--stage-b)] p-8">
      {['left-3 top-3', 'right-3 top-3', 'left-3 bottom-3', 'right-3 bottom-3'].map((pos) => (
        <span key={pos} aria-hidden className={`absolute ${pos} h-6 w-6 border-4 border-white bg-black`} />
      ))}
      <div className="mx-auto grid w-fit grid-cols-3 gap-3">
        {cells.map(({ k, state }) => (
          <span
            key={k}
            data-testid={`hole-${k}`}
            data-state={state}
            className={`flex h-12 w-12 items-center justify-center rounded-full border-4 text-lg font-bold ${style[state]}`}
          >
            <span data-testid="hole">{k + 1}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
