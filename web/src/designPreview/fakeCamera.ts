/** Design preview only: the camera cannot be used in the preview (no service to send frames to,
 *  and the host's iframe may not allow it), so `getUserMedia` returns a canvas stream that says
 *  so. The live screens then run exactly as with a webcam; their events come from the recorded
 *  stream (`mockSocket.ts`), never from this picture. If the browser has no canvas capture,
 *  the request fails like a missing camera and the screen shows its own camera-blocked state. */

const W = 640
const H = 480

function paint(ctx: CanvasRenderingContext2D, frame: number) {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#EEF0F3')
  g.addColorStop(1, '#DDE1E7')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // The screens mirror the feed (-scale-x-100); draw the words mirrored so they read the right way.
  ctx.setTransform(-1, 0, 0, 1, W, 0)
  // A watermark, not a headline: the overlay drawn on top of it must stay readable.
  ctx.textAlign = 'center'
  ctx.globalAlpha = 0.5
  ctx.fillStyle = '#1A1D21'
  ctx.font = '600 28px Mulish, "Segoe UI", system-ui, sans-serif'
  ctx.fillText('Design preview · no camera', W / 2, H / 2 - 22)
  ctx.font = '19px Mulish, "Segoe UI", system-ui, sans-serif'
  ctx.fillStyle = '#5F6670'
  ctx.fillText('The overlay and cues play a recorded event stream.', W / 2, H / 2 + 14)
  ctx.fillText('Nothing here is measured from you.', W / 2, H / 2 + 40)
  ctx.globalAlpha = 1
  // a slow pulse so the stream keeps producing frames
  ctx.fillStyle = frame % 2 ? '#1A6BFF' : '#8DB5FF'
  ctx.beginPath()
  ctx.arc(W / 2, H / 2 + 90, 6, 0, Math.PI * 2)
  ctx.fill()
}

export function installFakeCamera() {
  const md = (navigator.mediaDevices ?? {}) as MediaDevices
  const getUserMedia = async (): Promise<MediaStream> => {
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    if (!ctx || typeof canvas.captureStream !== 'function') throw new DOMException('design preview: no camera', 'NotFoundError')
    let n = 0
    paint(ctx, n)
    const stream = canvas.captureStream(10)
    const timer = window.setInterval(() => paint(ctx, ++n), 500)
    for (const track of stream.getTracks()) {
      const stop = track.stop.bind(track)
      track.stop = () => {
        window.clearInterval(timer)
        stop()
      }
    }
    return stream
  }
  try {
    Object.defineProperty(md, 'getUserMedia', { value: getUserMedia, configurable: true, writable: true })
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: md, configurable: true })
  } catch {
    /* a locked-down navigator: the screens fall back to their camera-blocked state */
  }
}
