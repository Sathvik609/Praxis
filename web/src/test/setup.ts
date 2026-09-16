import '@testing-library/jest-dom/vitest'

// Node 22+ ships an experimental `localStorage` global that shadows jsdom's and has no
// working setItem unless --localstorage-file is set. Replace it with an in-memory Storage.
if (typeof globalThis.localStorage?.setItem !== 'function') {
  const mem = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return mem.size
    },
    clear: () => mem.clear(),
    getItem: (k) => mem.get(k) ?? null,
    key: (i) => [...mem.keys()][i] ?? null,
    removeItem: (k) => void mem.delete(k),
    setItem: (k, v) => void mem.set(k, String(v)),
  }
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
}
