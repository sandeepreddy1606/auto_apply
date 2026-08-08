/** TypeScript side of the scanner / mailer / gform parity dump. */
import fs from 'node:fs'
import path from 'node:path'

import { mapFieldToProfile, suggestAnswers, unansweredRequired } from '../../lib/server/gform.ts'
import { renderTemplate } from '../../lib/server/mailer.ts'
import { buildKeywords, matchTitle, profileYears } from '../../lib/server/matching.ts'
import type { GoogleForm, Profile } from '../../lib/types.ts'

const root = path.resolve(import.meta.dirname, '../..')
const fx = JSON.parse(
  fs.readFileSync(path.join(root, 'tests/fixtures/logic.json'), 'utf-8'),
) as {
  keyword_cases: { profile: Partial<Profile>; extra?: string }[]
  titles: string[]
  render_context: Record<string, unknown>
  templates: string[]
  question_titles: string[]
  profile: Partial<Profile>
  form: GoogleForm
}

const out: Record<string, unknown> = {}

// ---- scanner: keyword building + title matching ----
out.scanner = fx.keyword_cases.map((c) => {
  const kws = buildKeywords(c.profile, c.extra ?? '')
  const years = profileYears(c.profile)
  return {
    keywords: [...kws].sort(),
    years: years === null ? null : years.toFixed(2),
    titles: fx.titles.map((title) => {
      const [matched, reason] = matchTitle(title, kws, years)
      return { title, matched, reason }
    }),
  }
})

// ---- mailer: template rendering ----
out.render = fx.templates.map((t) => renderTemplate(t, fx.render_context))

// ---- gform: question title -> profile field ----
out.field_map = fx.question_titles.map((title) => ({
  title,
  key: mapFieldToProfile(title),
}))
const suggest = suggestAnswers(fx.form, fx.profile)
out.suggest = suggest
out.missing = unansweredRequired(fx.form, suggest)

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    )
  }
  return value
}

console.log(JSON.stringify(sortKeys(out), null, 2))
