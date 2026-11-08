/**
 * Last-resort account recovery, run on the machine that hosts Auto Apply:
 *
 *   npm run auth:recover                 # the owner account
 *   npm run auth:recover -- you@x.com    # a specific account
 *
 * Prints a fresh recovery code (the old one stops working). Use it on the
 * "Forgot password?" page to set a new password. Anyone who can run this
 * already has full access to the data folder, so it grants nothing new.
 */
const { issueRecoveryCodeFor } = await import('../lib/server/auth.ts')

const email = process.argv.slice(2).find((a) => a.includes('@')) ?? null
const out = await issueRecoveryCodeFor(email)
if (!out) {
  console.error(email ? `No account with the email ${email}.` : 'No account exists yet — open the app and create one.')
  process.exit(1)
}
console.log(`\nNew recovery code for ${out.email}:\n\n    ${out.code}\n`)
console.log('Open the app → Sign in → "Forgot password?" → "Use my recovery code".\n')
process.exit(0)

export {}
