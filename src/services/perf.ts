// Is this device or connection constrained? Low-end hardware (html.low-end,
// set in Layout.astro and by the runtime governor), Data Saver, or a 2g/3g
// connection. Callers use it to do less: lighter sync, deferred previews.
export function isConstrained(): boolean {
  if (typeof navigator === 'undefined') return false
  const c = (navigator as any).connection
  const slowNet = !!c && (c.saveData === true || /(?:^|-)(?:2g|3g)$/.test(c.effectiveType ?? ''))
  const lowEnd = typeof document !== 'undefined' && document.documentElement.classList.contains('low-end')
  return slowNet || lowEnd
}
