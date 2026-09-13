export function formatElapsed(seconds: number): string {
  const tenthsTotal = Math.round(Math.max(0, seconds) * 10)
  const m = Math.floor(tenthsTotal / 600)
  const rest = tenthsTotal - m * 600
  const whole = Math.floor(rest / 10)
  const frac = rest % 10
  return `${m}:${String(whole).padStart(2, '0')}.${frac}`
}

const STATE_LABELS: Record<string, string> = {
  at_source: 'Pick up a peg',
  grasped: 'Got it',
  in_transit: 'Moving',
  over_target: 'Over the hole',
  seated: 'Seated',
  hand_clear: 'Rep done',
}

export function humanState(state: string): string {
  return STATE_LABELS[state] ?? state
}
