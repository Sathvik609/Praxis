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

/** `pnpm build:design` only: the static design preview with fixtures in place of the session
 *  service. A build-time constant, so every other build drops the preview code. Anything
 *  simulated lives under `src/designPreview/` and is reached only through this flag. */
export const DESIGN_PREVIEW = import.meta.env.MODE === 'design'

/** Where this build runs, for Settings › Demo and judging. Claims AWS only when the service's
 *  `/health` reports COOL's OpenCV build (the Graviton instance from the COOL AMI); the other
 *  AWS cloud services stay off there (`PRAXIS_CLOUD_ENABLED=0`). */
export function deploymentLabel(
  health: { status?: string; opencv_version?: string; opencv_build?: { version: string; cool: boolean } } | null | undefined,
  hostname: string = location.hostname,
): { title: string; sub: string } {
  const video = `Video is ${processingPlace(hostname)}.`
  if (health?.opencv_build?.cool) {
    return { title: `Running on AWS Graviton · COOL OpenCV ${health.opencv_build.version}`, sub: `Other AWS cloud services are off in this build. ${video}` }
  }
  if (LOCAL_HOSTS.has(hostname)) return { title: 'Edge mode · this laptop', sub: `AWS cloud services are off. ${video}` }
  return { title: 'Hosted review build · AWS cloud services off', sub: video }
}
