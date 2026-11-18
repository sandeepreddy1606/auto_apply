'use client'

/**
 * Light / dark / follow-the-system. The choice lives in localStorage
 * ('aa-theme') and is applied as html[data-theme] — before first paint by the
 * inline script in app/layout.tsx, so pages never flash the wrong theme.
 */
import { useEffect, useState } from 'react'

import { MonitorIcon, MoonIcon, SunIcon } from './Icons'
import { THEME_KEY as KEY } from './theme-boot'

export type ThemeMode = 'system' | 'light' | 'dark'

function read(): ThemeMode {
  try {
    const m = localStorage.getItem(KEY)
    return m === 'light' || m === 'dark' ? m : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(mode: ThemeMode): void {
  const el = document.documentElement
  if (mode === 'system') el.removeAttribute('data-theme')
  else el.setAttribute('data-theme', mode)
  try {
    if (mode === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, mode)
  } catch {
    /* private window: the choice lasts for this page only */
  }
}

export function useTheme(): [ThemeMode, (m: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>('system')
  useEffect(() => setMode(read()), [])
  return [mode, (m) => { applyTheme(m); setMode(m) }]
}

const OPTIONS: [ThemeMode, string, typeof SunIcon][] = [
  ['system', 'Match system', MonitorIcon],
  ['light', 'Light', SunIcon],
  ['dark', 'Dark', MoonIcon],
]

export function ThemeSwitch() {
  const [mode, set] = useTheme()
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Theme">
      {OPTIONS.map(([m, label, Icon]) => (
        <button key={m} role="radio" aria-checked={mode === m} aria-label={label} title={label} className={mode === m ? 'on' : ''} onClick={() => set(m)}>
          <Icon />
        </button>
      ))}
    </div>
  )
}
