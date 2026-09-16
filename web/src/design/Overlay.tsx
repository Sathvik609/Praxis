import * as Dialog from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'

export function Overlay({ open, title, children }: { open: boolean; title: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-md" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(960px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-surface p-10 shadow-2xl">
          <Dialog.Title className="text-4xl">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
