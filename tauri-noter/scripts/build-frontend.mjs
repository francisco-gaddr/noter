// Build the Tauri frontend by REUSING the proven Electron web-export build (static Next.js export +
// the app/api stashing it already handles), then sync its output into tauri-noter/dist. The exported
// UI is runtime-agnostic — window.mlc / window.noterDesktop are provided at load time by the preload
// (Electron) or the injected bridge (Tauri), so the exact same bundle serves both. Maximal reuse; the
// build logic moves into this repo once electron-noter is retired.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const buildWeb = path.join(repoRoot, 'electron-noter', 'src', 'build-web.js')
const renderer = path.join(repoRoot, 'electron-noter', 'renderer')
const dist = path.resolve(here, '..', 'dist')

console.log('==> Building the shared Next.js static export (via electron-noter/build-web.js)…')
execSync(`node "${buildWeb}"`, { stdio: 'inherit' })

if (!fs.existsSync(renderer)) {
  console.error(`ERROR: expected export at ${renderer} — did the web build fail?`)
  process.exit(1)
}

console.log(`==> Syncing export → ${dist}`)
fs.rmSync(dist, { recursive: true, force: true })
fs.cpSync(renderer, dist, { recursive: true })
console.log('==> Tauri frontend ready.')
