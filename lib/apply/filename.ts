/** Recruiter-friendly upload name from the Settings pattern, e.g. {First}_{Last}_Resume.pdf. */
export function resumeFileName(pattern: string, fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  const firstName = parts[0] || 'Resume'
  const lastName = parts.length > 1 ? parts[parts.length - 1] : ''
  const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : '')
  return pattern
    .replace(/\{First\}/g, cap(firstName))
    .replace(/\{Last\}/g, cap(lastName))
    .replace(/__+/g, '_')
    .replace(/^_|_(?=\.pdf$)/g, '')
}
