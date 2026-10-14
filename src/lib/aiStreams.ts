// Parsing for /api/ai/transform: the model files an entry into streams by
// ending its answer with a "STREAMS: a, b" line, which is split off here.

const MAX_STREAMS = 5
const STREAMS_LINE = /\n?[ \t]*STREAMS:[ \t]*(.*)\s*$/i

// Pull the trailing "STREAMS: a, b" line (if any) out of the model's answer.
export function splitStreams(answer: string): { text: string; streams: string[] } {
  const m = answer.match(STREAMS_LINE)
  if (!m || m.index === undefined) return { text: answer, streams: [] }
  const seen = new Set<string>()
  const streams = m[1]
    .split(',')
    .map((s) => s.trim().replace(/^#/, '').replace(/[.;]$/, '').trim())
    .filter((s) => {
      const key = s.toLowerCase()
      if (!s || s.length > 40 || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_STREAMS)
  return { text: answer.slice(0, m.index).trimEnd(), streams }
}
