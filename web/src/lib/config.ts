const wsProto = location.protocol === 'https:' ? 'wss' : 'ws'
export const SESSION_WS_URL = `${wsProto}://${location.host}/ws/session`
export const SESSION_API_URL = '' // service routes already start with /api; Vite proxies /api, /health, /events, /ws

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** Where the camera frames are processed, for every privacy line in the UI. Frames always go
 *  over the WebSocket to the session service, so "on this device" is only true when that
 *  service runs on the same machine (the laptop edge build). On a hosted build they are
 *  processed on the Praxis service, in memory, and still never stored. */
export function processingPlace(hostname: string = location.hostname): string {
  return LOCAL_HOSTS.has(hostname) ? 'processed on this device, never stored' : 'processed on the Praxis service in memory, never stored'
}
