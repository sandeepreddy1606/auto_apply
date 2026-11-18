/**
 * Form extraction and filling inside the page.
 *
 * `EXTRACT_SCRIPT` runs in the browser: it walks visible form controls,
 * resolves each one's human label (label[for], wrapping label, aria-labelledby,
 * aria-label, legend/fieldset, nearby text), tags it with data-aa-id, and
 * returns a serializable field list. Radio and checkbox groups become one field.
 */
import type { Locator, Page } from 'playwright'

import { frames } from './adapters'

import type { AnswerValue, FormField } from '@/lib/types'

export const EXTRACT_SCRIPT = `((prefix) => {
  const labelVisible = (el) => {
    const lab = (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) || el.closest('label')
    return !!(lab && lab.getBoundingClientRect().width > 0)
  }
  const visible = (el) => {
    if (!el || !(el instanceof Element)) return false
    const type = (el.getAttribute('type') || '').toLowerCase()
    // Resume uploads are often hidden behind a styled "Attach" button.
    if (type === 'file') {
      const fst = getComputedStyle(el)
      const fr = el.getBoundingClientRect()
      if (fst.display !== 'none' && fst.visibility !== 'hidden' && (fr.width > 0 || fr.height > 0)) return true
      const hint = [el.id, el.name, el.getAttribute('aria-label'), el.getAttribute('accept'), (el.closest('label, div, fieldset') || {}).innerText]
        .join(' ').slice(0, 400)
      return /resume|cv|curriculum|cover|attach|upload|pdf|document/i.test(hint)
    }
    const st = getComputedStyle(el)
    // Styled radios/checkboxes hide the real input behind a visible label.
    if (st.display === 'none' || st.visibility === 'hidden') return (type === 'radio' || type === 'checkbox') && labelVisible(el)
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return labelVisible(el)
    return true
  }
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').replace(/\\*+\\s*$/, '').trim()
  const textOf = (el) => clean(el ? el.innerText || el.textContent || '' : '')
  const labelFor = (el) => {
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]')
      if (l && textOf(l)) return textOf(l)
    }
    const wrap = el.closest('label')
    if (wrap && textOf(wrap)) return textOf(wrap)
    const lb = el.getAttribute('aria-labelledby')
    if (lb) {
      const t = lb.split(/\\s+/).map((id) => textOf(document.getElementById(id))).join(' ').trim()
      if (t) return t
    }
    if (el.getAttribute('aria-label')) return clean(el.getAttribute('aria-label'))
    const fs = el.closest('fieldset')
    if (fs && fs.querySelector('legend')) return textOf(fs.querySelector('legend'))
    // Walk up to a container that has text besides the control itself.
    let p = el.parentElement
    for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
      const lab = p.querySelector('label, legend, .label, [class*="label"], [class*="question"], h3, h4')
      if (lab && !lab.contains(el) && textOf(lab)) return textOf(lab)
    }
    return clean(el.getAttribute('placeholder') || el.name || '')
  }
  const requiredOf = (el, label) =>
    el.required || el.getAttribute('aria-required') === 'true' || /\\*\\s*$/.test(label) ||
    !!(el.closest('[class*="required"]')) || /\\(required\\)/i.test(label)
  const fields = []
  let n = 0
  const seenGroups = new Set()
  const ctrls = document.querySelectorAll('input, textarea, select, [role="combobox"]')
  for (const el of ctrls) {
    const tag = el.tagName.toLowerCase()
    const type = (el.getAttribute('type') || (tag === 'input' ? 'text' : tag)).toLowerCase()
    if (['hidden', 'submit', 'button', 'reset', 'image', 'search'].includes(type)) continue
    if (el.disabled || el.readOnly && type !== 'file') continue
    if (!visible(el)) continue
    if (el.closest('[aria-hidden="true"]')) continue
    if ((type === 'radio' || type === 'checkbox') && el.name) {
      const group = document.querySelectorAll('input[name="' + CSS.escape(el.name) + '"]')
      if (group.length > 1) {
        if (seenGroups.has(el.name)) continue
        seenGroups.add(el.name)
        const id = prefix + (++n)
        const opts = []
        group.forEach((g) => { g.setAttribute('data-aa-id', id); opts.push(labelFor(g) || g.value) })
        const fs = el.closest('fieldset')
        let q = fs && fs.querySelector('legend') ? textOf(fs.querySelector('legend')) : ''
        if (!q) {
          let p = el.parentElement
          for (let i = 0; i < 6 && p && !q; i++, p = p.parentElement) {
            const lab = p.querySelector('legend, .label, [class*="label"], [class*="question"], h3, h4, label:not([for])')
            if (lab && !Array.from(group).some((g) => lab.contains(g)) && textOf(lab)) q = textOf(lab)
          }
        }
        fields.push({ id, kind: type, input_type: type, label: q || el.name, name: el.name,
          required: Array.from(group).some((g) => g.required) || /\\*\\s*$/.test(q), options: opts,
          max_length: null, multiple: type === 'checkbox', step: 0 })
        continue
      }
    }
    const id = prefix + (++n)
    el.setAttribute('data-aa-id', id)
    const label = labelFor(el)
    let kind = 'text'
    let options = []
    if (tag === 'textarea') kind = 'textarea'
    else if (tag === 'select') { kind = 'select'; options = Array.from(el.options).map((o) => clean(o.textContent)).filter(Boolean) }
    else if (type === 'file') kind = 'file'
    else if (type === 'checkbox') kind = 'checkbox'
    else if (type === 'radio') kind = 'radio'
    else if (type === 'date') kind = 'date'
    else if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list') kind = 'combobox'
    if (kind === 'checkbox') options = [label]
    const ml = Number(el.getAttribute('maxlength'))
    fields.push({ id, kind, input_type: type, label, name: el.name || el.id || '', required: requiredOf(el, label), options,
      max_length: ml > 0 ? ml : null, multiple: !!el.multiple, step: 0 })
  }
  return fields
})`

export async function extractFields(page: Page, step: number): Promise<FormField[]> {
  // Ids are prefixed with the step (and frame) so fields never collide.
  const out: FormField[] = []
  const all = frames(page)
  for (let i = 0; i < all.length; i++) {
    const prefix = i === 0 ? `s${step}f` : `s${step}i${i}f`
    const raw = (await all[i].evaluate(`${EXTRACT_SCRIPT}(${JSON.stringify(prefix)})`).catch(() => [])) as FormField[]
    out.push(...raw.map((f) => ({ ...f, step, label: f.label.slice(0, 300) })))
  }
  return out
}

const sel = (id: string) => `[data-aa-id="${id}"]`

/** The field's controls, wherever they are (the page or an embedded form frame). */
async function locate(page: Page, id: string): Promise<Locator> {
  for (const f of frames(page)) {
    const loc = f.locator(sel(id))
    if (await loc.count().catch(() => 0)) return loc
  }
  return page.locator(sel(id))
}

/** Index of the option whose label matches: exact first, then "starts with". */
async function pickOption(loc: Locator, want: string): Promise<number> {
  const n = await loc.count()
  const labels: string[] = []
  for (let i = 0; i < n; i++) {
    labels.push(
      (await loc.nth(i).evaluate((el) => {
        const id = (el as HTMLInputElement).id
        const l = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : el.closest('label')
        return ((l as HTMLElement | null)?.innerText || (el as HTMLInputElement).value || '').trim()
      })).toLowerCase().replace(/\s+/g, ' '),
    )
  }
  const w = want.toLowerCase().replace(/\s+/g, ' ').trim()
  const exact = labels.indexOf(w)
  if (exact >= 0) return exact
  // "No" must not tick "Not applicable": a prefix only counts at a word boundary.
  return labels.findIndex((l) => l.startsWith(w) && !/[a-z0-9]/.test(l.charAt(w.length)))
}

/** Put one answer into the page. Returns true when the value is in place. */
export async function fillField(page: Page, field: FormField, value: AnswerValue, typingDelayMs: number): Promise<boolean> {
  if (value === null || value === '') return false
  const loc = await locate(page, field.id)
  switch (field.kind) {
    case 'file': {
      await loc.first().setInputFiles(String(value))
      return true
    }
    case 'select': {
      await loc.first().selectOption({ label: String(value) }).catch(async () => {
        await loc.first().selectOption(String(value))
      })
      return true
    }
    case 'radio': {
      const i = await pickOption(loc, String(value))
      if (i < 0) return false
      await loc.nth(i).check({ force: true })
      return true
    }
    case 'checkbox': {
      if (typeof value === 'boolean') {
        if (value) await loc.first().check({ force: true })
        else await loc.first().uncheck({ force: true })
        return true
      }
      const wanted = (Array.isArray(value) ? value : [String(value)]).map((v) => v.toLowerCase())
      const n = await loc.count()
      let any = false
      for (let i = 0; i < n; i++) {
        const c = loc.nth(i)
        const lab = (await c.evaluate((el) => {
          const id = (el as HTMLInputElement).id
          const l = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : el.closest('label')
          return ((l as HTMLElement | null)?.innerText || (el as HTMLInputElement).value || '').trim()
        })).toLowerCase()
        if (wanted.includes(lab)) {
          await c.check({ force: true })
          any = true
        }
      }
      return any
    }
    case 'combobox': {
      const el = loc.first()
      await el.click()
      await el.fill('')
      await el.pressSequentially(String(value), { delay: typingDelayMs })
      await page.waitForTimeout(700)
      await el.press('Enter')
      return true
    }
    default: {
      const el = loc.first()
      const v = String(value)
      await el.fill('')
      if (v.length <= 120 && typingDelayMs > 0) await el.pressSequentially(v, { delay: typingDelayMs })
      else await el.fill(v)
      // React-controlled inputs sometimes need a blur to commit.
      await el.blur().catch(() => {})
      return true
    }
  }
}

/** What the page currently holds for a field (read-back verification). */
export async function readField(page: Page, field: FormField): Promise<string> {
  const all = await locate(page, field.id)
  const loc = all.first()
  try {
    if (field.kind === 'select') return await loc.evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() ?? '')
    if (field.kind === 'file') return await loc.evaluate((el) => (el as HTMLInputElement).files?.[0]?.name ?? '')
    if (field.kind === 'radio' || field.kind === 'checkbox') {
      return await all.evaluateAll((els) =>
        (els as HTMLInputElement[]).filter((e) => e.checked).map((e) => e.value).join(', '),
      )
    }
    return await loc.inputValue()
  } catch {
    return ''
  }
}
