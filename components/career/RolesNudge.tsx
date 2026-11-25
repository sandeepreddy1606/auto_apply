'use client'

/**
 * Shown on Jobs when you haven't chosen target roles: matching then guesses
 * from your current job title, which is often too broad or too narrow. Pick
 * the roles you want right here; jobs are re-scored straight away.
 */
import { useEffect, useState } from 'react'

import { ChipInput } from '@/components/career/ui'
import { useToast } from '@/components/Toast'
import { api } from '@/lib/api'
import type { Settings } from '@/lib/types'

export const ROLE_SUGGESTIONS = ['Software Engineer', 'Backend Engineer', 'Full Stack Engineer', 'SDE', 'ML Engineer', 'AI Engineer', 'Frontend Engineer', 'Data Engineer']

export default function RolesNudge({ onSaved }: { onSaved: () => void }) {
  const toast = useToast()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [roles, setRoles] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {})
  }, [])

  if (hidden || !settings || settings.job_prefs.target_roles.length > 0) return null
  const current = (settings.profile.current_role || '').trim()

  const save = async () => {
    setBusy(true)
    try {
      await api.saveSettings({ job_prefs: { ...settings.job_prefs, target_roles: roles } })
      toast('Saved. Re-scoring your jobs for these roles…', 'success')
      setHidden(true)
      // The worker re-scores in the background; refresh once it has had a moment.
      setTimeout(onSaved, 4000)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="roles-nudge" aria-label="Choose your target roles">
      <div className="rn-text">
        <h2 className="rn-title">Which roles are you looking for?</h2>
        <p className="rn-why">
          {current
            ? `Right now jobs are matched to your current title, “${current}”. Pick the roles you want and only those count as relevant.`
            : 'Pick the roles you want and only those count as relevant.'}
        </p>
      </div>
      <div className="rn-pick">
        <ChipInput value={roles} onChange={setRoles} placeholder="Type a role and press Enter" suggestions={ROLE_SUGGESTIONS} />
        <div className="row-actions" style={{ marginTop: 10 }}>
          <button className="btn primary" disabled={busy || roles.length === 0} onClick={save}>
            {busy ? <span className="spin" /> : null} Use these roles
          </button>
        </div>
      </div>
    </section>
  )
}
