import type { Metadata, Viewport } from 'next'

import AppShell from '@/components/AppShell'
import { THEME_BOOT } from '@/components/theme-boot'

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
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0b0c0e' },
    { media: '(prefers-color-scheme: light)', color: '#f5f5f3' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
