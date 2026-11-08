// Cross-platform `next start`: honours PORT (default 8787) and AUTO_APPLY_HOST
// (default 0.0.0.0). npm runs scripts through cmd.exe on Windows, which does not
// understand POSIX `${VAR:-default}` expansion, so the defaults live here.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = process.env.PORT || '8787'
const host = process.env.AUTO_APPLY_HOST || '0.0.0.0'
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next')

const child = spawn(process.execPath, [nextBin, 'start', '--port', port, '--hostname', host, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
})
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
