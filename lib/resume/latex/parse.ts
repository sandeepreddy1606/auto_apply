/**
 * Macro-aware parser for resume templates built on \section, entry macros
 * (\resumeSubheading / \resumeProject with 4 arguments) and bullet lists
 * between \resumeItemListStart and \resumeItemListEnd.
 *
 * The parse is lossless: render(parse(src)) === src. Every piece keeps its
 * exact original text, and only the parts a tailoring plan changes are
 * re-generated, so your layout, spacing and macros are never disturbed.
 */
import { commentStart, latexToPlain, readArgs, readGroup } from './util'

export type SectionKind =
  | 'summary' | 'skills' | 'education' | 'experience' | 'projects'
  | 'certifications' | 'achievements' | 'other'

export interface Bullet {
  head: string // "\item" + following whitespace
  content: string // original content, braces included ("{...}" or bare text)
  tail: string // trailing comment (with leading spaces) + whitespace
  body: string // content without the wrapping braces
  braced: boolean
  comment: string | null
}

export interface Entry {
  macro: string
  args: string[]
  head: string // macro call … through "\resumeItemListStart" (or the whole region without a list)
  listPrefix: string // inside the list, before the first \item
  bullets: Bullet[]
  after: string // "\resumeItemListEnd" + spacing up to the next entry
  hasList: boolean
}

export interface SkillLine {
  category: string // LaTeX
  items: string // LaTeX, after the ": "
}

export interface Section {
  kind: SectionKind
  title: string // plain text
  heading: string // "\section{...}" exactly as written
  body: string // original body (for unmodified render)
  entries: Entry[] | null
  entryPrefix: string
  entrySuffix: string
  summary: { pre: string; text: string; post: string } | null
  skills: { pre: string; lines: SkillLine[]; seps: string[]; post: string } | null
  modified: boolean
}

export interface ResumeDoc {
  preamble: string // everything before the first \section (incl. \begin{document} and the header)
  sections: Section[]
  tail: string // \end{document} and anything after
}

export const ENTRY_MACROS: Record<string, number> = {
  resumeSubheading: 4,
  resumeProject: 4,
  resumeSubSubheading: 2,
  resumeProjectHeading: 2,
}

const LIST_START = '\\resumeItemListStart'
const LIST_END = '\\resumeItemListEnd'
const SUBLIST_END = '\\resumeSubHeadingListEnd'

export function classifySection(title: string): SectionKind {
  const t = title.toLowerCase()
  if (/summary|objective|profile|about/.test(t)) return 'summary'
  if (/skill|technolog|tool/.test(t)) return 'skills'
  if (/education|academic/.test(t)) return 'education'
  if (/experience|employment|work|internship/.test(t)) return 'experience'
  if (/project/.test(t)) return 'projects'
  if (/certif|licen|course/.test(t)) return 'certifications'
  if (/achiev|award|honou?r|accomplish/.test(t)) return 'achievements'
  return 'other'
}

/** Offsets of `needle` in src that are not inside a comment. */
function findAll(src: string, needle: string | RegExp): number[] {
  const out: number[] = []
  const lines = src.split('\n')
  let offset = 0
  for (const line of lines) {
    const c = commentStart(line)
    const code = c >= 0 ? line.slice(0, c) : line
    if (typeof needle === 'string') {
      let i = code.indexOf(needle)
      while (i >= 0) {
        out.push(offset + i)
        i = code.indexOf(needle, i + needle.length)
      }
    } else {
      const re = new RegExp(needle.source, needle.flags.includes('g') ? needle.flags : `${needle.flags}g`)
      let m: RegExpExecArray | null
      while ((m = re.exec(code))) out.push(offset + m.index)
    }
    offset += line.length + 1
  }
  return out
}

export function parseBullets(inner: string): { prefix: string; bullets: Bullet[] } {
  // \item not followed by a letter (so \itemsep is not a bullet).
  const starts = findAll(inner, /\\item(?![a-zA-Z])/)
  if (!starts.length) return { prefix: inner, bullets: [] }
  const prefix = inner.slice(0, starts[0])
  const bullets: Bullet[] = []
  for (let k = 0; k < starts.length; k++) {
    const chunk = inner.slice(starts[k], k + 1 < starts.length ? starts[k + 1] : inner.length)
    const hm = /^\\item[ \t]*/.exec(chunk)!
    const head = hm[0]
    const rest = chunk.slice(head.length)
    const trailWs = /\s*$/.exec(rest)![0]
    let core = rest.slice(0, rest.length - trailWs.length)
    let comment: string | null = null
    const lastNl = core.lastIndexOf('\n')
    const lastLine = core.slice(lastNl + 1)
    const c = commentStart(lastLine)
    if (c >= 0) {
      const codePart = lastLine.slice(0, c)
      const spaces = /\s*$/.exec(codePart)![0]
      comment = lastLine.slice(c)
      core = core.slice(0, lastNl + 1) + codePart.slice(0, codePart.length - spaces.length)
      bullets.push(makeBullet(head, core, `${spaces}${comment}${trailWs}`, comment))
    } else {
      bullets.push(makeBullet(head, core, trailWs, null))
    }
  }
  return { prefix, bullets }
}

function makeBullet(head: string, content: string, tail: string, comment: string | null): Bullet {
  let braced = false
  let body = content
  if (content.startsWith('{')) {
    const g = readGroup(content, 0)
    if (g && g[1] === content.length) {
      braced = true
      body = g[0]
    }
  }
  return { head, content, tail, body, braced, comment }
}

function parseEntries(body: string): { prefix: string; entries: Entry[]; suffix: string } | null {
  const names = Object.keys(ENTRY_MACROS)
  const starts = findAll(body, new RegExp(`\\\\(${names.join('|')})(?![a-zA-Z])`))
  if (!starts.length) return null
  const subEnds = findAll(body, SUBLIST_END)
  const lastStart = starts[starts.length - 1]
  const suffixStart = subEnds.filter((i) => i > lastStart).pop() ?? body.length
  const prefix = body.slice(0, starts[0])
  const entries: Entry[] = []
  for (let k = 0; k < starts.length; k++) {
    const regionEnd = k + 1 < starts.length ? starts[k + 1] : suffixStart
    const region = body.slice(starts[k], regionEnd)
    const macro = /^\\([a-zA-Z]+)/.exec(region)![1]
    const parsed = readArgs(region, macro.length + 1, ENTRY_MACROS[macro])
    const args = parsed ? parsed.args : []
    const ls = region.indexOf(LIST_START)
    const le = ls >= 0 ? region.indexOf(LIST_END, ls) : -1
    if (ls >= 0 && le >= 0) {
      const head = region.slice(0, ls + LIST_START.length)
      const inner = region.slice(ls + LIST_START.length, le)
      const { prefix: listPrefix, bullets } = parseBullets(inner)
      entries.push({ macro, args, head, listPrefix, bullets, after: region.slice(le), hasList: true })
    } else {
      entries.push({ macro, args, head: region, listPrefix: '', bullets: [], after: '', hasList: false })
    }
  }
  return { prefix, entries, suffix: body.slice(suffixStart) }
}

function parseSummary(body: string): Section['summary'] {
  const lines = body.split('\n')
  let start = -1
  let end = -1
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    const isText = t.length > 0 && !t.startsWith('\\') && !t.startsWith('%')
    if (isText && start < 0) start = i
    if (start >= 0 && !isText) {
      end = i
      break
    }
  }
  if (start < 0) return null
  if (end < 0) end = lines.length
  const pre = lines.slice(0, start).join('\n') + (start > 0 ? '\n' : '')
  const text = lines.slice(start, end).join('\n')
  const post = (end < lines.length ? '\n' : '') + lines.slice(end).join('\n')
  if (pre + text + post !== body) return null
  return { pre, text, post }
}

function parseSkills(body: string): Section['skills'] {
  const lines: SkillLine[] = []
  const spans: [number, number][] = []
  let i = 0
  while (true) {
    const at = body.indexOf('\\textbf{', i)
    if (at < 0) break
    const g = readGroup(body, at + 7)
    if (!g) break
    let j = g[1]
    while (j < body.length && /[ \t]/.test(body[j])) j++
    const g2 = body[j] === '{' ? readGroup(body, j) : null
    if (g2 && /^\s*:/.test(g2[0])) {
      const items = g2[0].replace(/^\s*:\s*/, '')
      lines.push({ category: g[0], items })
      spans.push([at, g2[1]])
      i = g2[1]
    } else {
      i = g[1]
    }
  }
  if (!lines.length) return null
  const seps: string[] = []
  for (let k = 1; k < spans.length; k++) seps.push(body.slice(spans[k - 1][1], spans[k][0]))
  return {
    pre: body.slice(0, spans[0][0]),
    lines,
    seps,
    post: body.slice(spans[spans.length - 1][1]),
  }
}

export function parseResume(src: string): ResumeDoc {
  const docStart = src.indexOf('\\begin{document}')
  const docEnd = src.lastIndexOf('\\end{document}')
  const bodyStart = docStart >= 0 ? docStart : 0
  const bodyEnd = docEnd >= 0 ? docEnd : src.length
  const secStarts = findAll(src.slice(bodyStart, bodyEnd), /\\section\*?\s*\{/).map((i) => i + bodyStart)
  if (!secStarts.length) {
    return { preamble: src.slice(0, bodyEnd), sections: [], tail: src.slice(bodyEnd) }
  }
  const sections: Section[] = []
  for (let k = 0; k < secStarts.length; k++) {
    const s = secStarts[k]
    const e = k + 1 < secStarts.length ? secStarts[k + 1] : bodyEnd
    const raw = src.slice(s, e)
    const brace = raw.indexOf('{')
    const g = readGroup(raw, brace)
    const headingEnd = g ? g[1] : brace + 1
    const heading = raw.slice(0, headingEnd)
    const body = raw.slice(headingEnd)
    const title = latexToPlain(g ? g[0] : '')
    const kind = classifySection(title)
    const ent = kind === 'experience' || kind === 'projects' || kind === 'education' ? parseEntries(body) : null
    sections.push({
      kind,
      title,
      heading,
      body,
      entries: ent?.entries ?? null,
      entryPrefix: ent?.prefix ?? '',
      entrySuffix: ent?.suffix ?? '',
      summary: kind === 'summary' ? parseSummary(body) : null,
      skills: kind === 'skills' ? parseSkills(body) : null,
      modified: false,
    })
  }
  return { preamble: src.slice(0, secStarts[0]), sections, tail: src.slice(bodyEnd) }
}

export function renderBullet(b: Bullet): string {
  return b.head + b.content + b.tail
}

export function renderEntry(e: Entry): string {
  if (!e.hasList) return e.head
  return e.head + e.listPrefix + e.bullets.map(renderBullet).join('') + e.after
}

export function renderSection(s: Section): string {
  if (!s.modified) return s.heading + s.body
  if (s.entries) {
    return s.heading + s.entryPrefix + s.entries.map(renderEntry).join('') + s.entrySuffix
  }
  if (s.summary) return s.heading + s.summary.pre + s.summary.text + s.summary.post
  if (s.skills) {
    const sk = s.skills
    const parts = sk.lines.map((l) => `\\textbf{${l.category}}{: ${l.items}}`)
    let out = sk.pre
    parts.forEach((p, i) => {
      out += p
      if (i < parts.length - 1) out += sk.seps[Math.min(i, sk.seps.length - 1)] ?? ' \\\\\n'
    })
    return s.heading + out + sk.post
  }
  return s.heading + s.body
}

export function renderResume(doc: ResumeDoc): string {
  return doc.preamble + doc.sections.map(renderSection).join('') + doc.tail
}

/** Deep copy, so applying a plan never mutates the parsed base. */
export function cloneDoc(doc: ResumeDoc): ResumeDoc {
  return structuredClone(doc)
}
