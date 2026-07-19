const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  viewBox: '0 0 24 24',
}

export const Sliders = (p) => (
  <svg {...base} {...p}>
    <line x1="8" y1="4" x2="8" y2="20" />
    <line x1="16" y1="4" x2="16" y2="20" />
    <circle cx="8" cy="9" r="2.2" fill="currentColor" stroke="none" />
    <circle cx="16" cy="15" r="2.2" fill="currentColor" stroke="none" />
  </svg>
)

export const PlusSquare = (p) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
    <line x1="12" y1="8.5" x2="12" y2="15.5" />
    <line x1="8.5" y1="12" x2="15.5" y2="12" />
  </svg>
)

export const GridIcon = (p) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="2.2" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="2.2" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="2.2" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="2.2" />
  </svg>
)

export const ListIcon = (p) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="4" width="17" height="16" rx="4" />
    <line x1="7.5" y1="9" x2="16.5" y2="9" />
    <line x1="7.5" y1="13" x2="16.5" y2="13" />
    <line x1="7.5" y1="17" x2="12.5" y2="17" />
  </svg>
)

export const ChatIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M21 12a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-2.9-.36-4.1-1L3 21l1.5-5.4A8.5 8.5 0 1 1 21 12z" />
  </svg>
)

export const GearIcon = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
  </svg>
)

export const MailIcon = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="5" width="18" height="14" rx="3.5" />
    <path d="M3.5 7.5 12 13l8.5-5.5" />
  </svg>
)

export const FormIcon = (p) => (
  <svg {...base} {...p}>
    <rect x="4.5" y="3" width="15" height="18" rx="3.5" />
    <line x1="8.5" y1="8" x2="15.5" y2="8" />
    <line x1="8.5" y1="12" x2="15.5" y2="12" />
    <line x1="8.5" y1="16" x2="12.5" y2="16" />
  </svg>
)

export const HelpIcon = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.4c-.8.35-1 .9-1 1.9" />
    <circle cx="12" cy="16.8" r="0.6" fill="currentColor" stroke="none" />
  </svg>
)

export const SendIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M21 3 10.5 13.5" />
    <path d="M21 3l-6.8 18-3.7-7.5L3 9.8z" />
  </svg>
)

export const ChevronRight = (p) => (
  <svg {...base} {...p}>
    <path d="M9.5 6 15.5 12l-6 6" />
  </svg>
)

export const ChevronLeft = (p) => (
  <svg {...base} {...p}>
    <path d="M14.5 6 8.5 12l6 6" />
  </svg>
)

export const DocIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M6 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 20V5A1.5 1.5 0 0 1 6.5 3.5z" />
    <path d="M13 3.5V9h5" />
    <line x1="8.5" y1="13" x2="15.5" y2="13" />
    <line x1="8.5" y1="16.5" x2="13.5" y2="16.5" />
  </svg>
)

export const LinkIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.5 1.5" />
    <path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.5-1.5" />
  </svg>
)

export const LockIcon = (p) => (
  <svg {...base} {...p}>
    <rect x="4.5" y="10" width="15" height="10.5" rx="2.5" />
    <path d="M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10" />
    <circle cx="12" cy="15" r="1.2" fill="currentColor" stroke="none" />
  </svg>
)

export const BoltIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12z" />
  </svg>
)

export const CheckIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M4.5 12.5 10 18 19.5 6.5" />
  </svg>
)

export const BuildingIcon = (p) => (
  <svg {...base} {...p}>
    <rect x="4.5" y="3.5" width="10" height="17" rx="1.5" />
    <path d="M14.5 9.5h3.5a1.5 1.5 0 0 1 1.5 1.5v9.5" />
    <line x1="3" y1="20.5" x2="21" y2="20.5" />
    <line x1="8" y1="7.5" x2="11" y2="7.5" />
    <line x1="8" y1="11" x2="11" y2="11" />
    <line x1="8" y1="14.5" x2="11" y2="14.5" />
  </svg>
)

export const EyeIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

export const EyeOffIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M2.5 12S6 5.5 12 5.5c1.6 0 3 .45 4.3 1.1M21.5 12S18 18.5 12 18.5c-1.6 0-3-.45-4.3-1.1" />
    <line x1="4" y1="20" x2="20" y2="4" />
  </svg>
)

export const XIcon = (p) => (
  <svg {...base} {...p}>
    <line x1="6.5" y1="6.5" x2="17.5" y2="17.5" />
    <line x1="17.5" y1="6.5" x2="6.5" y2="17.5" />
  </svg>
)
