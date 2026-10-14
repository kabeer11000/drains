import { getDrainDb } from '@/services/db'
import { buildStreamIndex } from '@/services/streams'

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function exportDrainMarkdown(dbName: string, title: string) {
  const db = getDrainDb(dbName)
  const res = await db.allDocs({ include_docs: true })
  const docs = res.rows.map((r: any) => r.doc).filter(Boolean)
  const { byEntry } = buildStreamIndex(docs)
  const entries = docs
    .filter((d: any) => d._id.startsWith('entry:'))
    .sort((a: any, b: any) => a.createdAt - b.createdAt)

  let lastDay = ''
  const lines: string[] = [`# ${title}`, '']
  for (const entry of entries) {
    const created = new Date(entry.createdAt)
    const day = created.toDateString()
    if (day !== lastDay) {
      lines.push(`## ${day}`, '')
      lastDay = day
    }
    const time = created.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    // Trailing #slug tags keep streams readable in the export (and work as
    // tags in Obsidian/Bear).
    const tags = (byEntry.get(entry._id.slice('entry:'.length)) ?? []).map((st) => ` #${st.slug}`).join('')
    lines.push(`- **${time}** — ${stripHtml(entry.content)}${tags}`)
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${title.trim() || 'drain'}.md`
  a.click()
  URL.revokeObjectURL(url)
}
