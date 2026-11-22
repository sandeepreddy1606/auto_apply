/**
 * Golden-output regression tests for the Python -> TypeScript migration.
 *
 * The fixtures in tests/fixtures/golden/ were produced by the ORIGINAL Python
 * implementation (backend/app/*.py) and verified byte-identical against this
 * TypeScript port before the Python was removed. They pin the exact behaviour
 * of the regex-heavy job-title matching the career-page scanner uses, which
 * is where Python and JavaScript semantics diverge most easily.
 *
 * A diff here means behaviour drifted from the system this replaced. Update a
 * golden only when the change is intentional.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'

const root = path.resolve(import.meta.dirname, '..')

// Node < 22.18 needs the flag to run .ts files directly; newer versions accept it too.
const TS_FLAGS = ['--experimental-strip-types', '--no-warnings']

const golden = (name: string): string =>
  // Normalize CRLF: Windows checkouts with core.autocrlf rewrite the snapshot files.
  fs.readFileSync(path.join(root, 'tests/fixtures/golden', name), 'utf-8').replace(/\r\n/g, '\n')

const dump = (script: string): string =>
  execFileSync(process.execPath, [...TS_FLAGS, script], {
    cwd: root,
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  })

describe('golden parity with the original Python implementation', () => {
  test('scanner: keyword building and job-title matching', () => {
    const actual = dump('tests/parity/logic_ts.ts')
    assert.equal(actual, golden('logic.json'), 'logic output drifted from the golden')

    // Guard against the fixtures degenerating into a trivial pass.
    const parsed = JSON.parse(actual) as { scanner: { titles: { matched: boolean }[] }[] }
    assert.ok(parsed.scanner.some((c) => c.titles.some((t) => t.matched)))
    assert.ok(parsed.scanner.some((c) => c.titles.some((t) => !t.matched)))
  })
})
