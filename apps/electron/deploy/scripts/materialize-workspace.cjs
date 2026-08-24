/**
 * Materialize the standalone workspace for packaging.
 *
 * electron-builder copies `deploy` (the pnpm-deploy tree) into the package as
 * `resources/workspace`. But `deploy` is full of junctions (pnpm store links)
 * whose absolute targets point at the build machine's `deploy` directory.
 * When 7za compresses the copied tree it FOLLOWS those junctions, re-reading
 * the original deploy dir — a combinatorial blowup that never finishes.
 *
 * This script copies `deploy` into `dist/workspace` with `dereference: true`
 * so every junction is resolved to a real directory inside the copy. The
 * packaged tree is then self-contained (no junctions) and compresses once.
 * The main process's `linkBundledWorkspace` boot-time step becomes a no-op
 * (everything already resolves), which is fine.
 *
 * Usage: node scripts/materialize-workspace.cjs
 */
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const src = path.join(root, 'deploy')
const out = path.join(root, 'dist', 'workspace')

if (!fs.existsSync(path.join(src, 'package.json'))) {
  console.error(`materialize-workspace: no deploy tree at ${src}`)
  process.exit(2)
}

console.log(`materializing ${src} -> ${out}`)
fs.rmSync(out, { recursive: true, force: true })
// dereference: true resolves junctions/symlinks into real directories, so the
// copy is fully self-contained and NSIS/7za has nothing to chase.
fs.cpSync(src, out, { recursive: true, dereference: true })
console.log('materialized workspace at', out)
