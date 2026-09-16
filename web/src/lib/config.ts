const wsProto = location.protocol === 'https:' ? 'wss' : 'ws'
export const SESSION_WS_URL = `${wsProto}://${location.host}/ws/session`
export const SESSION_API_URL = '' // service routes already start with /api; Vite proxies /api, /health, /events, /ws
