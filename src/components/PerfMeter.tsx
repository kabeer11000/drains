import { useEffect, useState } from 'react'
import { useStore } from '@nanostores/react'
import { $longTasks, $perfTier } from '@/services/perfGovernor'

// Tiny on-screen meter, shown with ?perf in the URL (remembered for the tab):
// frames per second, long main-thread tasks in the last 10s, DOM size and
// the current quality tier. For checking speed on a phone without DevTools.
export function PerfMeter() {
  const [on, setOn] = useState(false)
  const [fps, setFps] = useState(0)
  const [worst, setWorst] = useState(0)
  const [nodes, setNodes] = useState(0)
  const longTasks = useStore($longTasks)
  const tier = useStore($perfTier)

  useEffect(() => {
    const wanted = new URLSearchParams(location.search).has('perf') || sessionStorage.getItem('sk_perf_meter') === '1'
    if (wanted) sessionStorage.setItem('sk_perf_meter', '1')
    setOn(wanted)
  }, [])

  useEffect(() => {
    if (!on) return
    let frames = 0
    let maxGap = 0
    let last = performance.now()
    let raf = 0
    const tick = (t: number) => {
      frames++
      maxGap = Math.max(maxGap, t - last)
      last = t
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const timer = setInterval(() => {
      setFps(frames)
      setWorst(Math.round(maxGap))
      setNodes(document.getElementsByTagName('*').length)
      frames = 0
      maxGap = 0
    }, 1000)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(timer)
    }
  }, [on])

  if (!on) return null
  const color = fps >= 55 ? 'text-green-400' : fps >= 30 ? 'text-amber-400' : 'text-red-400'
  return (
    <div className="pointer-events-none fixed bottom-2 left-2 z-[100] rounded-md bg-black/80 px-2 py-1 font-mono text-[10px] leading-tight text-white">
      <div>
        <span className={color}>{fps} fps</span> · worst {worst}ms
      </div>
      <div>
        long tasks {longTasks}/10s · {nodes} nodes · {tier}
      </div>
    </div>
  )
}
