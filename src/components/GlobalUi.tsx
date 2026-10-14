import { useEffect } from 'react'
import { CommandPalette } from './CommandPalette'
import { PerfMeter } from './PerfMeter'
import { startPerfGovernor } from '@/services/perfGovernor'

// App-wide pieces that live across page swaps (transition:persist in
// AppShell.astro): the search dialog, the ?perf meter, and the performance
// governor. Persisting keeps their state and listeners instead of
// rebuilding them on every drain switch.
export default function GlobalUi() {
  useEffect(startPerfGovernor, [])
  return (
    <>
      <CommandPalette />
      <PerfMeter />
    </>
  )
}
