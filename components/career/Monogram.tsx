/**
 * A company's monogram: its initials on a tile dyed in one of six silk tones
 * (peacock, rani, mango, indigo, emerald, aubergine), picked from the name so
 * the same company always wears the same colour.
 */
export function initialsOf(name: string): string {
  const words = (name || '?').replace(/[^\p{L}\p{N} ]+/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase()
  return (words[0] || '?').slice(0, 2).replace(/^./, (c) => c.toUpperCase())
}

function toneOf(name: string): number {
  let h = 0
  for (const ch of (name || '').toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % 6
}

export default function Monogram({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`mono t${toneOf(name)} ${size}`} aria-hidden="true">
      {initialsOf(name)}
    </span>
  )
}
