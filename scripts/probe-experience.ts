/**
 * Dev probe: run the JD analyser over every stored description (read-only copy
 * of the database) and show where experience wasn't found but the text talks
 * about years. Usage:
 *   node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/probe-experience.ts <db file>
 */
import { DatabaseSync } from 'node:sqlite'

import { parseExperience } from '../lib/jobs/analyze.ts'

const file = process.argv[2]
const db = new DatabaseSync(file, { readOnly: true })
const rows = db.prepare("SELECT id, title, description_text AS t FROM company_jobs WHERE description_text IS NOT NULL AND description_text != ''").all() as { id: number; title: string; t: string }[]
let found = 0
const missed: { id: number; title: string; ctx: string[] }[] = []
for (const r of rows) {
  const e = parseExperience(r.t)
  if (e) {
    found++
    continue
  }
  const ctx = [...r.t.matchAll(/[^.\n]{0,70}\b(years?|yrs?)\b[^.\n]{0,50}/gi)].map((m) => m[0].trim()).slice(0, 2)
  if (ctx.length) missed.push({ id: r.id, title: r.title, ctx })
}
console.log(`${rows.length} descriptions · experience found in ${found} · ${missed.length} mention years but got nothing`)
for (const m of missed.slice(0, Number(process.argv[3] ?? 40))) console.log(`#${m.id} ${m.title.slice(0, 50)}\n   ${m.ctx.join('\n   ')}`)
