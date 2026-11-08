/**
 * Low-level LaTeX helpers: escaping text for insertion, converting LaTeX
 * source to plain text, comment handling and brace-balanced argument parsing.
 */

/**
 * Escape plain text so it renders literally. AI-written text always passes
 * through this, so it can never inject commands into the document.
 */
export function escapeLatex(text: string): string {
  return (text || '')
    .replace(/\\/g, '\u0000')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/\u0000/g, '\\textbackslash{}')
    .replace(/[‘’]/g, "'")
    .replace(/[“]/g, '``')
    .replace(/[”]/g, "''")
    .replace(/—/g, '---')
    .replace(/–/g, '--')
    .replace(/…/g, '\\ldots{}')
    .replace(/→/g, '$\\rightarrow$')
    .replace(/≥/g, '$\\geq$')
    .replace(/≤/g, '$\\leq$')
    .replace(/ /g, '~')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, (ch) => ACCENTS[ch] ?? '')
}

const ACCENTS: Record<string, string> = {
  'é': "\\'e", 'è': '\\`e', 'á': "\\'a", 'à': '\\`a', 'í': "\\'i", 'ó': "\\'o", 'ú': "\\'u",
  'ñ': '\\~n', 'ü': '\\"u', 'ö': '\\"o', 'ä': '\\"a', 'ç': '\\c{c}', '•': '$\\bullet$',
  '×': '$\\times$', '°': '$^\\circ$', '±': '$\\pm$', '€': 'EUR', '₹': 'INR ',
}

/** Index of an unescaped % starting a comment on this line, or -1. */
export function commentStart(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '%') {
      let bs = 0
      for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) bs++
      if (bs % 2 === 0) return i
    }
  }
  return -1
}

/** Drop comments (keeps line structure). */
export function stripComments(src: string): string {
  return src
    .split('\n')
    .map((l) => {
      const c = commentStart(l)
      return c >= 0 ? l.slice(0, c) : l
    })
    .join('\n')
}

/** Read a brace group starting at src[pos] === '{'. Returns [inner, endIndexExclusive]. */
export function readGroup(src: string, pos: number): [string, number] | null {
  if (src[pos] !== '{') return null
  let depth = 0
  for (let i = pos; i < src.length; i++) {
    const ch = src[i]
    if (ch === '\\') {
      i++
      continue
    }
    if (ch === '%') {
      // Skip to end of line: braces in comments don't count.
      const nl = src.indexOf('\n', i)
      if (nl < 0) return null
      i = nl
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return [src.slice(pos + 1, i), i + 1]
    }
  }
  return null
}

/** Read n consecutive {arg} groups (whitespace/newlines allowed between). */
export function readArgs(src: string, pos: number, n: number): { args: string[]; end: number } | null {
  const args: string[] = []
  let i = pos
  for (let k = 0; k < n; k++) {
    while (i < src.length && /\s/.test(src[i])) i++
    const g = readGroup(src, i)
    if (!g) return null
    args.push(g[0])
    i = g[1]
  }
  return { args, end: i }
}

/** Convert LaTeX source to readable plain text (for facts, guards, ATS checks). */
export function latexToPlain(src: string): string {
  let s = stripComments(src || '')
  // \href{url}{text} → text (or nothing when text is empty / just a colour wrapper)
  for (let guard = 0; guard < 50 && s.includes('\\href'); guard++) {
    const i = s.indexOf('\\href')
    const a = readArgs(s, i + 5, 2)
    if (!a) break
    s = s.slice(0, i) + a.args[1] + s.slice(a.end)
  }
  s = s
    .replace(/\$\\vert\$|\\textbar\{\}|\\textbar\b/g, '|')
    .replace(/\$\\bullet\$/g, '•')
    .replace(/\$\\rightarrow\$/g, '→')
    .replace(/\$\\(geq|ge)\$/g, '≥')
    .replace(/\$\\(leq|le)\$/g, '≤')
    .replace(/\\textbackslash\{\}/g, '\\')
    .replace(/\\textasciitilde\{\}/g, '~')
    .replace(/\\textasciicircum\{\}/g, '^')
    .replace(/\\ldots\{\}|\\ldots\b|\\dots\b/g, '…')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/``|''/g, '"')
    .replace(/\\([&%$#_{}])/g, '$1')
    .replace(/\\(?:textbf|textit|emph|underline|texttt|textsc|small|footnotesize|large|Large|LARGE|normalsize|textcolor\{[^}]*\}|color\{[^}]*\})\s*/g, '')
    .replace(/\\(?:vspace|hspace)\*?\{[^}]*\}/g, ' ')
    .replace(/\\(?:justifying|centering|raggedright|newline|linebreak|par|item)\b/g, ' ')
    .replace(/\\\\/g, ' ')
    .replace(/\\[a-zA-Z]+\*?/g, '')
    .replace(/[{}]/g, '')
    .replace(/~/g, ' ')
    .replace(/\$/g, '')
    .replace(/[ \t]+/g, ' ')
  return s.replace(/\s*\n\s*/g, '\n').trim()
}

/** Line number (1-based) of a character offset. */
export function lineOf(src: string, offset: number): number {
  let n = 1
  for (let i = 0; i < offset && i < src.length; i++) if (src[i] === '\n') n++
  return n
}
