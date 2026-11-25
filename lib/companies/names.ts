/**
 * How company names and their job-board platforms are shown.
 *
 * Names typed all in lowercase ("google", "jp morgan") are capitalised;
 * anything with a capital letter is kept as typed ("eBay", "iCIMS", "IBM").
 */

/** "google" → "Google", "jp morgan chase" → "Jp Morgan Chase"; mixed case is left alone. */
export function tidyCompanyName(name: string): string {
  const n = (name || '').trim().replace(/\s+/g, ' ')
  if (!n || /[A-Z]/.test(n)) return n
  return n.replace(/(^|[\s\-/&(])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase())
}

/** The job-board platform as people know it, or null when there's nothing worth showing. */
const ATS_LABELS: Record<string, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workable: 'Workable',
  smartrecruiters: 'SmartRecruiters',
  recruitee: 'Recruitee',
  workday: 'Workday',
  icims: 'iCIMS',
  taleo: 'Taleo',
  successfactors: 'SuccessFactors',
  eightfold: 'Eightfold',
  amazon: 'Amazon Jobs',
  google: 'Google Careers',
}

export function platformLabel(atsType: string | null | undefined, companyName: string): string | null {
  if (!atsType || atsType === 'custom') return null
  const label = ATS_LABELS[atsType] ?? atsType
  // "Google" on Google's own careers site says nothing new.
  const first = label.toLowerCase().split(' ')[0]
  return companyName.trim().toLowerCase().startsWith(first) ? null : label
}
