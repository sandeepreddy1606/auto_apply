/**
 * Next.js calls register() once per server process — for the Node.js server
 * and, separately, for the Edge runtime. All startup work lives in
 * lib/server/startup.ts and uses Node-only modules (fs, path, sqlite), so it is
 * imported inside the `NEXT_RUNTIME === 'nodejs'` branch: Next replaces that
 * variable at build time and drops the branch (and its imports) from the Edge
 * build entirely. Don't import anything at the top of this file.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { start } = await import('./lib/server/startup')
    await start()
  }
}
