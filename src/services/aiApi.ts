import { atom } from 'nanostores'
import { authHeader, parseErrorOr } from './apiAuth'

export interface AiUsage {
  used: number
  limit: number
  resetsAt: number
}

// Shared across every AI-triggering component (EditorToolbar, OutlineAside,
// UserMenu's usage indicator) so they all reflect the same up-to-date count
// without each needing its own fetch/poll.
export const $aiUsage = atom<AiUsage | null>(null)

// The user menu remounts on every navigation; ask the server at most once a
// minute (summaries/cleanups still update $aiUsage from their responses).
let usageFetchedAt = 0
let usageRequest: Promise<AiUsage> | null = null

export async function fetchAiUsage(): Promise<AiUsage> {
  const cached = $aiUsage.get()
  if (cached && Date.now() - usageFetchedAt < 60_000) return cached
  usageRequest ??= fetch('/api/ai/usage', { headers: { Authorization: authHeader() } })
    .then((res) => parseErrorOr<{ usage: AiUsage }>(res, 'Failed to load AI usage'))
    .then(({ usage }) => {
      usageFetchedAt = Date.now()
      $aiUsage.set(usage)
      return usage
    })
    .finally(() => {
      usageRequest = null
    })
  return usageRequest
}

// Apply a free-form instruction to some text ("make it a checklist"). The
// result is plain text; callers insert it as text nodes, never as HTML.
// `streams` carries the drain's stream names so the model can reuse them;
// the answer's `streams` are names to file the entry into (when asked).
export async function transformText(
  text: string,
  instruction: string,
  streams: string[],
  signal?: AbortSignal
): Promise<{ text: string; streams: string[] }> {
  const res = await fetch('/api/ai/transform', {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, instruction, streams }),
    signal,
  })
  const data = await parseErrorOr<{ text: string; streams?: string[]; usage: AiUsage }>(res, 'AI request failed')
  $aiUsage.set(data.usage)
  return { text: data.text, streams: data.streams ?? [] }
}

export async function summarizeEntries(dbName: string, entryIds: string[]): Promise<void> {
  const res = await fetch(`/api/drains/${dbName}/summarize`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ entryIds }),
  })
  const data = await parseErrorOr<{ ok: true; usage: AiUsage }>(res, 'Failed to summarize')
  $aiUsage.set(data.usage)
}
