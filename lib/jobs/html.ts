/**
 * Job-description HTML handling: entity decoding, an allowlist sanitizer (so a
 * stored description can be rendered safely), plain-text extraction, and
 * "main content" extraction for generic career pages.
 */
import { HTMLElement, NodeType, parse } from 'node-html-parser'
import type { Node } from 'node-html-parser'

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', bull: '•', middot: '·',
  copy: '©', reg: '®', trade: '™', eacute: 'é',
}

export function decodeEntities(s: string): string {
  return (s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1))
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    return NAMED[e.toLowerCase()] ?? m
  })
}

const ALLOWED = new Set([
  'p', 'br', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'a', 'span', 'div', 'section', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
])
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'svg', 'noscript', 'template', 'img', 'video', 'audio', 'link', 'meta'])

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function cleanNode(node: Node): string {
  if (node.nodeType === NodeType.TEXT_NODE) return escapeHtml(decodeEntities(node.rawText))
  if (node.nodeType !== NodeType.ELEMENT_NODE) return ''
  const el = node as HTMLElement
  const tag = (el.rawTagName || '').toLowerCase()
  if (DROP.has(tag)) return ''
  const inner = el.childNodes.map(cleanNode).join('')
  if (!ALLOWED.has(tag)) return inner
  if (tag === 'br') return '<br>'
  if (tag === 'a') {
    const href = el.getAttribute('href') || ''
    return /^https?:\/\//i.test(href)
      ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${inner}</a>`
      : inner
  }
  return `<${tag}>${inner}</${tag}>`
}

/** Allowlist sanitizer: known formatting tags only, no attributes except safe link hrefs. */
export function sanitizeHtml(html: string): string {
  if (!html) return ''
  // Some APIs (Greenhouse) return entity-escaped HTML.
  const src = /&lt;\/?[a-z]/i.test(html) && !/<[a-z]/i.test(html) ? decodeEntities(html) : html
  return parse(src).childNodes.map(cleanNode).join('').replace(/(<br>\s*){3,}/g, '<br><br>').trim()
}

const BLOCK = new Set(['p', 'div', 'section', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'br', 'ul', 'ol', 'blockquote', 'article', 'main', 'header', 'footer'])

function textOf(node: Node, out: string[]): void {
  if (node.nodeType === NodeType.TEXT_NODE) {
    out.push(decodeEntities(node.rawText).replace(/\s+/g, ' '))
    return
  }
  if (node.nodeType !== NodeType.ELEMENT_NODE) return
  const el = node as HTMLElement
  const tag = (el.rawTagName || '').toLowerCase()
  if (DROP.has(tag)) return
  if (tag === 'li') out.push('\n• ')
  else if (BLOCK.has(tag)) out.push('\n')
  for (const c of el.childNodes) textOf(c, out)
  if (BLOCK.has(tag)) out.push('\n')
}

/** Readable plain text with line breaks at block boundaries. */
export function htmlToText(html: string): string {
  if (!html) return ''
  const src = /&lt;\/?[a-z]/i.test(html) && !/<[a-z]/i.test(html) ? decodeEntities(html) : html
  const out: string[] = []
  for (const n of parse(src).childNodes) textOf(n, out)
  return out
    .join('')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l, i, arr) => l || (arr[i - 1] ?? '') !== '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Best-effort "main content" of a job page: prefer <main>/<article> or known
 * description containers, else the element with the most paragraph text.
 */
export function extractMainContent(html: string): { html: string; text: string } {
  const root = parse(html)
  for (const sel of ['script', 'style', 'nav', 'header', 'footer', 'noscript', 'svg', 'form']) {
    for (const el of root.querySelectorAll(sel)) el.remove()
  }
  const preferred = [
    '[class*="job-description"]', '[class*="jobDescription"]', '[class*="description"]',
    '[data-automation-id="jobPostingDescription"]', '[itemprop="description"]', 'article', 'main',
  ]
  for (const sel of preferred) {
    const el = root.querySelector(sel)
    if (el && el.text.trim().length > 300) {
      return { html: sanitizeHtml(el.innerHTML), text: htmlToText(el.innerHTML) }
    }
  }
  let best: HTMLElement | null = null
  let bestLen = 0
  for (const el of root.querySelectorAll('div, section')) {
    const pText = el.querySelectorAll('p, li').reduce((n, p) => n + p.text.length, 0)
    // Prefer the tightest container holding most of the prose.
    const score = pText - el.text.length * 0.15
    if (score > bestLen) {
      best = el
      bestLen = score
    }
  }
  if (!best) return { html: '', text: htmlToText(root.innerHTML).slice(0, 20000) }
  return { html: sanitizeHtml(best.innerHTML), text: htmlToText(best.innerHTML) }
}

/** schema.org JobPosting JSON-LD, which many custom career sites embed. */
export function extractJsonLdJob(html: string): {
  title?: string
  description?: string
  datePosted?: string
  location?: string
} | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    try {
      const raw = m[1].trim()
      let data: unknown
      try {
        data = JSON.parse(raw)
      } catch {
        // Many career sites emit raw newlines/tabs inside JSON strings (invalid
        // JSON that browsers tolerate). Flatten control characters and retry.
        data = JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' '))
      }
      const items = Array.isArray(data) ? data : [data, ...(((data as { '@graph'?: unknown[] })['@graph']) ?? [])]
      for (const it of items) {
        const o = it as Record<string, unknown>
        if (o && o['@type'] === 'JobPosting') {
          const loc = o.jobLocation as Record<string, unknown> | undefined
          const addr = (Array.isArray(loc) ? loc[0] : loc)?.address as Record<string, string> | undefined
          return {
            title: typeof o.title === 'string' ? o.title : undefined,
            description: typeof o.description === 'string' ? o.description : undefined,
            datePosted: typeof o.datePosted === 'string' ? o.datePosted : undefined,
            location: addr ? [addr.addressLocality, addr.addressCountry].filter(Boolean).join(', ') : undefined,
          }
        }
      }
    } catch {
      /* malformed block */
    }
  }
  return null
}
