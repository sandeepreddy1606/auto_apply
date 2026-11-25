/**
 * Companies to suggest on the Companies page: tech employers whose public
 * job boards (Greenhouse, Lever, Ashby) the scanner reads directly, and that
 * listed openings in India when this list was checked (2026-11-23, by
 * querying each board's public API — boards with fewer than 5 India openings
 * were left out). Ordered by how many India openings they had then.
 *
 * Re-check with the board APIs before adding to it; a wrong board token just
 * scans an empty or unrelated board.
 */
export interface SuggestedCompany {
  name: string
  url: string
  /** What the company does, in a few words. */
  about: string
}

export const SUGGESTED_COMPANIES: SuggestedCompany[] = [
  { name: 'Okta', url: 'https://boards.greenhouse.io/okta', about: 'Identity and security' },
  { name: 'Databricks', url: 'https://boards.greenhouse.io/databricks', about: 'Data and AI platform' },
  { name: 'MongoDB', url: 'https://boards.greenhouse.io/mongodb', about: 'Databases' },
  { name: 'Meesho', url: 'https://jobs.lever.co/meesho', about: 'E-commerce' },
  { name: 'Stripe', url: 'https://boards.greenhouse.io/stripe', about: 'Payments' },
  { name: 'Rubrik', url: 'https://boards.greenhouse.io/rubrik', about: 'Data security' },
  { name: 'InMobi', url: 'https://boards.greenhouse.io/inmobi', about: 'Ad tech' },
  { name: 'Sigmoid', url: 'https://boards.greenhouse.io/sigmoid', about: 'Data engineering services' },
  { name: 'Sarvam AI', url: 'https://jobs.ashbyhq.com/sarvam', about: 'AI models for India' },
  { name: 'GitLab', url: 'https://boards.greenhouse.io/gitlab', about: 'Developer platform' },
  { name: 'Zeta', url: 'https://jobs.lever.co/zeta', about: 'Banking technology' },
  { name: 'HackerRank', url: 'https://boards.greenhouse.io/hackerrank', about: 'Developer hiring' },
  { name: 'Mindtickle', url: 'https://jobs.lever.co/mindtickle', about: 'Sales enablement' },
  { name: 'Bureau', url: 'https://jobs.ashbyhq.com/bureau', about: 'Identity and fraud' },
  { name: 'Twilio', url: 'https://boards.greenhouse.io/twilio', about: 'Communications APIs' },
  { name: 'Elastic', url: 'https://boards.greenhouse.io/elastic', about: 'Search and observability' },
  { name: 'Glance', url: 'https://boards.greenhouse.io/glance', about: 'Consumer tech (InMobi group)' },
  { name: 'FamPay', url: 'https://jobs.lever.co/fampay', about: 'Payments for teens' },
  { name: 'Airbnb', url: 'https://boards.greenhouse.io/airbnb', about: 'Travel' },
  { name: 'Plane', url: 'https://jobs.ashbyhq.com/plane', about: 'Project management' },
  { name: 'Druva', url: 'https://boards.greenhouse.io/druva', about: 'Cloud data protection' },
  { name: 'CRED', url: 'https://jobs.lever.co/cred', about: 'Fintech' },
  { name: 'SpotDraft', url: 'https://jobs.ashbyhq.com/spotdraft', about: 'Contract management' },
  { name: 'ElevenLabs', url: 'https://jobs.ashbyhq.com/elevenlabs', about: 'Voice AI' },
  { name: 'OpenAI', url: 'https://jobs.ashbyhq.com/openai', about: 'AI research and products' },
  { name: 'Coinbase', url: 'https://boards.greenhouse.io/coinbase', about: 'Crypto' },
  { name: 'Datadog', url: 'https://boards.greenhouse.io/datadog', about: 'Monitoring' },
  { name: 'Groww', url: 'https://boards.greenhouse.io/groww', about: 'Investing' },
  { name: 'Harvey', url: 'https://jobs.ashbyhq.com/harvey', about: 'AI for legal' },
  { name: 'Zuora', url: 'https://boards.greenhouse.io/zuora', about: 'Billing software' },
  { name: 'Skyflow', url: 'https://jobs.ashbyhq.com/skyflow', about: 'Data privacy' },
  { name: 'Observe.AI', url: 'https://boards.greenhouse.io/observeai', about: 'AI for contact centres' },
  { name: 'Samsara', url: 'https://boards.greenhouse.io/samsara', about: 'IoT operations' },
  { name: 'Kenko', url: 'https://jobs.lever.co/kenko', about: 'Health plans' },
  { name: 'Cursor', url: 'https://jobs.ashbyhq.com/cursor', about: 'AI code editor' },
]
