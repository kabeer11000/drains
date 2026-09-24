import { useEffect, useState } from 'react'
import { useStore } from '@nanostores/react'
import { AtSign } from 'lucide-react'
import { $drains } from '@/helpers/drains'
import { fetchActivity, type ActivityItem } from '@/services/drainsApi'

function relativeTime(ts: number) {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

// Unified feed instead of separate "mentions" / "recent updates" sections —
// a mention badge on an item covers the mentions case without needing a
// second list or a tabbed UI. Fetched from the server (api/activity.ts) so it
// covers every drain, not just the ones this browser has synced lately.
// Refetched on mount (the sidebar remounts per navigation), whenever the
// drain list changes, and when the tab regains focus; the minute tick only
// keeps the "3m ago" labels honest between fetches.
export function RecentActivity() {
  const drains = useStore($drains)
  const [items, setItems] = useState<ActivityItem[]>([])
  const [, setTick] = useState(0)

  useEffect(() => {
    if (drains.length === 0) {
      setItems([])
      return
    }
    let cancelled = false
    const load = () => {
      // A failed refresh keeps showing the last good list rather than
      // blanking it.
      fetchActivity()
        .then((next) => {
          if (!cancelled) setItems(next)
        })
        .catch(() => {})
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    load()
    document.addEventListener('visibilitychange', onVisible)
    const tick = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(tick)
    }
  }, [drains])

  if (items.length === 0) return null

  return (
    <div className="shrink-0 border-t px-4 py-3">
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Recent Activity
      </div>
      <div className="flex flex-col gap-0.5">
        {items.map((item) => (
          <a
            key={`${item.dbName}-${item.entryId}`}
            href={`/drains/${item.dbName}#entry-${item.entryId}`}
            className="flex items-start gap-1.5 rounded-md px-1.5 py-1 text-xs outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
          >
            {item.mentionsMe && <AtSign className="mt-0.5 size-3 shrink-0 text-violet-500" aria-label="Mentions you" />}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium text-neutral-600">{item.drainTitle}</span>
                <span className="shrink-0 text-[10px] text-neutral-400">{relativeTime(item.timestamp)}</span>
              </div>
              <p className="line-clamp-1 text-muted-foreground">
                <span className="text-neutral-500">{item.byMe ? 'You' : item.authorName || 'Someone'}: </span>
                {item.snippet}
              </p>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}
