import { SESSION_API_URL } from './config'

/** Local sign-in for the edge build (three named accounts, checked by the service; no
 *  database yet). The token lives in sessionStorage for this browser tab. */
export type AuthUser = { username: string; name: string; initial: string }
const KEY = 'praxis.auth'

export function getSession(): { token: string; user: AuthUser } | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as { token: string; user: AuthUser }) : null
  } catch {
    return null
  }
}

/** Bearer header for API calls; empty when signed out. */
export function authHeaders(): Record<string, string> {
  const s = getSession()
  return s ? { authorization: `Bearer ${s.token}` } : {}
}

/** Token for the WebSocket query (browsers cannot set headers on a socket). */
export function authToken(): string | null {
  return getSession()?.token ?? null
}

/** A 401 from the service means the token expired or was revoked: drop it and go to sign-in. */
export function onUnauthorized(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/signin')) {
    window.location.assign(`/signin`)
  }
}

export async function login(username: string, password: string): Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }> {
  let r: Response
  try {
    r = await fetch(`${SESSION_API_URL}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })
  } catch {
    return { ok: false, error: 'Cannot reach the service. Is it running?' }
  }
  const body = (await r.json().catch(() => ({}))) as { ok?: boolean; user?: AuthUser; token?: string; error?: string }
  if (!r.ok || !body.ok || !body.user || !body.token) return { ok: false, error: body.error ?? 'Wrong username or password.' }
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ token: body.token, user: body.user }))
  } catch {
    /* private mode: signed in for this page only */
  }
  return { ok: true, user: body.user }
}

export async function logout(): Promise<void> {
  const s = getSession()
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  if (s) await fetch(`${SESSION_API_URL}/api/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${s.token}` } }).catch(() => undefined)
}
