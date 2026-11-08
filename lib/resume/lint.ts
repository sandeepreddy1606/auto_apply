/**
 * Base-resume linter (Settings → Resume → Issues).
 *
 * Detects problems in your base LaTeX and resolves each one with an explicit
 * action, writing the change back into the base source. Issue ids are stable
 * hashes of (kind, context), so a dismissed warning stays dismissed until the
 * offending text changes.
 */
import crypto from 'node:crypto'

import type { Profile, ResumeIssue, ResumeIssueAction } from '@/lib/types'

import { parseResume } from './latex/parse'
import { commentStart, escapeLatex, latexToPlain, readArgs } from './latex/util'

const hash = (s: string): string => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12)

interface Line {
  n: number // 1-based
  text: string
  code: string
  comment: string | null
}

function lines(src: string): Line[] {
  return src.split('\n').map((text, i) => {
    const c = commentStart(text)
    return { n: i + 1, text, code: c >= 0 ? text.slice(0, c) : text, comment: c >= 0 ? text.slice(c) : null }
  })
}

const docBodyStart = (src: string): number => {
  const i = src.indexOf('\\begin{document}')
  return i < 0 ? 1 : src.slice(0, i).split('\n').length
}

/** "TODO: grad month/year" / "TODO -- add your CGPA here, …" inside code (not comments). */
const TODO_SPAN = /TODO\b[^{}\n%]*/

function githubOwner(url: string): string | null {
  const m = /github\.com\/([A-Za-z0-9-]+)/i.exec(url)
  return m ? m[1].toLowerCase() : null
}

/** Consecutive full-line comment block containing line index i. */
function commentBlock(ls: Line[], i: number): [number, number] {
  let a = i
  let b = i
  while (a > 0 && ls[a - 1].text.trim().startsWith('%')) a--
  while (b < ls.length - 1 && ls[b + 1].text.trim().startsWith('%')) b++
  return [a, b]
}

export function lintBase(src: string, profile: Partial<Profile> = {}, dismissed: string[] = []): ResumeIssue[] {
  const issues: ResumeIssue[] = []
  const ls = lines(src)
  const bodyFrom = docBodyStart(src)
  const add = (i: Omit<ResumeIssue, 'id'> & { key: string }) => {
    const id = `${i.kind}-${hash(i.key)}`
    if (dismissed.includes(id)) return
    const { key: _key, ...rest } = i
    issues.push({ id, ...rest })
  }

  // 1. TODO placeholders in visible text — block sending.
  for (const l of ls) {
    const m = TODO_SPAN.exec(l.code)
    if (!m || l.n < bodyFrom) continue
    const span = m[0].trim()
    const plainLine = latexToPlain(l.code).trim()
    const isBullet = /\\item\b/.test(l.code)
    const lower = `${plainLine} ${span}`.toLowerCase()
    const input: ResumeIssueAction['input'] = /month|year|date|grad/.test(lower) ? 'month' : /cgpa|gpa|percentage|score/.test(lower) ? 'number' : 'text'
    add({
      key: `todo:${l.code.trim()}`,
      kind: 'todo',
      severity: 'block',
      title: input === 'month' ? 'Missing date' : input === 'number' ? 'Missing value' : 'Unfinished text',
      detail: `"${span}" will print on your resume.`,
      line: l.n,
      context: plainLine.slice(0, 200),
      actions: [
        { id: 'set', label: 'Save', needs_value: true, input, placeholder: input === 'month' ? 'e.g. May 2026' : input === 'number' ? 'e.g. 8.6' : 'Replacement text' },
        { id: 'omit', label: isBullet ? 'Remove this line' : 'Leave it out' },
      ],
    })
  }

  // 2. "Verify / insert" notes after bullets (% TODO …) — warn, with an edit option.
  for (const l of ls) {
    if (!l.comment || !/\\item\b/.test(l.code) || !/TODO|verify|insert|check/i.test(l.comment)) continue
    add({
      key: `note:${l.code.trim()}`,
      kind: 'bullet_note',
      severity: 'warn',
      title: 'Bullet marked for verification',
      detail: l.comment.replace(/^%\s*/, ''),
      line: l.n,
      context: latexToPlain(l.code).slice(0, 220),
      actions: [
        { id: 'verified', label: 'It’s accurate' },
        { id: 'edit', label: 'Replace bullet text', needs_value: true, input: 'text', placeholder: 'Corrected bullet (plain text)' },
        { id: 'remove', label: 'Remove bullet' },
      ],
    })
  }

  // 3. Claims you flagged as "only keep if true" in your own comments — block.
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i]
    if (!l.comment || l.code.trim()) continue
    if (!/only keep|if (it|that) is (not )?(actually )?true|delete that clause|only if true/i.test(l.comment)) continue
    const [a, b] = commentBlock(ls, i)
    const block = ls.slice(a, b + 1).map((x) => x.text.replace(/^\s*%\s?/, '')).join(' ')
    const quoted = /"([^"]{6,120})"/.exec(block)?.[1]
    if (!quoted) continue
    const needle = escapeLatex(quoted)
    const where = ls.find((x) => x.n >= bodyFrom && (x.code.includes(needle) || latexToPlain(x.code).includes(quoted)))
    if (!where) continue
    add({
      key: `claim:${quoted}`,
      kind: 'unverified_claim',
      severity: 'block',
      title: 'Confirm this claim is true',
      detail: `Your note says: keep "${quoted}" only if it's true.`,
      line: where.n,
      context: quoted,
      actions: [
        { id: 'confirm', label: 'I confirm this is true' },
        { id: 'remove', label: 'Remove it' },
      ],
    })
    i = b
  }

  // 4. Instruction comment blocks (TODO lists, "read before applying") — info, one-click remove.
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i]
    if (!l.comment || l.code.trim()) continue
    if (!/TODO|BEFORE SENDING|READ BEFORE|IMPORTANT NOTE/i.test(l.comment)) continue
    const [a, b] = commentBlock(ls, i)
    const text = ls.slice(a, b + 1).map((x) => x.text).join('\n')
    if (/only keep|delete that clause|only if true/i.test(text) && issues.some((x) => x.kind === 'unverified_claim')) {
      i = b
      continue
    }
    add({
      key: `notes:${text}`,
      kind: 'instruction_comments',
      severity: 'info',
      title: 'Leftover instruction comments',
      detail: `${b - a + 1} comment lines of notes. They don't print, but they're noise in every tailored copy.`,
      line: a + 1,
      context: ls[a].text.replace(/^\s*%\s?/, '').slice(0, 120),
      actions: [{ id: 'remove', label: 'Remove these comments' }, { id: 'dismiss', label: 'Keep' }],
    })
    i = b
  }

  // 5. GitHub links owned by someone else on projects labelled "Individual".
  const myOwner =
    githubOwner(profile.github || '') ||
    githubOwner(/\\href\{(https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9-]+)\/?\}/.exec(src)?.[1] ?? '')
  if (myOwner) {
    for (const l of ls) {
      if (l.n < bodyFrom) continue
      const re = /\\href\{(https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9-]+)\/[^}]+)\}/g
      let m: RegExpExecArray | null
      while ((m = re.exec(l.code))) {
        if (m[2].toLowerCase() === myOwner) continue
        const individual = /individual|solo|personal/i.test(l.code)
        add({
          key: `link:${m[1]}`,
          kind: 'link_owner',
          severity: 'warn',
          title: individual ? 'Project marked “Individual” links to another account' : 'Project links to another GitHub account',
          detail: `${m[1]} belongs to “${m[2]}”, not “${myOwner}”. Recruiters do click these.`,
          line: l.n,
          context: latexToPlain(l.code).slice(0, 160),
          actions: [
            ...(individual ? [{ id: 'team', label: 'It was a team project' }] : []),
            { id: 'relink', label: 'Use a different link', needs_value: true, input: 'url' as const, placeholder: `https://github.com/${myOwner}/…` },
            { id: 'dismiss', label: 'It’s correct' },
          ],
        })
      }
    }
  }

  // 6. Header completeness vs profile.
  const header = src.slice(src.indexOf('\\begin{document}'), src.search(/\\section\*?\s*\{/))
  const headerPlain = latexToPlain(header).toLowerCase()
  const city = (profile.current_location || '').split(',')[0].trim()
  // A location counts only on a contact line (phone/email/links) or as a
  // standalone "City, Country" line — a college's city isn't your location.
  // Table headers put several things on one row ("College, City & linkedin"), so look per cell.
  const contactLines = header
    .split('\n')
    .flatMap((t) => t.split(/(?<!\\)&/))
    .filter((t) => /\\phone|Ph:|@|mailto|linkedin|github|\+\d{2}/i.test(t))
    .map((t) => latexToPlain(t).toLowerCase())
  const LOC = /(chennai|bengaluru|bangalore|hyderabad|mumbai|pune|delhi|noida|gurgaon|gurugram|kolkata|india|remote|usa|united states|london|singapore)/i
  const hasLocation =
    contactLines.some((t) => LOC.test(t) || (city && t.includes(city.toLowerCase()))) ||
    headerPlain.split('\n').some((t) => /^\s*[a-z .]+,\s*[a-z .]+\s*$/i.test(t) && LOC.test(t) && t.length < 40)
  if (header && !hasLocation) {
    add({
      key: 'header:city',
      kind: 'header_city',
      severity: 'warn',
      title: 'No location in the header',
      detail: city
        ? `Many ATS filter by location. Add “${profile.current_location}” from your Profile.`
        : 'Many ATS filter by location. Set Profile → Current location first, then add it here.',
      line: null,
      context: '',
      actions: city ? [{ id: 'add_city', label: `Add “${profile.current_location}”` }, { id: 'dismiss', label: 'Leave out' }] : [{ id: 'dismiss', label: 'Leave out' }],
    })
  }
  const email = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(header || src)?.[0]
  if (profile.email && email && email.toLowerCase() !== profile.email.toLowerCase()) {
    add({
      key: `email:${email}:${profile.email}`,
      kind: 'email_mismatch',
      severity: 'warn',
      title: 'Email differs from your Profile',
      detail: `Resume: ${email} · Profile: ${profile.email}. Recruiters reply to the resume address.`,
      line: null,
      context: email,
      actions: [{ id: 'use_profile', label: 'Use Profile email' }, { id: 'dismiss', label: 'Keep resume email' }],
    })
  }

  // 7. ATS text extraction: glyphtounicode.
  if (!/\\pdfgentounicode\s*=\s*1/.test(src)) {
    add({
      key: 'glyphtounicode',
      kind: 'ats_unicode',
      severity: 'warn',
      title: 'Ligatures may break ATS text extraction',
      detail: 'Without \\pdfgentounicode=1, parsers can read “certified” as “certi ed”.',
      line: null,
      context: '',
      actions: [{ id: 'fix', label: 'Add the two preamble lines' }],
    })
  }

  // 8. Layout: forced page breaks, empty links.
  for (const l of ls) {
    if (l.n < bodyFrom) continue
    if (/^\s*\\(newpage|clearpage|pagebreak)\b/.test(l.code)) {
      add({
        key: `newpage:${l.n}:${l.code.trim()}`,
        kind: 'forced_break',
        severity: 'info',
        title: 'Forced page break',
        detail: 'Tailored versions remove it automatically so the fit-to-page step decides the length.',
        line: l.n,
        context: l.code.trim(),
        actions: [{ id: 'remove', label: 'Remove from base too' }, { id: 'dismiss', label: 'Keep in base' }],
      })
    }
    const empty = /\\href\{[^}]*\}\{\s*(\\textcolor\{[^}]*\}\{\s*\}|)\s*\}/.exec(l.code)
    if (empty) {
      add({
        key: `emptylink:${l.code.trim()}`,
        kind: 'empty_link',
        severity: 'info',
        title: 'Invisible link',
        detail: 'A link with no visible text: readers and ATS can’t see it.',
        line: l.n,
        context: latexToPlain(l.code).slice(0, 120),
        actions: [{ id: 'label', label: 'Show it as “Certificate”' }, { id: 'remove', label: 'Remove it' }],
      })
    }
  }

  // 9. Structure sanity: nothing parsed as experience/projects means tailoring can't work.
  const doc = parseResume(src)
  if (!doc.sections.some((s) => s.entries?.length)) {
    add({
      key: 'structure',
      kind: 'structure',
      severity: 'warn',
      title: 'No experience or project entries recognised',
      detail: 'Tailoring needs \\resumeSubheading / \\resumeProject entries with \\item bullets. Compiling and editing still work.',
      line: null,
      context: '',
      actions: [{ id: 'dismiss', label: 'OK' }],
    })
  }

  const order = { block: 0, warn: 1, info: 2 }
  return issues.sort((a, b) => order[a.severity] - order[b.severity] || (a.line ?? 0) - (b.line ?? 0))
}

export class LintFixError extends Error {}

/**
 * Apply one action to the source. 'dismiss' is handled by the caller (stored
 * on the base row), everything else rewrites the LaTeX.
 */
export function resolveIssue(
  src: string,
  issue: ResumeIssue,
  action: string,
  value: string,
  profile: Partial<Profile> = {},
): string {
  const ls = src.split('\n')
  const at = issue.line ? issue.line - 1 : -1
  const need = () => {
    if (!value.trim()) throw new LintFixError('Enter a value first.')
    return value.trim()
  }
  switch (issue.kind) {
    case 'todo': {
      const l = ls[at]
      if (action === 'set') {
        ls[at] = l.replace(TODO_SPAN, escapeLatex(need()))
        return ls.join('\n')
      }
      if (action === 'omit') {
        if (/\\item\b/.test(l)) ls.splice(at, 1)
        else ls[at] = l.replace(/\s*(--|-|–|:)?\s*TODO\b[^{}\n%]*/, '')
        return ls.join('\n')
      }
      break
    }
    case 'bullet_note': {
      const l = ls[at]
      const c = commentStart(l)
      const code = c >= 0 ? l.slice(0, c).replace(/\s+$/, '') : l
      if (action === 'verified') {
        ls[at] = code
        return ls.join('\n')
      }
      if (action === 'edit') {
        const indent = /^\s*/.exec(code)![0]
        const braced = /\\item\s*\{/.test(code)
        const text = escapeLatex(need())
        ls[at] = `${indent}\\item ${braced ? `{${text}}` : text}`
        return ls.join('\n')
      }
      if (action === 'remove') {
        ls.splice(at, 1)
        return ls.join('\n')
      }
      break
    }
    case 'unverified_claim': {
      const quoted = issue.context
      const needle = escapeLatex(quoted)
      // Drop the note block that asked for confirmation either way.
      const noteIdx = ls.findIndex((t) => t.trim().startsWith('%') && t.includes(quoted.slice(0, 20)))
      let out = ls
      if (noteIdx >= 0) {
        let a = noteIdx
        let b = noteIdx
        while (a > 0 && out[a - 1].trim().startsWith('%')) a--
        while (b < out.length - 1 && out[b + 1].trim().startsWith('%')) b++
        out = [...out.slice(0, a), ...out.slice(b + 1)]
      }
      let text = out.join('\n')
      if (action === 'remove') {
        // Remove the phrase plus the separator that joined it ("; " or ", ").
        const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const before = text
        text = text.replace(new RegExp(`\\s*[;,]\\s*${esc}`), '').replace(new RegExp(`${esc}\\s*[;,]\\s*`), '')
        if (text === before) text = text.replace(needle, '')
      }
      if (action === 'confirm' || action === 'remove') return text
      break
    }
    case 'instruction_comments': {
      if (action === 'remove') {
        let a = at
        let b = at
        while (a > 0 && ls[a - 1].trim().startsWith('%')) a--
        while (b < ls.length - 1 && ls[b + 1].trim().startsWith('%')) b++
        ls.splice(a, b - a + 1)
        return ls.join('\n')
      }
      break
    }
    case 'link_owner': {
      const l = ls[at]
      if (action === 'team') {
        ls[at] = l.replace(/\bIndividual\b/, 'Team').replace(/\bSolo\b/, 'Team')
        return ls.join('\n')
      }
      if (action === 'relink') {
        const url = need()
        if (!/^https?:\/\/\S+$/.test(url)) throw new LintFixError('Enter a full URL starting with https://')
        ls[at] = l.replace(/\\href\{https?:\/\/(?:www\.)?github\.com\/[^}]+\}/, `\\href{${url}}`)
        return ls.join('\n')
      }
      break
    }
    case 'header_city': {
      if (action === 'add_city' && profile.current_location) {
        const city = escapeLatex(profile.current_location)
        // Put it after the phone, where most headers keep contact details.
        const idx = ls.findIndex((t) => /\\phone\b|Ph:|\+\d{2}/.test(t) && /\\\\\s*$/.test(t))
        if (idx >= 0) {
          ls[idx] = ls[idx].replace(/\s*\\\\\s*$/, ` $\\vert$ ${city}\\\\`)
          return ls.join('\n')
        }
        throw new LintFixError('Couldn’t find the phone line in the header — add the city in the editor.')
      }
      break
    }
    case 'email_mismatch': {
      if (action === 'use_profile' && profile.email) return src.split(issue.context).join(profile.email)
      break
    }
    case 'ats_unicode': {
      if (action === 'fix') {
        const i = src.indexOf('\\begin{document}')
        if (i < 0) throw new LintFixError('No \\begin{document} found.')
        return `${src.slice(0, i)}\\input{glyphtounicode}\n\\pdfgentounicode=1\n\n${src.slice(i)}`
      }
      break
    }
    case 'forced_break': {
      if (action === 'remove') {
        ls.splice(at, 1)
        return ls.join('\n')
      }
      break
    }
    case 'empty_link': {
      const l = ls[at]
      const i = l.indexOf('\\href')
      const a = i >= 0 ? readArgs(l, i + 5, 2) : null
      if (!a) break
      if (action === 'label') {
        ls[at] = `${l.slice(0, i)}\\href{${a.args[0]}}{\\textcolor{blue}{Certificate}}${l.slice(a.end)}`
        return ls.join('\n')
      }
      if (action === 'remove') {
        ls[at] = (l.slice(0, i).replace(/\s+$/, '') + l.slice(a.end)).replace(/\s+\}/, '}')
        return ls.join('\n')
      }
      break
    }
  }
  throw new LintFixError(`Action "${action}" doesn't apply to this issue.`)
}

/** True when nothing blocking remains: used to gate Generate and Submit. */
export const hasBlockingIssues = (issues: ResumeIssue[]): boolean => issues.some((i) => i.severity === 'block')
