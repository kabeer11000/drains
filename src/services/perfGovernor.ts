import { atom } from 'nanostores'

// Adaptive quality. Layout.astro marks weak hardware as low-end before first
// paint; this watches how the page actually runs and steps down at runtime
// when the main thread keeps blocking. 'low' means html.low-end: no backdrop
// blur, darker overlays (global.css), lighter sync and no link-preview
// fetching (isConstrained). It never steps back up within a session, and the
// verdict is remembered for a week so the next visit starts there.

export type PerfTier = 'normal' | 'low'

const STORAGE_KEY = 'sk_perf_low_until'
const REMEMBER_MS = 7 * 86_400_000
const WINDOW_MS = 10_000
const LONG_TASK_MS = 100
const STRIKES = 5

export const $perfTier = atom<PerfTier>('normal')
// Rolling count of long main-thread tasks (for the ?perf meter).
export const $longTasks = atom(0)

function goLow(remember: boolean) {
  document.documentElement.classList.add('low-end')
  $perfTier.set('low')
  if (remember) {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now() + REMEMBER_MS))
    } catch {}
  }
}

let started = false

export function startPerfGovernor() {
  if (started || typeof window === 'undefined') return
  started = true
  if (document.documentElement.classList.contains('low-end')) $perfTier.set('low')

  // Long Animation Frames where supported (Chrome 123+), long tasks
  // otherwise; neither exists in Safari/Firefox, which just keep the
  // hardware-based tier from Layout.astro.
  const type = PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')
    ? 'long-animation-frame'
    : PerformanceObserver.supportedEntryTypes?.includes('longtask')
      ? 'longtask'
      : null
  if (!type) return

  const recent: number[] = []
  const observer = new PerformanceObserver((list) => {
    const now = performance.now()
    for (const entry of list.getEntries()) {
      // Ignore long frames while the tab is hidden or during first load,
      // which every device pays once.
      if (entry.duration < LONG_TASK_MS || entry.startTime < 5000 || document.hidden) continue
      recent.push(now)
    }
    while (recent.length && now - recent[0] > WINDOW_MS) recent.shift()
    $longTasks.set(recent.length)
    if (recent.length >= STRIKES && $perfTier.get() !== 'low') {
      goLow(true)
      console.info('[perf] main thread kept blocking; switched to low-end mode')
    }
  })
  observer.observe({ type, buffered: false })
}
