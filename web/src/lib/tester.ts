/** Team test (12 Oct): the tester name this browser runs sessions under. Asked once by
 *  `TesterGate` when the service's `/health` says `team_test` (the hosted review build only),
 *  sent as `tester` on every session socket, saved with the session, and read back by the
 *  service's `/api/review`. Same cleaning as the service's `review.clean_tester`. */
const KEY = 'praxis.tester'

export function cleanTester(raw: string): string | null {
  const name = raw.trim().toLowerCase().replace(/[^a-z0-9 _.-]/g, '').slice(0, 24).trim()
  return name || null
}

export function readTester(): string | null {
  try {
    return cleanTester(localStorage.getItem(KEY) ?? '')
  } catch {
    return null
  }
}

export function writeTester(raw: string): string | null {
  const name = cleanTester(raw)
  try {
    if (name) localStorage.setItem(KEY, name)
    else localStorage.removeItem(KEY)
  } catch {
    /* storage blocked: sessions go untagged */
  }
  return name
}

/** Extra socket params: `{ tester }` when a name is set, else nothing. */
export function testerParams(): Record<string, string> {
  const t = readTester()
  return t ? { tester: t } : {}
}
