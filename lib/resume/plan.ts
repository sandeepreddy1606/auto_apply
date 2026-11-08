/**
 * Tailoring plan: the only thing the AI produces. Validation, the
 * deterministic guards, and applying a plan to the parsed template all live
 * here, and none of it trusts the AI's output.
 *
 *   validatePlan → guardPlan (rejects invented claims) → applyPlan → renderResume
 */
import { canonicalSkills, extractSkills } from '@/lib/jobs/skills'
import type { FactBank, FactEntry, GuardFlag } from '@/lib/types'

import { extractMetrics } from './facts'
import type { Bullet, Entry, ResumeDoc } from './latex/parse'
import { cloneDoc } from './latex/parse'
import { entryIds } from './facts'
import { escapeLatex } from './latex/util'

export interface PlanBullet {
  ref: string
  text?: string | null
}

export interface PlanEntry {
  id: string
  bullets: PlanBullet[]
}

export interface TailorPlan {
  summary: string | null
  skills: { category: string; items: string[] }[] | null
  experience: PlanEntry[]
  projects: PlanEntry[]
  notes: string[]
}

/** JSON Schema handed to the model (claude -p --json-schema) and used to validate. */
export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'skills', 'experience', 'projects', 'notes'],
  properties: {
    summary: { type: ['string', 'null'], maxLength: 900 },
    skills: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'items'],
        properties: {
          category: { type: 'string', maxLength: 60 },
          items: { type: 'array', items: { type: 'string', maxLength: 80 }, maxItems: 30 },
        },
      },
    },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'bullets'],
        properties: {
          id: { type: 'string' },
          bullets: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['ref'],
              properties: { ref: { type: 'string' }, text: { type: ['string', 'null'], maxLength: 400 } },
            },
          },
        },
      },
    },
    projects: { $ref: '#/properties/experience' },
    notes: { type: 'array', items: { type: 'string', maxLength: 300 }, maxItems: 10 },
  },
} as const

/** Structural validation (no external schema library). Returns a normalized plan or throws. */
export function validatePlan(raw: unknown): TailorPlan {
  const o = raw as Record<string, unknown>
  if (!o || typeof o !== 'object') throw new Error('Plan is not an object')
  const entries = (v: unknown, what: string): PlanEntry[] => {
    if (!Array.isArray(v)) throw new Error(`${what} must be an array`)
    return v.map((e, i) => {
      const eo = e as Record<string, unknown>
      if (typeof eo?.id !== 'string') throw new Error(`${what}[${i}].id must be a string`)
      if (!Array.isArray(eo.bullets)) throw new Error(`${what}[${i}].bullets must be an array`)
      return {
        id: eo.id,
        bullets: eo.bullets.map((b, j) => {
          const bo = b as Record<string, unknown>
          if (typeof bo?.ref !== 'string') throw new Error(`${what}[${i}].bullets[${j}].ref must be a string`)
          const text = typeof bo.text === 'string' && bo.text.trim() ? bo.text.trim() : null
          return { ref: bo.ref, text }
        }),
      }
    })
  }
  let skills: TailorPlan['skills'] = null
  if (Array.isArray(o.skills)) {
    skills = o.skills.map((g, i) => {
      const go = g as Record<string, unknown>
      if (typeof go?.category !== 'string' || !Array.isArray(go.items)) {
        throw new Error(`skills[${i}] must have category and items`)
      }
      return { category: go.category, items: go.items.filter((x): x is string => typeof x === 'string') }
    })
  }
  return {
    summary: typeof o.summary === 'string' && o.summary.trim() ? o.summary.trim() : null,
    skills,
    experience: entries(o.experience ?? [], 'experience'),
    projects: entries(o.projects ?? [], 'projects'),
    notes: Array.isArray(o.notes) ? o.notes.filter((x): x is string => typeof x === 'string').slice(0, 10) : [],
  }
}

const words = (s: string): Set<string> =>
  new Set(s.toLowerCase().replace(/[^a-z0-9+#.%]+/g, ' ').split(' ').filter((w) => w.length > 2))

/** 0 = identical wording, 1 = completely different. */
export function drift(a: string, b: string): number {
  const A = words(a)
  const B = words(b)
  if (!A.size && !B.size) return 0
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  return 1 - inter / (A.size + B.size - inter)
}

export interface GuardOptions {
  driftThreshold: number // 0–1
  minBulletsPerExperience: number
  maxBulletChars: number
  projectsCount: number
}

export const DEFAULT_GUARDS: GuardOptions = {
  driftThreshold: 0.6,
  minBulletsPerExperience: 2,
  maxBulletChars: 260,
  projectsCount: 3,
}

/**
 * Enforce the no-invention rules. Rejected rewrites fall back to the original
 * bullet; flags explain every decision so the UI can show them.
 */
export function guardPlan(
  plan: TailorPlan,
  facts: FactBank,
  opts: GuardOptions = DEFAULT_GUARDS,
): { plan: TailorPlan; flags: GuardFlag[] } {
  const flags: GuardFlag[] = []
  const byId = new Map<string, FactEntry>([...facts.experience, ...facts.projects].map((e) => [e.id, e]))
  const allowedSkills = new Set(facts.all_skills)
  const allMetrics = new Set(facts.all_metrics)

  const guardEntries = (list: PlanEntry[], kind: 'experience' | 'project'): PlanEntry[] => {
    const out: PlanEntry[] = []
    const seen = new Set<string>()
    for (const pe of list) {
      const fe = byId.get(pe.id)
      if (!fe || fe.kind !== kind) {
        flags.push({ level: 'reject', where: pe.id, message: `Unknown ${kind} "${pe.id}" ignored` })
        continue
      }
      if (seen.has(pe.id)) continue
      seen.add(pe.id)
      const bullets: PlanBullet[] = []
      const usedRefs = new Set<string>()
      for (const pb of pe.bullets) {
        const src = fe.bullets.find((b) => b.id === pb.ref)
        if (!src) {
          flags.push({ level: 'reject', where: `${pe.id}.${pb.ref}`, message: 'Bullet reference does not exist; dropped' })
          continue
        }
        if (usedRefs.has(pb.ref)) continue
        usedRefs.add(pb.ref)
        if (!pb.text || pb.text === src.text) {
          bullets.push({ ref: pb.ref, text: src.extra ? src.text : null })
          continue
        }
        const where = `${pe.id}.${pb.ref}`
        let text = pb.text.replace(/\s+/g, ' ').trim()
        if (text.length > opts.maxBulletChars) {
          flags.push({ level: 'warn', where, message: `Rewrite was ${text.length} chars; kept the original` })
          bullets.push({ ref: pb.ref, text: src.extra ? src.text : null })
          continue
        }
        const srcMetrics = new Set(src.metrics)
        const invented = extractMetrics(text).filter((m) => !srcMetrics.has(m))
        if (invented.length) {
          flags.push({ level: 'reject', where, message: `Rewrite introduced numbers not in the original (${invented.join(', ')}); kept the original` })
          bullets.push({ ref: pb.ref, text: src.extra ? src.text : null })
          continue
        }
        const srcSkills = new Set([...src.skills, ...extractSkills(fe.stack.join(', '))])
        const newSkills = extractSkills(text).filter((s) => !srcSkills.has(s))
        if (newSkills.length) {
          flags.push({ level: 'reject', where, message: `Rewrite named technologies this bullet doesn't mention (${newSkills.join(', ')}); kept the original` })
          bullets.push({ ref: pb.ref, text: src.extra ? src.text : null })
          continue
        }
        if (/\bTODO\b/i.test(text)) {
          flags.push({ level: 'reject', where, message: 'Rewrite contains TODO; kept the original' })
          bullets.push({ ref: pb.ref, text: src.extra ? src.text : null })
          continue
        }
        const d = drift(src.text, text)
        if (d > opts.driftThreshold) {
          flags.push({ level: 'warn', where, message: `Reworded heavily (${Math.round(d * 100)}% different) — review it` })
        }
        text = text.replace(/\.\s*$/, '.')
        bullets.push({ ref: pb.ref, text })
      }
      if (kind === 'experience' && bullets.length < Math.min(opts.minBulletsPerExperience, fe.bullets.length)) {
        for (const b of fe.bullets) {
          if (bullets.length >= Math.min(opts.minBulletsPerExperience, fe.bullets.length)) break
          if (!usedRefs.has(b.id) && !b.extra) bullets.push({ ref: b.id, text: null })
        }
        flags.push({ level: 'warn', where: pe.id, message: 'Kept at least two bullets for this role' })
      }
      out.push({ id: pe.id, bullets })
    }
    return out
  }

  const experience = guardEntries(plan.experience, 'experience')
  // Every role stays on the resume, in original (chronological) order.
  const expOut: PlanEntry[] = facts.experience.map((fe) => {
    const p = experience.find((e) => e.id === fe.id)
    if (p) return p
    flags.push({ level: 'warn', where: fe.id, message: 'Plan omitted this role; kept it unchanged' })
    return { id: fe.id, bullets: fe.bullets.filter((b) => !b.extra).map((b) => ({ ref: b.id, text: null })) }
  })
  let projects = guardEntries(plan.projects, 'project').filter((p) => p.bullets.length > 0)
  if (!projects.length && facts.projects.length) {
    flags.push({ level: 'warn', where: 'projects', message: 'Plan chose no projects; kept the originals' })
    projects = facts.projects.slice(0, opts.projectsCount).map((fe) => ({
      id: fe.id,
      bullets: fe.bullets.filter((b) => !b.extra).map((b) => ({ ref: b.id, text: null })),
    }))
  }

  let summary = plan.summary
  if (summary) {
    const invented = extractMetrics(summary).filter((m) => !allMetrics.has(m))
    const newSkills = extractSkills(summary).filter((s) => !allowedSkills.has(s))
    if (invented.length || newSkills.length || /\bTODO\b/i.test(summary)) {
      flags.push({
        level: 'reject',
        where: 'summary',
        message: `Summary named ${[...invented, ...newSkills].join(', ') || 'TODO'} not in your facts; kept the original`,
      })
      summary = null
    }
  }

  let skills = plan.skills
  if (skills) {
    const original = new Map(facts.skills.map((g) => [g.category.toLowerCase(), g.items]))
    const allowedItems = new Set(
      [...facts.skills.flatMap((g) => g.items), ...facts.inventory_extra].map((s) => s.toLowerCase()),
    )
    const allowedCanon = canonicalSkills([...facts.skills.flatMap((g) => g.items), ...facts.inventory_extra])
    skills = skills
      .filter((g) => {
        if (!original.has(g.category.toLowerCase())) {
          flags.push({ level: 'warn', where: 'skills', message: `New skill category "${g.category}" dropped` })
          return false
        }
        return true
      })
      .map((g) => ({
        category: facts.skills.find((o) => o.category.toLowerCase() === g.category.toLowerCase())!.category,
        items: g.items.filter((item) => {
          const ok =
            allowedItems.has(item.toLowerCase()) ||
            [...canonicalSkills([item])].every((c) => allowedCanon.has(c)) && canonicalSkills([item]).size > 0
          if (!ok) flags.push({ level: 'reject', where: 'skills', message: `"${item}" isn't in your skills or inventory; removed` })
          return ok
        }),
      }))
      .filter((g) => g.items.length > 0)
    // Categories the plan forgot keep their original items, after the reordered ones.
    for (const g of facts.skills) {
      if (!skills.some((s) => s.category === g.category)) skills.push({ category: g.category, items: g.items })
    }
  }

  return { plan: { ...plan, summary, skills, experience: expOut, projects }, flags }
}

/** Apply a guarded plan to a parsed template. Unmentioned sections stay byte-identical. */
export function applyPlan(
  base: ResumeDoc,
  plan: TailorPlan,
  facts: FactBank,
  opts: { removeForcedBreaks?: boolean } = {},
): ResumeDoc {
  const doc = cloneDoc(base)
  const ids = entryIds(doc)
  const byId = new Map<string, FactEntry>([...facts.experience, ...facts.projects].map((e) => [e.id, e]))

  const rebuildBullets = (entry: Entry, pe: PlanEntry): Bullet[] => {
    const fe = byId.get(pe.id)!
    const template = entry.bullets[0]
    const out: Bullet[] = []
    for (const pb of pe.bullets) {
      const idx = fe.bullets.findIndex((b) => b.id === pb.ref)
      if (idx < 0) continue
      const src = fe.bullets[idx]
      const original = src.extra ? null : entry.bullets[idx]
      if (original && !pb.text) {
        // Unchanged bullet: original LaTeX, minus any trailing TODO/notes comment.
        out.push({ ...original, tail: original.tail.replace(/^[ \t]*%.*$/m, '').replace(/^[ \t]+/, ''), comment: null })
        continue
      }
      const text = escapeLatex(pb.text ?? src.text)
      const like = original ?? template
      const braced = like?.braced ?? true
      out.push({
        head: like?.head ?? '\\item ',
        content: braced ? `{${text}}` : text,
        body: text,
        braced,
        tail: like ? like.tail.replace(/^[ \t]*%.*$/m, '').replace(/^[ \t]+/, '') || '\n' : '\n',
        comment: null,
      })
    }
    // Reordering moves each bullet's trailing whitespace with it; restore the
    // original rhythm: "between bullets" spacing, then the list's closing spacing.
    const clean = (t: string | undefined) => (t ?? '\n').replace(/^[ \t]*%.*$/m, '').replace(/^[ \t]+/, '') || '\n'
    const between = clean(entry.bullets.length > 1 ? entry.bullets[0].tail : undefined)
    const closing = clean(entry.bullets.at(-1)?.tail)
    out.forEach((b, i) => {
      b.tail = i === out.length - 1 ? closing : entry.bullets.length > 1 ? between : b.tail
    })
    return out
  }

  for (const s of doc.sections) {
    if (s.kind === 'summary' && s.summary && plan.summary) {
      s.summary = { ...s.summary, text: escapeLatex(plan.summary) }
      s.modified = true
    }
    if (s.kind === 'skills' && s.skills && plan.skills) {
      s.skills = {
        ...s.skills,
        lines: plan.skills.map((g) => {
          const orig = s.skills!.lines.find(
            (l) => l.category.replace(/\\&/g, '&').toLowerCase() === g.category.toLowerCase() ||
              l.category.toLowerCase() === escapeLatex(g.category).toLowerCase(),
          )
          return { category: orig?.category ?? escapeLatex(g.category), items: g.items.map(escapeLatex).join(', ') }
        }),
      }
      s.modified = true
    }
    if (s.entries && s.kind === 'experience') {
      for (const e of s.entries) {
        const pe = plan.experience.find((p) => p.id === ids.get(e))
        if (pe && e.hasList) {
          e.bullets = rebuildBullets(e, pe)
          s.modified = true
        }
      }
    }
    if (s.entries && s.kind === 'projects') {
      const chosen: Entry[] = []
      for (const pe of plan.projects) {
        const e = s.entries.find((x) => ids.get(x) === pe.id)
        if (!e) continue
        if (e.hasList) e.bullets = rebuildBullets(e, pe)
        chosen.push(e)
      }
      if (chosen.length) {
        s.entries = chosen
        s.modified = true
      }
    }
  }
  if (opts.removeForcedBreaks) removeForcedBreaks(doc)
  return doc
}

/** Drop \newpage / \clearpage lines between sections so fit-to-page decides the length. */
export function removeForcedBreaks(doc: ResumeDoc): void {
  const strip = (s: string): string => s.replace(/^[ \t]*\\(newpage|clearpage|pagebreak)\b[^\n]*\n?/gm, '')
  // Unmodified sections render from `body`, modified ones from their parts, so strip both.
  for (const s of doc.sections) {
    s.body = strip(s.body)
    s.entrySuffix = strip(s.entrySuffix)
    if (s.summary) s.summary.post = strip(s.summary.post)
    if (s.skills) s.skills.post = strip(s.skills.post)
    for (const e of s.entries ?? []) e.after = strip(e.after)
  }
}

/** The identity plan: every entry and bullet as in the base (used for fit-to-page on the base). */
export function identityPlan(facts: FactBank, projectsCount: number): TailorPlan {
  const ent = (e: FactEntry): PlanEntry => ({ id: e.id, bullets: e.bullets.filter((b) => !b.extra).map((b) => ({ ref: b.id })) })
  return {
    summary: null,
    skills: null,
    experience: facts.experience.map(ent),
    projects: facts.projects.slice(0, Math.max(projectsCount, facts.projects.length)).map(ent),
    notes: [],
  }
}
