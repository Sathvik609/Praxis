import { cleanTester, readTester, testerParams, writeTester } from './tester'

beforeEach(() => localStorage.clear())

it('cleans names like the service does', () => {
  expect(cleanTester('  Sam K! ')).toBe('sam k')
  expect(cleanTester('x'.repeat(40))).toBe('x'.repeat(24))
  expect(cleanTester('!!!')).toBeNull()
})

it('stores, reads and clears the tester name', () => {
  expect(readTester()).toBeNull()
  expect(testerParams()).toEqual({})
  expect(writeTester('Sathvik')).toBe('sathvik')
  expect(readTester()).toBe('sathvik')
  expect(testerParams()).toEqual({ tester: 'sathvik' })
  writeTester('')
  expect(readTester()).toBeNull()
})
