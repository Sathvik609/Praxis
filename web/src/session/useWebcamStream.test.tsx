import { act, renderHook } from '@testing-library/react'
import { ACK_TIMEOUT_MS, readCaptureTime } from './latency'
import { useWebcamStream } from './useWebcamStream'

/** A WebSocket double that records what the hook sends and lets the test deliver events. */
class FakeSocket {
  static OPEN = 1
  static instances: FakeSocket[] = []
  readyState = 1
  binaryType = 'blob'
  sent: (ArrayBuffer | string)[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((m: { data: string }) => void) | null = null
  constructor(public url: string) {
    FakeSocket.instances.push(this)
  }
  send(data: ArrayBuffer | string) {
    this.sent.push(data)
  }
  close() {
    this.readyState = 3
  }
  deliver(event: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(event) })
  }
}

const realNow = Date.now()

beforeEach(() => {
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(realNow)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
  })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => {})
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D)
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9]).buffer
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb({ arrayBuffer: async () => jpeg } as unknown as Blob))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

test('the hook sends one capture-stamped frame, then waits for the frame ack before the next', async () => {
  const video = document.createElement('video')
  const { result } = renderHook(() => useWebcamStream({ wsUrl: 'ws://test/session', mode: 'nhpt', fps: 100 }))
  result.current.videoRef.current = video
  await act(async () => {
    await result.current.start()
  })
  const ws = FakeSocket.instances[0]
  expect(ws).toBeDefined()
  expect(ws.url).toMatch(/mode=nhpt/)

  await tick(10)
  expect(ws.sent).toHaveLength(1)
  const first = ws.sent[0] as ArrayBuffer
  expect(first.byteLength).toBe(8 + 6)
  const tCapture = readCaptureTime(first)
  expect(Math.abs(tCapture - realNow)).toBeLessThan(60 * 60 * 1000) // epoch ms on the performance clock
  expect(new Uint8Array(first).slice(8, 11)).toEqual(new Uint8Array([0xff, 0xd8, 0xff]))

  // several ticks without an ack: nothing more goes out
  await tick(100)
  expect(ws.sent).toHaveLength(1)

  // the frame event acks; the next tick sends again
  act(() => ws.deliver({ type: 'frame', t: 1, id: 1 }))
  await tick(10)
  expect(ws.sent).toHaveLength(2)

  // a coach event is not an ack
  act(() => ws.deliver({ type: 'coach', t: 2, id: 2 }))
  await tick(50)
  expect(ws.sent).toHaveLength(2)

  // safety: after ACK_TIMEOUT_MS with no ack the hook sends anyway
  await tick(ACK_TIMEOUT_MS)
  expect(ws.sent).toHaveLength(3)

  act(() => result.current.stop())
})

test('setup_checks acks a calibrate-mode frame (that mode never emits a frame event)', async () => {
  const video = document.createElement('video')
  const { result } = renderHook(() => useWebcamStream({ wsUrl: 'ws://test/session', mode: 'calibrate', fps: 100 }))
  result.current.videoRef.current = video
  await act(async () => {
    await result.current.start()
  })
  const ws = FakeSocket.instances[0]
  await tick(10)
  expect(ws.sent).toHaveLength(1)
  act(() => ws.deliver({ type: 'calibration', t: 1, id: 1 }))
  act(() => ws.deliver({ type: 'quality', t: 1, id: 2 }))
  await tick(10)
  expect(ws.sent).toHaveLength(1)
  act(() => ws.deliver({ type: 'setup_checks', t: 1, id: 3 }))
  await tick(10)
  expect(ws.sent).toHaveLength(2)
  act(() => result.current.stop())
})
