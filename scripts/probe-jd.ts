/** Dev probe: what the analyser extracts from stored JDs (read-only DB copy). */
import { DatabaseSync } from 'node:sqlite'

import { analyzeJd, requirementsLine } from '../lib/jobs/analyze.ts'

const db = new DatabaseSync(process.argv[2], { readOnly: true })
const rows = db.prepare("SELECT id, title, description_text AS t FROM company_jobs WHERE description_text != '' ORDER BY id").all() as { id: number; title: string; t: string }[]
const step = Math.max(1, Math.floor(rows.length / Number(process.argv[3] ?? 30)))
const tally: Record<string, number> = {}
for (const r of rows) {
  const a = analyzeJd(r.title, r.t)
  for (const [k, v] of Object.entries(a.details)) if (v) tally[k] = (tally[k] ?? 0) + 1
}
console.log('details found:', tally)
for (let i = 0; i < rows.length; i += step) {
  const r = rows[i]
  const a = analyzeJd(r.title, r.t)
  console.log(`#${r.id} ${r.title.slice(0, 48)}\n   exp=${a.experience ? `${a.experience.min}${a.experience.max !== null ? '-' + a.experience.max : '+'} «${a.experience.text}»` : '-'}${a.experience_preferred ? ` pref=${a.experience_preferred.min}+` : ''}\n   ${requirementsLine(a).join(' · ')} | skills ${a.required.length}/${a.preferred.length}`)
}
