/** Session service endpoints. In dev, Vite proxies /ws and /api to 127.0.0.1:8000. */
const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws'
const host = typeof window !== 'undefined' ? window.location.host : 'localhost:5173'

export const SESSION_WS_URL = import.meta.env.VITE_SESSION_WS_URL ?? `${proto}://${host}/ws/session`
export const SESSION_API_URL = import.meta.env.VITE_SESSION_API_URL ?? '/api'
