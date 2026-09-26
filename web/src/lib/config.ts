const wsProto = location.protocol === 'https:' ? 'wss' : 'ws'
export const SESSION_WS_URL = `${wsProto}://${location.host}/ws/session`
export const SESSION_API_URL = '' // service routes already start with /api; Vite proxies /api, /health, /events, /ws

/** Where the camera frames are processed, in the patient's words. On a laptop (edge mode) the
 *  service runs on this device; anywhere else it is the Praxis service, which keeps frames in
 *  memory only. Either way nothing is stored. */
export function processingPlace(hostname: string = location.hostname): string {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)
    ? 'processed on this device, never stored'
    : 'processed on the Praxis service in memory, never stored'
}
