import * as Dialog from '@radix-ui/react-dialog'
import { useRef, type ReactNode } from 'react'

type Props = {
  open: boolean
  title: string
  /** Read by screen readers; visually hidden. Defaults to a generic sentence (it must not
   *  repeat the title, which screens query by text). */
  description?: string
  /** When given, Escape and a tap on the backdrop close the overlay. Session overlays that
   *  require a choice (paused, pain check) leave it out and stay modal. */
  onClose?: () => void
  /** With `onClose`: false keeps a tap on the backdrop from closing it (Escape still does), for
   *  a dialog a stray tap must not dismiss (the in-session pain check). */
  backdropCloses?: boolean
  /** `alertdialog` instead of `dialog`: a stop the patient must read (stop rules, tracking
   *  lost), announced as an alert. */
  alert?: boolean
  children: ReactNode
  className?: string
}

/** Radix gives focus back on close only to a `Dialog.Trigger`; Praxis opens its dialogs from
 *  ordinary buttons, so focus fell to the page. Spread on `Dialog.Content`: remembers the
 *  control focused when the dialog opened and focuses it again when the dialog closes. */
export function useReturnFocus() {
  const opener = useRef<HTMLElement | null>(null)
  return {
    onOpenAutoFocus: () => {
      const a = document.activeElement
      opener.current = a instanceof HTMLElement && a !== document.body ? a : null
    },
    onCloseAutoFocus: (e: Event) => {
      const el = opener.current
      if (el?.isConnected) {
        e.preventDefault()
        el.focus()
      }
    },
  }
}

/** Modal overlay: dark backdrop (no blur; it sits next to WebGL), card radius and the
 *  raised shadow, a title and an always-present description. */
export function Overlay({ open, title, description, onClose, backdropCloses = true, alert = false, children, className = '' }: Props) {
  const returnFocus = useReturnFocus()
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose?.()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ui-scrim fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          {...returnFocus}
          onEscapeKeyDown={onClose ? undefined : (e) => e.preventDefault()}
          onPointerDownOutside={onClose && backdropCloses ? undefined : (e) => e.preventDefault()}
          role={alert ? 'alertdialog' : 'dialog'}
          className={`ui-dialog fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[min(960px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-[var(--r-card)] bg-surface p-8 text-ink shadow-[var(--shadow-2)] ${className}`}
        >
          <Dialog.Title className="text-3xl">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{description ?? 'Choose an option below to continue.'}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** The buttons row at the foot of an overlay: secondary on the left, primary on the right. */
export function OverlayActions({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mt-8 flex flex-wrap items-center justify-between gap-4 ${className}`}>{children}</div>
}
