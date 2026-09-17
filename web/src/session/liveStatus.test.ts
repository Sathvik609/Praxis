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
