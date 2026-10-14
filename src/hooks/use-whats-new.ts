import { useEffect, useState } from 'react'

const SEEN_KEY = 'sk_whats_new_seen'

interface WhatsNew {
  url: string
  latestAt: number
  snippet: string
}

// One request per page load, shared by every component that asks.
let request: Promise<WhatsNew | null> | null = null
function fetchWhatsNew() {
  request ??= fetch('/api/whats-new')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => d?.whatsNew ?? null)
    .catch(() => null)
  return request
}

function seenAt() {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0
  } catch {
    return 0
  }
}

// The "What's new" drain: its link, latest post, and whether that post is
// newer than the last time this browser opened it.
export function useWhatsNew() {
  const [info, setInfo] = useState<WhatsNew | null>(null)
  const [seen, setSeen] = useState(0)

  useEffect(() => {
    setSeen(seenAt())
    let alive = true
    fetchWhatsNew().then((d) => alive && setInfo(d))
    return () => {
      alive = false
    }
  }, [])

  const markSeen = () => {
    if (!info) return
    try {
      localStorage.setItem(SEEN_KEY, String(info.latestAt))
    } catch {}
    setSeen(info.latestAt)
  }

  return { info, unread: !!info && info.latestAt > seen, markSeen }
}
