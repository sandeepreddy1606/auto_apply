import { navigate } from '../router'

export default function CompaniesTabs({ active, newCount = 0, companiesCount = 0 }) {
  return (
    <div className="seg">
      <button className={active === 'jobs' ? 'on' : ''} onClick={() => navigate('/companies')}>
        Openings
        {newCount > 0 && <span className="seg-badge">{newCount}</span>}
      </button>
      <button className={active === 'manage' ? 'on' : ''} onClick={() => navigate('/companies/manage')}>
        Watched
        {companiesCount > 0 && <span className="seg-count">{companiesCount}</span>}
      </button>
    </div>
  )
}
