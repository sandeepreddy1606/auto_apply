/**
 * One standard shape for every prompt the app sends to Claude.
 *
 *   system:  <role> <goal> <rules> <method> <quality_bar> <output>
 *   user:    labelled data blocks (<job>, <candidate>, …), untrusted text last,
 *            then <task> restating exactly what to return.
 *
 * Why: the model sees the same structure every time (what it is, what "good"
 * looks like, the steps, the checks), data is clearly separated from
 * instructions, and job descriptions are fenced as untrusted input so text
 * inside them can't steer the model. PROMPT_VERSION goes into the call log so
 * results can be compared across prompt changes.
 */

export const PROMPT_VERSION = '2026-11-09.1'

export interface SystemPromptSpec {
  role: string
  goal: string
  rules: string[]
  method: string[]
  qualityBar: string[]
  output: string
}

const list = (items: string[], numbered: boolean): string =>
  items.map((x, i) => (numbered ? `${i + 1}. ${x}` : `- ${x}`)).join('\n')

export function systemPrompt(s: SystemPromptSpec): string {
  return [
    `<role>\n${s.role}\n</role>`,
    `<goal>\n${s.goal}\n</goal>`,
    `<rules>\nHard rules. Code checks every one of them and rejects output that breaks them, so following them is what keeps your work.\n${list(s.rules, true)}\n</rules>`,
    `<method>\nWork through these steps in order before writing the output.\n${list(s.method, true)}\n</method>`,
    `<quality_bar>\nBefore answering, check your output against each item:\n${list(s.qualityBar, false)}\n</quality_bar>`,
    `<output>\n${s.output}\n</output>`,
    `<prompt_version>${PROMPT_VERSION}</prompt_version>`,
  ].join('\n\n')
}

export type Block = [tag: string, body: string | null | undefined | false, attrs?: Record<string, string>]

/** Labelled data blocks; empty ones are left out. Untrusted text belongs in a block marked untrusted. */
export function userPrompt(blocks: Block[], task: string): string {
  const parts = blocks
    .filter(([, body]) => typeof body === 'string' && body.trim() !== '')
    .map(([tag, body, attrs]) => {
      const a = attrs ? ' ' + Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ') : ''
      return `<${tag}${a}>\n${String(body).trim()}\n</${tag}>`
    })
  return [...parts, `<task>\n${task.trim()}\n</task>`].join('\n\n')
}

/** "key: value" lines, skipping empty values — compact and easy for the model to read. */
export function kv(rows: [string, string | number | null | undefined | false][]): string {
  return rows
    .filter(([, v]) => v !== null && v !== undefined && v !== false && String(v).trim() !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

/** Neutralise anything in untrusted text that looks like our own tags. */
export function fence(text: string, max: number): string {
  return (text || '').slice(0, max).replace(/<\/?(job_description|task|rules|role|method|output|candidate_facts)\b[^>]*>/gi, '[tag removed]')
}
