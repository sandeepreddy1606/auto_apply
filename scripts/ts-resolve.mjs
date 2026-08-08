/**
 * Resolve hook for running the TypeScript sources directly under `node` —
 * used by the test suite and the one-off Postgres migration script.
 *
 * The app is written for a bundler: relative imports omit the file extension
 * and `@/...` maps to the project root. Node's ESM resolver does neither, so
 * this hook teaches it both — letting the tests import the real source files
 * unchanged instead of the source being reshaped to suit the test runner.
 */
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')

/** Try `<base>.ts`, then `<base>/index.ts`. */
function resolveTs(basePath) {
  for (const candidate of [`${basePath}.ts`, path.join(basePath, 'index.ts')]) {
    if (existsSync(candidate)) return pathToFileURL(candidate).href
  }
  return null
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const hasExtension = /\.[cm]?[jt]sx?$/.test(specifier)

    if (specifier.startsWith('@/')) {
      const url = resolveTs(path.join(ROOT, specifier.slice(2)))
      if (url) return { url, shortCircuit: true }
    }

    if (specifier.startsWith('.') && !hasExtension && context.parentURL) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL))
      const url = resolveTs(path.resolve(parentDir, specifier))
      if (url) return { url, shortCircuit: true }
    }

    return nextResolve(specifier, context)
  },
})
