import type { ReactNode } from 'react'
import { Menu } from 'lucide-react'
import AppSidebar, { $sidebarOpen } from './AppSidebar'
import { useEffect } from 'react'
import { CommandPalette, SearchTrigger } from './CommandPalette'
import { PerfMeter } from './PerfMeter'
import { startPerfGovernor } from '@/services/perfGovernor'

export default function PageShell({ children }: { children: ReactNode }) {
  useEffect(startPerfGovernor, [])
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[oklch(0.93_0_0)] dark:bg-muted p-2 gap-2">
      <AppSidebar />
      <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-background">
        {/* Below lg, AppSidebar is a hidden slide-over drawer — this is its
            only way to open. */}
        <button
          type="button"
          title="Open menu"
          onClick={() => $sidebarOpen.set(true)}
          className="absolute left-2 top-4 z-30 flex size-7 items-center justify-center rounded-full border bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm outline-none transition-colors hover:bg-background hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 lg:hidden"
        >
          <Menu className="size-4" />
        </button>
        <SearchTrigger />
        <div className="flex h-full min-h-0 flex-col">
          {children}
        </div>
      </main>
      <CommandPalette />
      <PerfMeter />
    </div>
  )
}
