import type { Metadata, Viewport } from 'next'

import AppShell from '@/components/AppShell'

import './globals.css'
import './career.css'
import './auth.css'

export const metadata: Metadata = {
  title: 'Auto Apply',
  description: 'Automated job-application dashboard',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
}

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
