/** Dump the TypeScript parser's output for the shared fixtures, for parity diffing. */
import fs from 'node:fs'
import path from 'node:path'

import { parseMessage, splitOpenings, textHash } from '../../lib/server/parser.ts'

const root = path.resolve(import.meta.dirname, '../..')
const messages = JSON.parse(
  fs.readFileSync(path.join(root, 'tests/fixtures/messages.json'), 'utf-8'),
) as string[]

const out = messages.map((msg) => ({
  segments: splitOpenings(msg),
  hash: textHash(msg),
  parsed: parseMessage(msg),
}))

// Sort keys so the JSON matches Python's sort_keys=True output.
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
