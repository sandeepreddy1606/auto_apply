import fs from 'node:fs'
import path from 'node:path'

import { json } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/** The build this server process started with — the page compares it to spot a stale tab. */
let build: string | null = null
function buildId(): string | null {
  if (build === null) {
    try {
      build = fs.readFileSync(path.join(process.cwd(), '.next', 'BUILD_ID'), 'utf-8').trim()
    } catch {
      build = 'dev'
    }
  }
  return build
}

export function GET() {
  return json({ ok: true, build: buildId() })
}
