import { cloneElement, useState, type ReactElement, type ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

// A popover that costs nothing until it's first used. Until then only the
// trigger button renders; the first click mounts the real Popover already
// open. Every entry card has one or two popovers that are almost never
// opened, and mounting them all made opening a drain noticeably slower.
export function LazyPopover({
  trigger,
  triggerChildren,
  align,
  contentClassName,
  children,
}: {
  // The trigger element (usually a <button>), without children.
  trigger: ReactElement<any>
  triggerChildren: ReactNode
  align?: 'start' | 'center' | 'end'
  contentClassName?: string
  children: ReactNode
}) {
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)

  if (!mounted) {
    return cloneElement(
      trigger,
      {
        onClick: () => {
          setMounted(true)
          setOpen(true)
        },
      },
      triggerChildren
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger}>{triggerChildren}</PopoverTrigger>
      <PopoverContent align={align} className={contentClassName} contentEditable={false}>
        {children}
      </PopoverContent>
    </Popover>
  )
}
