import * as Dialog from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'

type Props = {
  open: boolean
  title: string
  /** Read by screen readers; visually hidden. Defaults to a generic sentence (it must not
   *  repeat the title, which screens query by text). */
  description?: string
  /** When given, Escape and a tap on the backdrop close the overlay. Session overlays that
   *  require a choice (paused, pain check) leave it out and stay modal. */
  onClose?: () => void
  children: ReactNode
  className?: string
}

/** Modal overlay: dark backdrop (no blur; it sits next to WebGL), card radius and the
 *  raised shadow, a title and an always-present description. */
export function Overlay({ open, title, description, onClose, children, className = '' }: Props) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose?.()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          onEscapeKeyDown={onClose ? undefined : (e) => e.preventDefault()}
          onPointerDownOutside={onClose ? undefined : (e) => e.preventDefault()}
          className={`fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[min(960px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-[var(--r-card)] bg-surface p-8 text-ink shadow-[var(--shadow-2)] ${className}`}
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
