import type { Check } from '../05-camera-setup/Checklist'
import { readyHint } from './readyHint'

const c = (id: string, status: Check['status'], hint: string | null = null): Check => ({ id, label: id, status, hint })

test('nothing to say when every check passes', () => {
  expect(readyHint([c('camera', 'pass'), c('person', 'pass')], 'side')).toBeNull()
})

test('the camera comes before the person, the person before the view, the view before the light', () => {
  const checks = [c('lighting', 'check'), c('view', 'fail'), c('person', 'fail'), c('camera', 'fail')]
  expect(readyHint(checks, 'side')?.id).toBe('camera')
  expect(readyHint(checks.slice(0, 3), 'side')?.id).toBe('person')
  expect(readyHint(checks.slice(0, 2), 'side')?.id).toBe('view')
  expect(readyHint(checks.slice(0, 1), 'side')?.id).toBe('lighting')
})

test('the service’s own hint is used when it sends one', () => {
  expect(readyHint([c('person', 'fail', 'Move the chair back about a step.')], 'side')?.text).toBe('Move the chair back about a step.')
})

test('the view hint matches the view this exercise needs', () => {
  expect(readyHint([c('view', 'fail')], 'side')?.text).toMatch(/side/)
  expect(readyHint([c('view', 'fail')], 'front')?.text).toMatch(/Face the camera/)
})
