import type { APIRoute } from 'astro'
import { requireAuth } from '@/lib/requireAuth'
import { consumeAiUsage } from '@/lib/couchdb-admin'
import { chatComplete } from '@/lib/minimax'
import { splitStreams } from '@/lib/aiStreams'

export const prerender = false

const MAX_TEXT = 8000
const MAX_INSTRUCTION = 500

const SYSTEM = [
  'You edit entries in an engineering log (short notes, todos, decisions, links).',
  "Apply the user's instruction to the text and return ONLY the resulting text:",
  'no preamble, no explanation, no quotes or code fences around it.',
  'Plain text only. Use "- " for list items and one item per line when a list is asked for.',
  'Keep @mentions, [[references]], URLs, code and technical details exactly as written.',
  "Answer in the text's language unless the instruction asks otherwise.",
  // App syntax the model may be asked to use.
  'This app files entries into streams (topics inside a log). Only if the instruction asks to tag, file, sort,',
  'categorize or put the entry into streams/topics/categories: end your answer with one extra line exactly like',
  '"STREAMS: Name One, Name Two" (at most 5), preferring the existing streams listed below when they fit and short',
  'new names otherwise. Never write #tags into the text for this, and never add the STREAMS line unless asked.',
  'If the instruction only asks to file it, return the text unchanged plus the STREAMS line.',
].join(' ')

// POST { text, instruction, streams? } -> { text, streams, usage }.
// `streams` in: the drain's existing stream names, so the model can reuse
// them. `streams` out: names to file the entry into (only when asked). The
// client inserts text as text nodes, never as HTML, so it's unescaped.
export const POST: APIRoute = async ({ request }) => {
  const caller = await requireAuth(request)
  if (!caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

  const body = await request.json().catch(() => ({}))
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''
  const existing: string[] = Array.isArray(body.streams)
    ? body.streams.filter((x: unknown) => typeof x === 'string').map((x: string) => x.slice(0, 40)).slice(0, 50)
    : []
  if (!text) return new Response(JSON.stringify({ error: 'Nothing to work on' }), { status: 400 })
  if (!instruction) return new Response(JSON.stringify({ error: 'Say what to do' }), { status: 400 })
  if (text.length > MAX_TEXT || instruction.length > MAX_INSTRUCTION) {
    return new Response(JSON.stringify({ error: 'That text is too long for AI' }), { status: 413 })
  }

  const usage = await consumeAiUsage(caller.email)
  if (!usage) {
    return new Response(JSON.stringify({ error: 'Daily AI limit reached. Try again tomorrow.' }), { status: 429 })
  }

  const raw = await chatComplete(
    [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Existing streams: ${existing.length ? existing.join(', ') : '(none yet)'}\n\nInstruction: ${instruction}\n\nText:\n${text}`,
      },
    ],
    2000
  )

  // Models sometimes wrap the answer in fences or quotes despite being told
  // not to; strip one outer layer.
  const cleaned = raw
    .trim()
    .replace(/^```[a-z]*\n?([\s\S]*?)\n?```$/i, '$1')
    .replace(/^"([\s\S]*)"$/, '$1')
    .trim()

  const { text: out, streams } = splitStreams(cleaned)
  return new Response(JSON.stringify({ text: out, streams, usage }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
