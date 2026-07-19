import { useEffect, useState } from 'react'
import { api } from './api'
import { ToastProvider } from './Toast'
import { useRoute, navigate } from './router'
import Home from './pages/Home'
import Applications from './pages/Applications'
import ApplicationDetail from './pages/ApplicationDetail'
import Paste from './pages/Paste'
import CompaniesJobs from './pages/CompaniesJobs'
import CompaniesManage from './pages/CompaniesManage'
import SettingsHub from './pages/settings/SettingsHub'
import ProfilePage from './pages/settings/Profile'
import TelegramPage from './pages/settings/Telegram'
import EmailPage from './pages/settings/Email'
import TemplatePage from './pages/settings/Template'
import AutomationPage from './pages/settings/Automation'
import ResumesPage from './pages/settings/Resumes'
import SecurityPage from './pages/settings/Security'
import { GridIcon, ListIcon, GearIcon, BuildingIcon } from './components/Icons'

export default function App() {
  const { raw, path, segments, query } = useRoute()
  const [tg, setTg] = useState({ state: 'disconnected' })
  const [reviewCount, setReviewCount] = useState(0)
  const [newJobsCount, setNewJobsCount] = useState(0)

  useEffect(() => { window.scrollTo(0, 0) }, [raw])

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const [s, st, cj] = await Promise.all([
          api.tgStatus(), api.stats(),
          api.companyJobsSummary().catch(() => null),
        ])
        if (!alive) return
        setTg(s)
        setReviewCount(st.by_status?.review || 0)
        if (cj) setNewJobsCount(cj.new_matched || 0)
      } catch { /* backend warming up */ }
    }
    poll()
    const t = setInterval(poll, 10000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const [root, second] = segments
  let page
  if (!root) page = <Home tg={tg} />
  else if (root === 'applications' && second) page = <ApplicationDetail id={Number(second)} />
  else if (root === 'applications') page = <Applications />
  else if (root === 'paste') page = <Paste />
  else if (root === 'companies' && second === 'manage') page = <CompaniesManage />
  else if (root === 'companies') page = <CompaniesJobs initialCompany={query.company} />
  else if (root === 'settings' && second === 'profile') page = <ProfilePage />
  else if (root === 'settings' && second === 'telegram') page = <TelegramPage tg={tg} setTg={setTg} />
  else if (root === 'settings' && second === 'email') page = <EmailPage />
  else if (root === 'settings' && second === 'template') page = <TemplatePage />
  else if (root === 'settings' && second === 'automation') page = <AutomationPage />
  else if (root === 'settings' && second === 'resumes') page = <ResumesPage />
  else if (root === 'settings' && second === 'security') page = <SecurityPage />
  else if (root === 'settings') page = <SettingsHub tg={tg} />
  else page = <Home tg={tg} />

  const tabOf = (r) => (r === 'paste' ? '' : r || '')
  const active = tabOf(root)

  return (
    <ToastProvider>
      <div className="shell">
        <div className="page" key={path}>{page}</div>
      </div>

      <nav className="bottom-nav">
        <button className={active === '' ? 'active' : ''} title="Overview"
          onClick={() => navigate('/')}>
          <GridIcon />
        </button>
        <button className={active === 'applications' ? 'active' : ''} title="Applications"
          onClick={() => navigate('/applications')}>
          <ListIcon />
          {reviewCount > 0 && <span className="nav-dot" />}
        </button>
        <button className={active === 'companies' ? 'active' : ''} title="Companies"
          onClick={() => navigate('/companies')}>
          <BuildingIcon />
          {newJobsCount > 0 && <span className="nav-dot" />}
        </button>
        <button className={active === 'settings' ? 'active' : ''} title="Settings"
          onClick={() => navigate('/settings')}>
          <GearIcon />
        </button>
      </nav>
    </ToastProvider>
  )
}
