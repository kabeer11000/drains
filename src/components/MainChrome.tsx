import { Menu } from 'lucide-react'
import { $sidebarOpen } from './AppSidebar'
import { SearchTrigger } from './CommandPalette'

// The per-page floating controls in the main column: the phone menu button
// and the contextual search pill. Small, so it's fine to remount per page.
export default function MainChrome() {
  return (
    <>
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
    </>
  )
}
