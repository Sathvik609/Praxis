/** Top-down verification view of the 3×3 board from occupancy events (wireframe 07 right
 *  panel). Corner brackets echo the ArUco markers the overlay draws on the sheet. Each hole
 *  carries its number and a state word for screen readers, never colour alone.
 *
 *  Tap-to-sample (Sprint D-SEG-1): when `onSampleHole` is given, every hole is a 56 px button;
 *  tapping a seated peg asks the service to sample that peg's colour (`sample_colour`), for
 *  wooden or pale pegs the default mask misses. `sampled` shows the confirmation line. */
export function BoardView({
  occupancy,
  nextHole,
  onSampleHole,
  sampled = false,
}: {
  occupancy: Record<string, 'empty' | 'occupied'>
  nextHole: number | null
  onSampleHole?: (hole: number) => void
  sampled?: boolean
}) {
  type HoleState = 'occupied' | 'next' | 'empty'
  const cells = Array.from({ length: 9 }, (_, k) => {
    const occ = occupancy[`hole_${k}`] === 'occupied'
    const state: HoleState = occ ? 'occupied' : k === nextHole ? 'next' : 'empty'
    return { k, state }
  })
  // Theme tokens with the artifact's final values (designer.css `[aria-label="board view"]`):
  // seated = teal fill, next = amber ring with its 4 px glow (`bv-next`), empty = sunken.
  const style = {
    occupied: 'border-teal-fill bg-teal-fill text-white',
    next: 'bv-next border-amber bg-transparent text-amber-ink shadow-[0_0_0_4px_rgba(242,180,87,0.25)]',
    empty: 'border-line bg-[var(--sunken)] text-muted',
  } as const
  const word = { occupied: 'seated', next: 'next', empty: 'empty' } as const
  const corners = ['left-3 top-3 rounded-tl-lg border-l-4 border-t-4', 'right-3 top-3 rounded-tr-lg border-r-4 border-t-4', 'bottom-3 left-3 rounded-bl-lg border-b-4 border-l-4', 'bottom-3 right-3 rounded-br-lg border-b-4 border-r-4']
  const cellClass = (state: HoleState) =>
    `flex h-14 w-14 items-center justify-center rounded-full border-4 text-xl font-bold ${style[state]}`
  return (
    <div role="group" aria-label="board view" className="relative rounded-[var(--r-card)] bg-surface p-8">
      {corners.map((pos) => (
        <span key={pos} aria-hidden className={`absolute ${pos} h-6 w-6 border-teal`} />
      ))}
      <div className="mx-auto grid w-fit grid-cols-3 gap-3">
        {cells.map(({ k, state }) =>
          onSampleHole ? (
            <button
              key={k}
              type="button"
              data-testid={`hole-${k}`}
              data-state={state}
              aria-label={`hole ${k + 1} ${word[state]}${state === 'occupied' ? ' · tap to sample peg colour' : ''}`}
              onClick={() => onSampleHole(k)}
              className={`${cellClass(state)} cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white`}
            >
              <span data-testid="hole" aria-hidden>{k + 1}</span>
            </button>
          ) : (
            <span key={k} data-testid={`hole-${k}`} data-state={state} role="img" aria-label={`hole ${k + 1} ${word[state]}`} className={cellClass(state)}>
              <span data-testid="hole" aria-hidden>{k + 1}</span>
            </span>
          ),
        )}
      </div>
      {onSampleHole ? (
        <p className="mt-4 text-center text-base text-muted" role="status">
          {sampled ? 'Peg colour sampled · tap another seated peg to resample' : 'Pegs not showing? Seat one and tap that hole to sample its colour.'}
        </p>
      ) : null}
    </div>
  )
}
