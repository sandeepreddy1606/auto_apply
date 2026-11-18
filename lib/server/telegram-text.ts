/**
 * The full text of a Telegram message, including the links Telegram hides:
 *
 *   - words linked to a URL ("Apply here" with the link behind it) become
 *     "Apply here (https://…)", in place, so the parser sees the URL on the
 *     same line as "Apply";
 *   - URL buttons under the post become "Label: https://…" lines.
 *
 * Pure (no Telegram library), so it is unit-tested directly.
 */

interface Entity {
  className?: string
  offset?: number
  length?: number
  url?: string
}

interface Button {
  className?: string
  text?: string
  url?: string
}

export interface TgMessageLike {
  message?: string
  entities?: Entity[] | null
  replyMarkup?: { rows?: { buttons?: Button[] }[] } | null
}

export function messageText(msg: TgMessageLike): string {
  let text = msg.message || ''
  // Offsets are UTF-16 code units, the same units JS strings use. Insert from
  // the end so earlier offsets stay valid.
  const linked = (msg.entities || [])
    .filter((e) => e.className === 'MessageEntityTextUrl' && e.url && typeof e.offset === 'number' && typeof e.length === 'number')
    .sort((a, b) => b.offset! - a.offset!)
  for (const e of linked) {
    const end = e.offset! + e.length!
    const shown = text.slice(e.offset!, end)
    if (shown.includes(e.url!)) continue // the URL is already visible
    text = `${text.slice(0, end)} (${e.url})${text.slice(end)}`
  }
  const buttons = (msg.replyMarkup?.rows || [])
    .flatMap((r) => r.buttons || [])
    .filter((b) => b.url && /^https?:\/\//i.test(b.url))
  if (buttons.length) {
    text = `${text.trimEnd()}\n${buttons.map((b) => `${(b.text || 'Link').trim()}: ${b.url}`).join('\n')}`
  }
  return text
}
