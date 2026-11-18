import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoapply-files-'))
process.env.AUTO_APPLY_DATA_DIR = tmpDir
delete process.env.DATABASE_URL

const files = await import('../lib/apply/gform-files.ts')
import type { Application, GoogleForm, GoogleFormField } from '../lib/types.ts'

const up = (entry_id: number, title: string, required = true): GoogleFormField => ({
  item_id: entry_id, entry_id, title, description: '', type_code: 13, type: 'file_upload', required, options: [], supported: false,
})
const form = (fields: GoogleFormField[]): GoogleForm => ({ title: 'T', description: '', url: 'u', submit_url: 's', fbzx: null, collects_email: false, page_count: 1, fields })
const app = (id: number, form_files: Application['form_files'] = null) => ({ id, job_title: 'Engineer', raw_text: '', form_files } as unknown as Application)

describe('Google Form upload questions', () => {
  test('a photo question never gets your resume; it needs your file', () => {
    const f = form([up(1, 'Upload your resume'), up(2, 'Passport size photo')])
    const plan = files.planUploads(app(1), f)
    const photo = plan.picks.find((p) => p.key === 'entry.2')!
    assert.equal(photo.path, null)
    assert.ok(plan.missing.some((m) => m.title === 'Passport size photo'))
  })

  test('a file uploaded on the post goes into the question you chose it for', () => {
    const name = files.saveUpload(7, 'my photo (1).jpg', Buffer.from('jpg'))
    assert.equal(name, 'my photo (1).jpg')
    const f = form([up(2, 'Passport size photo')])
    const plan = files.planUploads(app(7, { 'entry.2': { kind: 'file', name } }), f)
    assert.equal(plan.missing.length, 0)
    assert.ok(plan.picks[0].path?.endsWith(name))
    assert.equal(plan.picks[0].how, 'chosen')
  })

  test('“don’t attach” on an optional question is respected', () => {
    const f = form([up(3, 'Cover letter (optional)', false)])
    const plan = files.planUploads(app(8, { 'entry.3': { kind: 'skip' } }), f)
    assert.equal(plan.picks[0].path, null)
    assert.equal(plan.missing.length, 0)
  })

  test('file names are made safe', () => {
    assert.equal(files.safeName('../../etc/passwd'), 'passwd')
    assert.equal(files.safeName('a<b>c?.pdf'), 'a_b_c_.pdf')
    assert.throws(() => files.saveUpload(9, 'big.pdf', Buffer.alloc(files.MAX_UPLOAD_BYTES + 1)))
  })
})
