import type { APIRoute } from 'astro'
import { requireAuth } from '@/lib/requireAuth'
import { getDirectoryDrains, getEntriesByIds, createSummaryEntry, consumeAiUsage } from '@/lib/couchdb-admin'
import { chatComplete } from '@/lib/minimax'
import { escapeHtml, stripHtmlTags } from '@/lib/htmlEscape'

export const prerender = false

export const POST: APIRoute = async ({ request, params }) => {
  const dbName = params.dbName!
  const caller = await requireAuth(request)
  if (!caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

  const drains = await getDirectoryDrains(caller.email)
  if (!drains.some((d) => d.dbName === dbName)) {
    return new Response(JSON.stringify({ error: 'Not a member of this drain' }), { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  // entryIds arrive as raw ulids (node.attrs.entryId has no prefix — see
  // Feed/index.tsx's rawId), but doc ids in this database are "entry:<ulid>".
  const rawIds = Array.isArray(body.entryIds) ? body.entryIds.filter((id: unknown) => typeof id === 'string') : []
  if (rawIds.length === 0) {
    return new Response(JSON.stringify({ error: 'No entries to summarize' }), { status: 400 })
  }
  const entryIds = rawIds.map((id: string) => `entry:${id}`)

  const entries = await getEntriesByIds(dbName, entryIds)
  if (entries.length === 0) {
    return new Response(JSON.stringify({ error: 'None of those entries exist' }), { status: 404 })
  }

  const usage = await consumeAiUsage(caller.email)
  if (!usage) {
    return new Response(JSON.stringify({ error: 'Daily AI limit reached. Try again tomorrow.' }), { status: 429 })
  }

  entries.sort((a: any, b: any) => a.createdAt - b.createdAt)
  // Only entries actually found (not every id requested — some may not
  // exist), so the summary's claimed set matches what it really covers.
  const foundEntryIds = entries.map((e: any) => e._id.slice('entry:'.length))
  // Largest id, not newest createdAt — the feed sorts by id, and the two
  // disagree for split entries (AssignBlockId gives the split-off half an
  // old id but a fresh createdAt). Anchoring on createdAt could slot the
  // summary below some of the very entries it claims.
  const newestSummarizedId = foundEntryIds.reduce((max: string, id: string) => (id > max ? id : max))
  const transcript = entries
    .map((e: any) => `- ${stripHtmlTags(e.content)}`)
    .join('\n')

  // LLM output is treated as untrusted the same way GitHub payloads are
  // (api/ingest/[token].ts) — escaped before it becomes stored HTML, since
  // the entries being summarized could themselves contain adversarial text
  // aimed at getting the model to emit markup.
  const raw = await chatComplete([
    {
      role: 'system',
      content:
        'Summarize the following engineering log entries into a short, plain-prose paragraph (2-4 sentences). No headings, no bullet points, no meta-commentary about being an AI — just the summary itself.',
    },
    { role: 'user', content: transcript },
  ])

  const summaryHtml = `<p>${escapeHtml(raw.trim())}</p>`
  await createSummaryEntry(dbName, summaryHtml, newestSummarizedId, foundEntryIds)

  return new Response(JSON.stringify({ ok: true, usage }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
