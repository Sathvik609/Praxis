import type { KeyboardEvent } from 'react'

/** Arrow-key selection for the artifact's button-built radio groups and tab lists (WAI-ARIA
 *  radio group / tabs pattern): on the group, Right/Down and Left/Up move to the next / previous
 *  option (wrapping), Home / End to the first / last, and the option moved to is selected.
 *  Every option also stays a Tab stop and works with Enter / Space, so nothing depends on the
 *  arrows. `NumberScale` and the feedback pain scale have their own roving tabindex. */
export function arrowSelect(e: KeyboardEvent<HTMLElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled]), [role="tab"]:not([disabled])')]
  const i = items.indexOf(document.activeElement as HTMLElement)
  if (i < 0 || !items.length) return
  const n = items.length
  let next: number
  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      next = (i + 1) % n
      break
    case 'ArrowLeft':
    case 'ArrowUp':
      next = (i - 1 + n) % n
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = n - 1
      break
    default:
      return
  }
  e.preventDefault()
  if (next === i) return
  items[next].focus()
  items[next].click()
}
