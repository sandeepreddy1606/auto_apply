import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { acceptValue, missingReason, planWithoutAi } from '../lib/apply/gform-answers.ts'
import type { ApplyAnswers, GoogleForm, GoogleFormField } from '../lib/types.ts'

let n = 1
const q = (title: string, type_code: number, options: string[] = [], required = true): GoogleFormField => ({
  item_id: n,
  entry_id: n++,
  title,
  description: '',
  type_code,
  type: { 0: 'short_answer', 1: 'paragraph', 2: 'multiple_choice', 3: 'dropdown', 4: 'checkboxes', 9: 'date', 13: 'file_upload' }[type_code] ?? 'x',
  required,
  options,
  supported: type_code !== 13,
})
const form = (fields: GoogleFormField[]): GoogleForm => ({ title: 'T', description: '', url: 'https://docs.google.com/forms/d/e/x/viewform', submit_url: '', fbzx: null, collects_email: false, page_count: 1, fields })
const answers = { work_modes: ['Onsite', 'Remote'], always_ask: [] } as unknown as ApplyAnswers
const ctx = (extra: Partial<Parameters<typeof planWithoutAi>[1]> = {}) => ({
  profile: {
    full_name: 'Alex Morgan',
    email: 'alex@example.com',
    phone: '9000000000',
    college: 'Example Institute of Technology',
    degree: 'Bachelor of Technology, Computer Science and Engineering',
    current_location: 'Chennai',
  },
  answers,
  bank: [],
  mappings: [],
  atsType: 'gform',
  resumePdf: null,
  resumeFileName: '',
  declarations: false,
  ...extra,
})
const key = (f: GoogleFormField) => `entry.${f.entry_id}`

describe('Google Form answers', () => {
  test('a degree never picks "No" because "technology" contains "no"', () => {
    const graduated = q('Have you graduated from your most recent bachelor degree?', 4, ['Yes', 'No'])
    const pg = q('Are you currently pursuing or have you completed any postgraduate degree?', 2, ['Yes', 'No'])
    const plan = planWithoutAi(form([graduated, pg]), ctx(), {}, {})
    assert.equal(plan.answers[key(graduated)], undefined)
    assert.equal(plan.answers[key(pg)], undefined)
    assert.equal(plan.missing.length, 2, 'left for the AI / you, not guessed')
  })

  test('questions about a masters degree or other people never get your details', () => {
    const masters = q('College/Institute for Masters/PhD Degree', 0, [], false)
    const group = q('If you are applying as a group, please mention email and names of other people', 1, [], false)
    const twelfth = q('GPA or percentage in 12th Standard Board Exam (scaled to 100)', 0)
    const college = q('College/Institute', 0)
    const plan = planWithoutAi(form([masters, group, twelfth, college]), ctx(), {}, {})
    assert.equal(plan.answers[key(masters)], undefined)
    assert.equal(plan.answers[key(group)], undefined)
    assert.equal(plan.answers[key(twelfth)], undefined)
    assert.equal(plan.answers[key(college)], 'Example Institute of Technology')
    assert.equal(plan.meta[key(college)].source, 'profile')
  })

  test('your own answers win and stay yours; earlier AI answers are kept', () => {
    const branch = q('Branch', 2, ['CS', 'IT'])
    const name = q('Full Name', 0)
    const why = q('Why do you want to join?', 1, [], false)
    const plan = planWithoutAi(
      form([branch, name, why]),
      ctx(),
      { [key(branch)]: 'IT', [key(name)]: 'A. Morgan', [key(why)]: 'Because …' },
      { [key(branch)]: { source: 'you' }, [key(why)]: { source: 'ai', basis: 'fact' } },
    )
    assert.equal(plan.answers[key(branch)], 'IT')
    assert.equal(plan.meta[key(branch)].source, 'you')
    assert.equal(plan.answers[key(name)], 'Alex Morgan', 'a stored machine answer is recomputed, not trusted')
    assert.equal(plan.answers[key(why)], 'Because …')
  })

  test('onsite question answered from your work modes', () => {
    const onsite = q('Are you comfortable working from our Gurugram office (Onsite)?', 2, ['Yes', 'No'])
    const plan = planWithoutAi(form([onsite]), ctx(), {}, {})
    assert.equal(plan.answers[key(onsite)], 'Yes')
  })

  test('"How soon would you be available to join?" uses your notice period', () => {
    const soon = q('How soon would you be available to join us?', 2, ['Immediate', '15 Days', '30 Days'])
    const withNotice = ctx({ answers: { ...answers, notice_period: '30 days' } as ApplyAnswers })
    assert.equal(planWithoutAi(form([soon]), withNotice, {}, {}).answers[key(soon)], '30 Days')
  })

  test('declarations are ticked only when you allow it', () => {
    const decl = q('I confirm that the information I have provided is true and accurate', 4, ['I agree'])
    assert.equal(planWithoutAi(form([decl]), ctx(), {}, {}).answers[key(decl)], undefined)
    assert.deepEqual(planWithoutAi(form([decl]), ctx({ declarations: true }), {}, {}).answers[key(decl)], ['I agree'])
  })

  test('only values the form accepts', () => {
    const choice = q('Location Preference', 2, ['Pune - In Person', 'Remote'])
    assert.equal(acceptValue(choice, 'remote'), 'Remote')
    assert.equal(acceptValue(choice, 'Chennai'), null)
    const boxes = q('Position', 4, ['Machine Learning', 'Devops'])
    assert.deepEqual(acceptValue(boxes, ['Machine Learning', 'Nope']), ['Machine Learning'])
    const date = q('Start date', 9)
    assert.deepEqual(acceptValue(date, '2027-01-05'), { year: '2027', month: '1', day: '5' })
    assert.equal(acceptValue(date, 'soon'), null)
  })

  test('the reason names the questions', () => {
    assert.match(missingReason([{ title: 'Degree', type: 'x', supported: true }]), /1 question needs your answer: “Degree”/)
  })
})
