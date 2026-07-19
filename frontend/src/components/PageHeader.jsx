import { navigate } from '../router'
import { ChevronLeft } from './Icons'

/* Every page renders its own header. Root pages get the large title;
   subpages get a back button. `onBack` overrides `backTo` so pages with
   unsaved edits can confirm before leaving. */
export default function PageHeader({ title, sub, backTo, onBack, actions, large }) {
  const back = onBack || (backTo ? () => navigate(backTo) : null)
  return (
    <div className={`page-head ${large ? 'large' : ''}`}>
      {back && (
        <button className="back-btn" onClick={back} title="Back">
          <ChevronLeft />
        </button>
      )}
      <div className="ph-text">
        <h1>{title}</h1>
        {sub && <div className="ph-sub">{sub}</div>}
      </div>
      {actions && <div className="ph-actions">{actions}</div>}
    </div>
  )
}
