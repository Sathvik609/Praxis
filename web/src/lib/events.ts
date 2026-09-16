export type PraxisEvent = { type: string; t: number; id: number } & Record<string, unknown>

export function parseEvent(text: string): PraxisEvent | null {
  try {
    const o = JSON.parse(text)
    return typeof o?.type === 'string' ? (o as PraxisEvent) : null
  } catch {
    return null
  }
}

export function isType<T extends PraxisEvent>(e: PraxisEvent, type: string): e is T {
  return e.type === type
}
