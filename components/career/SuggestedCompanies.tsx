'use client'

/**
 * One-click companies to watch: tech employers hiring in India whose job
 * boards the scanner reads directly. Ones you already watch are left out.
 */
import { useState } from 'react'

import { useToast } from '@/components/Toast'
import Monogram from '@/components/career/Monogram'
import { api } from '@/lib/api'
import { SUGGESTED_COMPANIES } from '@/lib/companies/suggested'
import type { Company } from '@/lib/types'

const SHOW = 12

/** Same page, written either way: no scheme, no "www.", no trailing slash, any case. */
const sameUrl = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')

export default function SuggestedCompanies({ companies, onAdded }: { companies: Company[]; onAdded: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [all, setAll] = useState(false)

  const watched = new Set(companies.flatMap((c) => [sameUrl(c.career_url), c.name.trim().toLowerCase()]))
  const left = SUGGESTED_COMPANIES.filter((s) => !watched.has(sameUrl(s.url)) && !watched.has(s.name.toLowerCase()))
  if (!left.length) return null
  const shown = all ? left : left.slice(0, SHOW)

  const add = async (name: string, url: string) => {
    setBusy(name)
    try {
      await api.addCompany(name, url)
      toast(`${name} added — scanning now. Matching openings will appear in Jobs.`, 'success')
      onAdded()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="card suggested" aria-label="Suggested companies">
      <h3>Suggested companies hiring in India</h3>
      <p className="muted small" style={{ marginBottom: 12 }}>
        Their job boards are read directly, so scans are fast and complete. Add the ones you’d work for.
      </p>
      <ul className="sugg-list">
        {shown.map((s) => (
          <li key={s.url}>
            <Monogram name={s.name} size="sm" />
            <span className="sg-text">
              <b>{s.name}</b>
              <span className="muted small">{s.about}</span>
            </span>
            <button className="btn sm" disabled={busy !== null} onClick={() => add(s.name, s.url)} aria-label={`Watch ${s.name}`}>
              {busy === s.name ? <span className="spin" /> : null} Add
            </button>
          </li>
        ))}
      </ul>
      {left.length > SHOW && (
        <button className="link-btn small" style={{ marginTop: 10 }} onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${left.length}`}
        </button>
      )}
    </section>
  )
}
