'use client'

/**
 * The Jobs filter panel.
 *
 * Laptop: a row of filter buttons under the search; each opens a dropdown of
 * options with live counts (how many jobs you'd get). Phone: one "Filters"
 * button opens a sheet with every group. Active filters show as removable
 * chips. State lives in the URL so a filtered view can be bookmarked.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { Sliders, XIcon } from '@/components/Icons'
import type { JobFacets } from '@/lib/career-api'

export interface Filters {
  companies: number[]
  countries: string[]
  cities: string[]
  work: string[]
  types: string[]
  seniority: string[]
  education: string[]
  skills: string[]
  maxYears: number | null
  posted: number | null
  minScore: number | null
  onlyNew: boolean
  hideStarted: boolean
  salary: boolean
  described: boolean
}

export const EMPTY_FILTERS: Filters = {
  companies: [], countries: [], cities: [], work: [], types: [], seniority: [], education: [], skills: [],
  maxYears: null, posted: null, minScore: null, onlyNew: false, hideStarted: false, salary: false, described: false,
}

const WORK: Record<string, string> = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site', unspecified: 'Not stated' }
const TYPES: Record<string, string> = { 'full-time': 'Full-time', internship: 'Internship', contract: 'Contract', 'part-time': 'Part-time', temporary: 'Temporary', unspecified: 'Not stated' }
const SENIORITY: Record<string, string> = { intern: 'Intern', new_grad: 'New grad', junior: 'Junior', mid: 'Mid-level', senior: 'Senior', unspecified: 'Not stated' }
const EDUCATION: Record<string, string> = { diploma: 'Diploma', bachelors: 'Bachelor’s', masters: 'Master’s', phd: 'PhD', none: 'Not mentioned' }
const YEARS: [number, string][] = [[0, 'Entry level (0 years)'], [1, 'Up to 1 year'], [2, 'Up to 2 years'], [3, 'Up to 3 years'], [5, 'Up to 5 years']]
const POSTED: [number, string][] = [[1, 'Last 24 hours'], [3, 'Last 3 days'], [7, 'Last week'], [14, 'Last 2 weeks'], [30, 'Last month']]
const SCORES = [50, 60, 70, 80]
const SEN_ORDER = ['intern', 'new_grad', 'junior', 'mid', 'senior', 'unspecified']

/** Query-string parameters for /api/jobs and the page URL. */
export function filterParams(f: Filters): Record<string, string | number | undefined> {
  const j = (a: (string | number)[]) => (a.length ? a.map((x) => encodeURIComponent(String(x))).join(',') : undefined)
  return {
    companies: j(f.companies), countries: j(f.countries), cities: j(f.cities), work: j(f.work), types: j(f.types),
    seniority: j(f.seniority), education: j(f.education), skills: j(f.skills),
    max_years: f.maxYears ?? undefined, posted: f.posted ?? undefined, min_score: f.minScore ?? undefined,
    new: f.onlyNew ? 1 : undefined, hide_started: f.hideStarted ? 1 : undefined, salary: f.salary ? 1 : undefined, described: f.described ? 1 : undefined,
  }
}

export function filtersFromQuery(sp: URLSearchParams): Filters {
  const list = (k: string) => (sp.get(k) ? sp.get(k)!.split(',').map((x) => decodeURIComponent(x)).filter(Boolean) : [])
  const n = (k: string) => (sp.get(k) !== null && sp.get(k) !== '' && Number.isFinite(Number(sp.get(k))) ? Number(sp.get(k)) : null)
  const companies = list('companies').map(Number).filter((x) => x > 0)
  const legacy = n('company')
  return {
    companies: legacy && !companies.includes(legacy) ? [...companies, legacy] : companies,
    countries: list('countries'), cities: list('cities'), work: list('work'), types: list('types'), seniority: list('seniority'),
    education: list('education'), skills: list('skills'), maxYears: n('max_years'), posted: n('posted'), minScore: n('min_score'),
    onlyNew: sp.get('new') === '1', hideStarted: sp.get('hide_started') === '1', salary: sp.get('salary') === '1', described: sp.get('described') === '1',
  }
}

export function activeCount(f: Filters): number {
  return (
    f.companies.length + f.countries.length + f.cities.length + f.work.length + f.types.length + f.seniority.length +
    f.education.length + f.skills.length + (f.maxYears != null ? 1 : 0) + (f.posted ? 1 : 0) + (f.minScore ? 1 : 0) +
    (f.onlyNew ? 1 : 0) + (f.hideStarted ? 1 : 0) + (f.salary ? 1 : 0) + (f.described ? 1 : 0)
  )
}

const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

// ---------- option lists ----------

function Checks({ options, selected, onToggle, labels, search }: {
  options: { value: string; n: number }[]
  selected: string[]
  onToggle: (v: string) => void
  labels?: Record<string, string>
  search?: string
}) {
  // Keep picked options visible even when the other filters leave them at 0.
  const all = [...options, ...selected.filter((s) => !options.some((o) => o.value === s)).map((value) => ({ value, n: 0 }))]
  const shown = search ? all.filter((o) => (labels?.[o.value] ?? o.value).toLowerCase().includes(search.toLowerCase())) : all
  if (!shown.length) return <p className="fl-empty">Nothing to choose here for the current jobs.</p>
  return (
    <div className="fl-options">
      {shown.map((o) => (
        <label key={o.value} className={`fl-opt ${o.n === 0 && !selected.includes(o.value) ? 'zero' : ''}`}>
          <input type="checkbox" checked={selected.includes(o.value)} onChange={() => onToggle(o.value)} />
          <span className="fl-name">{labels?.[o.value] ?? o.value}</span>
          <span className="fl-n">{o.n}</span>
        </label>
      ))}
    </div>
  )
}

function Radios<T extends number>({ options, value, onChange, anyLabel, counts }: {
  options: [T, string][]
  value: T | null
  onChange: (v: T | null) => void
  anyLabel: string
  counts?: Map<number, number>
}) {
  return (
    <div className="fl-options">
      <label className="fl-opt">
        <input type="radio" checked={value == null} onChange={() => onChange(null)} />
        <span className="fl-name">{anyLabel}</span>
      </label>
      {options.map(([v, label]) => (
        <label key={v} className="fl-opt">
          <input type="radio" checked={value === v} onChange={() => onChange(v)} />
          <span className="fl-name">{label}</span>
          {counts && <span className="fl-n">{counts.get(v) ?? 0}</span>}
        </label>
      ))}
    </div>
  )
}

function Searchable({ placeholder, children }: { placeholder: string; children: (q: string) => ReactNode }) {
  const [q, setQ] = useState('')
  return (
    <>
      <input className="fl-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {children(q)}
    </>
  )
}

// ---------- groups (shared by the dropdowns and the phone sheet) ----------

interface GroupProps { f: Filters; set: (patch: Partial<Filters>) => void; facets: JobFacets | null }

const GROUPS: { key: string; label: string; count: (f: Filters) => number; body: (p: GroupProps) => ReactNode }[] = [
  {
    key: 'company', label: 'Company', count: (f) => f.companies.length,
    body: ({ f, set, facets }) => (
      <Checks
        options={(facets?.companies ?? []).map((c) => ({ value: String(c.id), n: c.n }))}
        labels={Object.fromEntries((facets?.companies ?? []).map((c) => [String(c.id), c.name]))}
        selected={f.companies.map(String)}
        onToggle={(v) => set({ companies: toggle(f.companies, Number(v)) })}
      />
    ),
  },
  {
    key: 'location', label: 'Location', count: (f) => f.countries.length + f.cities.length,
    body: ({ f, set, facets }) => (
      <Searchable placeholder="Find a city or country">
        {(q) => (
          <>
            <div className="fl-sub">Country</div>
            <Checks options={facets?.countries ?? []} selected={f.countries} onToggle={(v) => set({ countries: toggle(f.countries, v) })} labels={{ unspecified: 'Not stated' }} search={q} />
            <div className="fl-sub">City</div>
            <Checks options={facets?.cities ?? []} selected={f.cities} onToggle={(v) => set({ cities: toggle(f.cities, v) })} labels={{ unspecified: 'Not stated' }} search={q} />
          </>
        )}
      </Searchable>
    ),
  },
  {
    key: 'work', label: 'Work mode', count: (f) => f.work.length,
    body: ({ f, set, facets }) => <Checks options={facets?.workModes ?? []} labels={WORK} selected={f.work} onToggle={(v) => set({ work: toggle(f.work, v) })} />,
  },
  {
    key: 'experience', label: 'Experience', count: (f) => (f.maxYears != null ? 1 : 0),
    body: ({ f, set, facets }) => (
      <>
        <p className="fl-hint">Hide jobs that ask for more years than this. Jobs that don’t say stay in.</p>
        <Radios options={YEARS} value={f.maxYears} onChange={(v) => set({ maxYears: v })} anyLabel="Any experience" counts={new Map((facets?.maxYears ?? []).map((x) => [x.value, x.n]))} />
      </>
    ),
  },
  {
    key: 'seniority', label: 'Seniority', count: (f) => f.seniority.length,
    body: ({ f, set, facets }) => (
      <Checks
        options={[...(facets?.seniority ?? [])].sort((a, b) => SEN_ORDER.indexOf(a.value) - SEN_ORDER.indexOf(b.value))}
        labels={SENIORITY}
        selected={f.seniority}
        onToggle={(v) => set({ seniority: toggle(f.seniority, v) })}
      />
    ),
  },
  {
    key: 'type', label: 'Job type', count: (f) => f.types.length,
    body: ({ f, set, facets }) => <Checks options={facets?.types ?? []} labels={TYPES} selected={f.types} onToggle={(v) => set({ types: toggle(f.types, v) })} />,
  },
  {
    key: 'skills', label: 'Skills', count: (f) => f.skills.length,
    body: ({ f, set, facets }) => (
      <>
        <p className="fl-hint">Show jobs that mention every skill you pick.</p>
        <Searchable placeholder="Find a skill">
          {(q) => <Checks options={facets?.skills ?? []} selected={f.skills} onToggle={(v) => set({ skills: toggle(f.skills, v) })} search={q} />}
        </Searchable>
      </>
    ),
  },
  {
    key: 'posted', label: 'Posted', count: (f) => (f.posted ? 1 : 0),
    body: ({ f, set, facets }) => (
      <Radios options={POSTED} value={f.posted} onChange={(v) => set({ posted: v })} anyLabel="Any time" counts={new Map((facets?.postedDays ?? []).map((x) => [x.value, x.n]))} />
    ),
  },
  {
    key: 'more', label: 'More', count: (f) => f.education.length + (f.minScore ? 1 : 0) + (f.onlyNew ? 1 : 0) + (f.hideStarted ? 1 : 0) + (f.salary ? 1 : 0) + (f.described ? 1 : 0),
    body: ({ f, set, facets }) => (
      <>
        <div className="fl-sub">Education asked for</div>
        <Checks options={facets?.education ?? []} labels={EDUCATION} selected={f.education} onToggle={(v) => set({ education: toggle(f.education, v) })} />
        <div className="fl-sub">Match score at least</div>
        <Radios options={SCORES.map((s) => [s, String(s)] as [number, string])} value={f.minScore} onChange={(v) => set({ minScore: v })} anyLabel="Your relevance threshold" />
        <div className="fl-sub">Only show</div>
        <div className="fl-options">
          <label className="fl-opt"><input type="checkbox" checked={f.onlyNew} onChange={() => set({ onlyNew: !f.onlyNew })} /><span className="fl-name">New since you last looked</span></label>
          <label className="fl-opt"><input type="checkbox" checked={f.hideStarted} onChange={() => set({ hideStarted: !f.hideStarted })} /><span className="fl-name">Jobs I haven’t started applying to</span></label>
          <label className="fl-opt"><input type="checkbox" checked={f.salary} onChange={() => set({ salary: !f.salary })} /><span className="fl-name">Pay is listed</span></label>
          <label className="fl-opt"><input type="checkbox" checked={f.described} onChange={() => set({ described: !f.described })} /><span className="fl-name">Description fetched</span></label>
        </div>
      </>
    ),
  },
]

// ---------- active filter chips ----------

function chipsFor(f: Filters, facets: JobFacets | null): { label: string; clear: Partial<Filters> }[] {
  const out: { label: string; clear: Partial<Filters> }[] = []
  const name = (id: number) => facets?.companies.find((c) => c.id === id)?.name ?? `Company ${id}`
  for (const c of f.companies) out.push({ label: name(c), clear: { companies: f.companies.filter((x) => x !== c) } })
  for (const c of f.countries) out.push({ label: c === 'unspecified' ? 'Country not stated' : c, clear: { countries: f.countries.filter((x) => x !== c) } })
  for (const c of f.cities) out.push({ label: c === 'unspecified' ? 'City not stated' : c, clear: { cities: f.cities.filter((x) => x !== c) } })
  for (const w of f.work) out.push({ label: w === 'unspecified' ? 'Work mode not stated' : WORK[w] ?? w, clear: { work: f.work.filter((x) => x !== w) } })
  for (const t of f.types) out.push({ label: t === 'unspecified' ? 'Job type not stated' : TYPES[t] ?? t, clear: { types: f.types.filter((x) => x !== t) } })
  for (const s of f.seniority) out.push({ label: s === 'unspecified' ? 'Seniority not stated' : SENIORITY[s] ?? s, clear: { seniority: f.seniority.filter((x) => x !== s) } })
  for (const e of f.education) out.push({ label: e === 'none' ? 'No degree mentioned' : `${EDUCATION[e] ?? e} degree`, clear: { education: f.education.filter((x) => x !== e) } })
  for (const s of f.skills) out.push({ label: s, clear: { skills: f.skills.filter((x) => x !== s) } })
  if (f.maxYears != null) out.push({ label: YEARS.find(([y]) => y === f.maxYears)?.[1] ?? `Up to ${f.maxYears} years`, clear: { maxYears: null } })
  if (f.posted) out.push({ label: POSTED.find(([d]) => d === f.posted)?.[1] ?? `Last ${f.posted} days`, clear: { posted: null } })
  if (f.minScore) out.push({ label: `Score ${f.minScore}+`, clear: { minScore: null } })
  if (f.onlyNew) out.push({ label: 'New only', clear: { onlyNew: false } })
  if (f.hideStarted) out.push({ label: 'Not started', clear: { hideStarted: false } })
  if (f.salary) out.push({ label: 'Pay listed', clear: { salary: false } })
  if (f.described) out.push({ label: 'Has description', clear: { described: false } })
  return out
}

// ---------- the panel ----------

export default function JobFilters({ filters, onChange, facets, total }: {
  filters: Filters
  onChange: (f: Filters) => void
  facets: JobFacets | null
  total: number | null
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [sheet, setSheet] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })
  const chips = useMemo(() => chipsFor(filters, facets), [filters, facets])
  const n = activeCount(filters)

  // Close a dropdown on outside click or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpen(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="filters">
      <div className="fl-bar" ref={barRef} role="toolbar" aria-label="Filters">
        {GROUPS.map((g) => {
          const c = g.count(filters)
          return (
            <div key={g.key} className="fl-drop">
              <button
                className={`fl-btn ${c ? 'on' : ''} ${open === g.key ? 'open' : ''}`}
                aria-expanded={open === g.key}
                aria-haspopup="dialog"
                onClick={() => setOpen(open === g.key ? null : g.key)}
              >
                {g.label}
                {c > 0 && <span className="fl-count">{c}</span>}
                <svg viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              {open === g.key && (
                <div className="fl-pop" role="dialog" aria-label={`${g.label} filter`}>
                  <div className="fl-pop-body">{g.body({ f: filters, set, facets })}</div>
                  <div className="fl-pop-foot">
                    <span>{total ?? '…'} job{total === 1 ? '' : 's'}</span>
                    <button className="btn sm" onClick={() => setOpen(null)}>Done</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <button className={`btn fl-mobile ${n ? 'on' : ''}`} onClick={() => setSheet(true)}>
        <Sliders /> Filters{n ? ` (${n})` : ''}
      </button>

      {chips.length > 0 && (
        <div className="fl-chips" aria-label="Active filters">
          {chips.map((c) => (
            <button key={c.label} className="fl-chip" onClick={() => set(c.clear)} aria-label={`Remove filter ${c.label}`}>
              {c.label}
              <XIcon />
            </button>
          ))}
          <button className="link-btn small" onClick={() => onChange(EMPTY_FILTERS)}>Clear all</button>
        </div>
      )}

      {sheet && (
        <>
          <div className="overlay" onClick={() => setSheet(false)} />
          <div className="sheet fl-sheet" role="dialog" aria-label="Filters">
            <div className="grabber" />
            <div className="sheet-head">
              <h2>Filters</h2>
              {n > 0 && <button className="link-btn" onClick={() => onChange(EMPTY_FILTERS)}>Clear all</button>}
            </div>
            {GROUPS.map((g) => (
              <details key={g.key} className="fl-sec" open={g.count(filters) > 0}>
                <summary>
                  {g.label}
                  {g.count(filters) > 0 && <span className="fl-count">{g.count(filters)}</span>}
                </summary>
                <div className="fl-sec-body">{g.body({ f: filters, set, facets })}</div>
              </details>
            ))}
            <div className="fl-sheet-foot">
              <button className="btn primary lg" style={{ width: '100%' }} onClick={() => setSheet(false)}>
                Show {total ?? ''} job{total === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
