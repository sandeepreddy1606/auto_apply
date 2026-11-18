/**
 * Jobs filters <-> URL query string. Shared by the API routes (parse) and the
 * Jobs page (serialise), so a filtered view is a link you can bookmark.
 */
import type { ListJobsOpts } from './store'

const list = (v: string | null): string[] => (v ? v.split(',').map((x) => decodeURIComponent(x.trim())).filter(Boolean) : [])
const num = (v: string | null): number | null => {
  const n = Number(v)
  return v !== null && v !== '' && Number.isFinite(n) ? n : null
}

export const VIEWS = new Set(['relevant', 'all', 'shortlisted', 'applied', 'dismissed'])
export const SORTS = new Set(['score', 'newest', 'company'])

export function parseJobQuery(u: URLSearchParams): ListJobsOpts {
  const positive = (k: string) => {
    const n = num(u.get(k))
    return n !== null && n > 0 ? n : null
  }
  return {
    view: VIEWS.has(u.get('view') || '') ? (u.get('view') as ListJobsOpts['view']) : 'relevant',
    sort: SORTS.has(u.get('sort') || '') ? (u.get('sort') as ListJobsOpts['sort']) : 'score',
    q: (u.get('q') || '').trim().slice(0, 100) || null,
    companyId: positive('company'),
    minScore: positive('min_score'),
    limit: positive('limit') ?? 100,
    offset: num(u.get('offset')) ?? 0,
    companies: list(u.get('companies')).map(Number).filter((n) => Number.isInteger(n) && n > 0),
    cities: list(u.get('cities')),
    countries: list(u.get('countries')),
    workModes: list(u.get('work')),
    types: list(u.get('types')),
    seniority: list(u.get('seniority')),
    education: list(u.get('education')),
    skills: list(u.get('skills')).slice(0, 10),
    maxYears: num(u.get('max_years')),
    postedDays: positive('posted'),
    onlyNew: u.get('new') === '1',
    hideStarted: u.get('hide_started') === '1',
    withSalary: u.get('salary') === '1',
    withDescription: u.get('described') === '1',
  }
}
