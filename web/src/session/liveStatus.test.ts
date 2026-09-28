import { processingPlace } from '../lib/config'
import { liveStatus, statusLabel } from './liveStatus'

const base = { connected: true, camActive: true, error: null, replay: false, frame: { calibrated: true }, lost: false, overlay: null, ended: false }

test.each([
  [{}, 'tracking'],
  [{ error: 'Permission denied' }, 'camera_blocked'],
  [{ error: 'session service unreachable', replay: true }, 'service_unreachable'],
  [{ connected: false }, 'connecting'],
  [{ frame: null }, 'waiting_for_frames'],
  [{ frame: null, replay: true }, 'replay'],
  [{ frame: { calibrated: false } }, 'calibrating'],
  [{ lost: true }, 'lost'],
  [{ replay: true }, 'replay'],
  [{ overlay: { kind: 'paused', rule: 'patient', text: '' } }, 'paused'],
  [{ overlay: { kind: 'stopped', rule: 'pain', text: '' } }, 'ended'],
  [{ ended: true }, 'ended'],
  [{ lost: true, replay: true }, 'lost'],
] as const)('liveStatus(%o) = %s', (over, expected) => {
  expect(liveStatus({ ...base, ...over } as never)).toBe(expected)
})

test('labels never contradict: tracking has no coach override; blocked offers replay', () => {
  expect(statusLabel('tracking', 'cup').coach).toBeNull()
  expect(statusLabel('camera_blocked', 'nhpt').coach).toMatch(/recorded session/)
  expect(statusLabel('calibrating', 'arm').chip).toBe('Looking for you')
  expect(statusLabel('lost', 'nhpt').tone).toBe('amber')
})

test('the live feed label says where frames are processed, from the one helper', () => {
  expect(statusLabel('tracking', 'cup').feed).toBe(`Live · ${processingPlace()}`)
})

test('arm status text follows the exercise view: side view turns sideways, front view faces the camera', () => {
  expect(statusLabel('calibrating', 'arm', 'side').coach).toMatch(/Turn your practising side to the camera/)
  expect(statusLabel('lost', 'arm', 'side').coach).toMatch(/Turn your practising side to the camera/)
  for (const l of [statusLabel('calibrating', 'arm', 'front'), statusLabel('lost', 'arm', 'front')]) {
    expect(l.coach).toMatch(/Face the camera/)
    expect(l.coach).not.toMatch(/side to the camera/)
    expect(l.feed).not.toMatch(/side to the camera/)
  }
  expect(statusLabel('lost', 'arm', 'front').coach).toMatch(/both shoulders/)
})

test('table tasks (cup, NHPT) talk about the sheet markers; arm defaults to the side view', () => {
  expect(statusLabel('calibrating', 'cup').coach).toMatch(/four corner markers/)
  expect(statusLabel('lost', 'nhpt', 'table').coach).toMatch(/four corner markers/)
  expect(statusLabel('calibrating', 'arm').coach).toMatch(/side to the camera/)
})
