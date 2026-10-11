import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[aria-hidden="true"], [inert]'))
}

type Options = {
  /** Keep Tab and Shift+Tab inside the dialog (an `aria-modal` dialog). Off for a non-modal
   *  panel that only needs focus moved in on open and given back on close. */
  trap?: boolean
  /** Escape closes the dialog; leave out when the dialog needs an answer. */
  onEscape?: () => void
}

/** Keyboard behaviour of the artifact's hand-drawn dialogs (`sx-modal`, `cup-modal`,
 *  `dth-modal`, `sx-hold`), which are not Radix dialogs: on open, focus moves inside (to
 *  `[data-autofocus]`, else the first control; not React's `autoFocus`, which would move focus
 *  before the opener is known); while open, Tab cycles inside and Escape closes when allowed; on
 *  close, focus returns to the control that opened it. Radix dialogs (`design/Overlay`) do all
 *  of this themselves. */
export function useModalFocus(ref: RefObject<HTMLElement | null>, open: boolean, { trap = true, onEscape }: Options = {}) {
  const escape = useRef(onEscape)
  useEffect(() => {
    escape.current = onEscape
  })

  useEffect(() => {
    if (!open) return
    const root = ref.current
    if (!root) return
    const opener = document.activeElement instanceof HTMLElement && !root.contains(document.activeElement) ? document.activeElement : null
    if (!root.contains(document.activeElement)) (root.querySelector<HTMLElement>('[data-autofocus]:not([disabled])') ?? focusables(root)[0] ?? root).focus()

    const onKey = (e: KeyboardEvent) => {
      // a dialog opened from this one (a Radix overlay in a portal) handles its own keys
      const active = document.activeElement
      if (active && !root.contains(active) && active.closest('[role="dialog"], [role="alertdialog"]')) return
      if (e.key === 'Escape' && escape.current) {
        e.preventDefault()
        escape.current()
        return
      }
      if (!trap || e.key !== 'Tab') return
      const items = focusables(root)
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      // give focus back only if it was left inside the dialog (or dropped to the page)
      const now = document.activeElement
      if (opener?.isConnected && (!now || now === document.body || root.contains(now))) opener.focus()
    }
  }, [open, ref, trap])
}
