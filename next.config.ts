import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The Docker build sets BUILD_STANDALONE=1 to emit .next/standalone — a
  // self-contained server.js that ships without the full node_modules tree.
  // Left off for local builds, because `next start` refuses to serve a
  // standalone build.
  output: process.env.BUILD_STANDALONE ? 'standalone' : undefined,

  // pg and nodemailer are CommonJS with dynamic requires — keep them (and
  // Playwright) out of the server bundle so they load from node_modules at runtime.
  serverExternalPackages: ['pg', 'nodemailer', 'playwright', 'playwright-core'],

  // data/ is your private runtime data (database, resumes, the automation
  // browser's profile). Never trace it into the build: it isn't code, and the
  // browser profile is locked while the app runs, which breaks the build.
  outputFileTracingExcludes: {
    '*': ['./data/**/*', './.next/cache/**/*'],
  },
}

export default nextConfig
