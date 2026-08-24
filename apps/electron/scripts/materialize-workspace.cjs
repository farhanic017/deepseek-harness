/**
 * Materialize the standalone workspace for packaging.
 *
 * electron-builder copies `dist/workspace` into the package as
 * `resources/workspace`. That tree is produced from `deploy` (the
 * pnpm-deploy tree), which is full of junctions (pnpm store links) whose
 * absolute targets point at the build machine's `deploy` directory. When 7za
 * compresses the copied tree it FOLLOWS those junctions, re-reading the
 * original deploy dir — a combinatorial blowup that never finishes.
 *
 * This script copies `deploy` into `dist/workspace` resolving every junction
 * to a real directory inside the copy, so the packaged tree is self-contained
 * (no junctions) and compresses once. The main process's
 * `linkBundledWorkspace` boot-time step then becomes a no-op.
 *
 * The copy CANNOT use fs.cpSync({ dereference: true }) or robocopy/xcopy/tar:
 * the deploy tree contains pnpm junction cycles (workspace cycles like
 * vendor/cordis <-> vendor/include). Tools that lack ancestor-cycle detection
 * expand those indefinitely — Node 22's cpSync recurses until a stack
 * overflow, robocopy silently drops files, tar aborts with "File name too
 * long". The custom copier in materialize-worker.cjs resolves each junction
 * to its realpath and skips it when that realpath is already an ancestor of
 * the current copy position (a true cycle) — the same shape the shipped
 * win-unpacked workspace has (cycle links absent, everything else copied).
 *
 * The copy is parallelized: the `.pnpm` store is split into per-worker chunks
 * (size-balanced) and the top-level node_modules links are copied by a
 * dedicated worker. Each worker owns a disjoint destination subtree, so
 * per-worker cycle detection is safe and the result is identical to one big
 * copy.
 *
 * After the copy a completeness check walks the `.pnpm` store and asserts
 * every package made it into the copy — a partial copy fails the build
 * instead of shipping a workspace that cannot boot.
 *
 * Usage: node scripts/materialize-workspace.cjs
 */
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const src = path.join(root, 'deploy')
const out = path.join(root, 'dist', 'workspace')

if (!fs.existsSync(path.join(src, 'package.json'))) {
  console.error(`materialize-workspace: no deploy tree at ${src}`)
  process.exit(2)
}

function copyDir(srcDir, dstDir, ancestors) {
  const real = fs.realpathSync(srcDir)
  if (ancestors.has(real)) return
  ancestors.add(real)
  try {
    fs.mkdirSync(dstDir, { recursive: true })
    for (const entry of fs.readdirSync(srcDir)) {
      const s = path.join(srcDir, entry)
      const d = path.join(dstDir, entry)
      let st
      try { st = fs.lstatSync(s) } catch { continue }
      if (st.isSymbolicLink()) {
        let target
        try { target = fs.realpathSync(s) } catch { continue }
        const tst = fs.statSync(target)
        if (tst.isDirectory()) {
          copyDir(target, d, ancestors)
        } else {
          fs.mkdirSync(path.dirname(d), { recursive: true })
          fs.copyFileSync(target, d)
        }
      } else if (st.isDirectory()) {
        copyDir(s, d, ancestors)
      } else {
        fs.mkdirSync(path.dirname(d), { recursive: true })
        fs.copyFileSync(s, d)
      }
    }
  } finally {
    ancestors.delete(real)
  }
}

function copyChunk(entries, id, workerFile) {
  const manifestFile = path.join(os.tmpdir(), `materialize-${process.pid}-${id}.txt`)
  fs.writeFileSync(manifestFile, entries.map(([s, d]) => `${s}\t${d}`).join('\n'))
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerFile, manifestFile], { stdio: ['ignore', 'inherit', 'inherit'] })
    child.on('error', reject)
    child.on('exit', (code) => {
      fs.rmSync(manifestFile, { force: true })
      code === 0 ? resolve() : reject(new Error(`copy worker ${id} exited ${code}`))
    })
  })
}

async function main() {
  const workers = Math.min(8, Math.max(2, os.cpus().length))
  console.log(`materializing ${src} -> ${out} (${workers} workers)`)
  fs.rmSync(out, { recursive: true, force: true })

  // 1. Top-level entries other than node_modules (fast, sequential).
  const ancestors = new Set()
  for (const entry of fs.readdirSync(src)) {
    if (entry === 'node_modules') continue
    const s = path.join(src, entry)
    const d = path.join(out, entry)
    const st = fs.lstatSync(s)
    if (st.isSymbolicLink()) {
      const t = fs.realpathSync(s)
      if (fs.statSync(t).isDirectory()) copyDir(t, d, ancestors)
      else { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(t, d) }
    } else if (st.isDirectory()) {
      copyDir(s, d, ancestors)
    } else {
      fs.mkdirSync(path.dirname(d), { recursive: true })
      fs.copyFileSync(s, d)
    }
  }

  // 2. Split node_modules into chunks and run workers in parallel.
  const workerFile = path.join(__dirname, 'materialize-worker.cjs')
  const nodeSrc = path.join(src, 'node_modules')
  const nodeOut = path.join(out, 'node_modules')
  fs.mkdirSync(nodeOut, { recursive: true })

  const topChunk = []
  const storeEntries = []
  const isDir = (p) => {
    let st
    try { st = fs.lstatSync(p) } catch { return false }
    if (st.isDirectory()) return true
    if (st.isSymbolicLink()) {
      try { return fs.statSync(p).isDirectory() } catch { return false }
    }
    return false
  }
  const copyFile = (s, d) => {
    fs.mkdirSync(path.dirname(d), { recursive: true })
    fs.copyFileSync(s, d)
  }
  for (const entry of fs.readdirSync(nodeSrc)) {
    const srcPath = path.join(nodeSrc, entry)
    const dstPath = path.join(nodeOut, entry)
    if (entry === '.pnpm') {
      for (const storeEntry of fs.readdirSync(srcPath)) {
        const s = path.join(srcPath, storeEntry)
        if (isDir(s)) storeEntries.push([s, path.join(dstPath, storeEntry)])
        else copyFile(s, path.join(dstPath, storeEntry))
      }
    } else if (isDir(srcPath)) {
      topChunk.push([srcPath, dstPath])
    } else {
      copyFile(srcPath, dstPath)
    }
  }

  // Balance store chunks by size (largest first, round-robin) so the slowest
  // worker dominates wall time as little as possible.
  const sizes = storeEntries.map(([s]) => {
    try { return fs.statSync(s).size } catch { return 0 }
  })
  const order = storeEntries.map((_, i) => i).sort((a, b) => sizes[b] - sizes[a])
  const storeChunks = Array.from({ length: workers - 1 }, () => [])
  order.forEach((idx, i) => storeChunks[i % storeChunks.length].push(storeEntries[idx]))

  const jobs = []
  if (topChunk.length > 0) jobs.push(copyChunk(topChunk, 'top', workerFile))
  for (let i = 0; i < storeChunks.length; i += 1) {
    if (storeChunks[i].length > 0) jobs.push(copyChunk(storeChunks[i], `store-${i}`, workerFile))
  }
  await Promise.all(jobs)

  // 3. Completeness check: every .pnpm store package must have its
  // package.json in the copy. A truncated copy leaves store packages partial
  // or missing, which boots straight into "Cannot find module
  // ... schemastery/lib/index.mjs".
  const problems = []
  if (!fs.existsSync(path.join(out, 'package.json'))) problems.push('package.json missing')
  const storeDir = path.join(out, 'node_modules', '.pnpm')
  if (!fs.existsSync(storeDir)) {
    problems.push('node_modules/.pnpm missing')
  } else {
    let entries = 0
    let missing = 0
    for (const entry of fs.readdirSync(storeDir)) {
      const entryNm = path.join(storeDir, entry, 'node_modules')
      if (!fs.existsSync(entryNm)) continue
      const names = fs.readdirSync(entryNm)
      for (const name of names) {
        const pkgDirs = name.startsWith('@')
          ? fs.readdirSync(path.join(entryNm, name)).map((sub) => path.join(entryNm, name, sub))
          : [path.join(entryNm, name)]
        for (const pkgDir of pkgDirs) {
          entries += 1
          if (!fs.existsSync(path.join(pkgDir, 'package.json'))) {
            missing += 1
            if (problems.length < 12) problems.push(`${entry} -> ${path.relative(entryNm, pkgDir)} missing package.json`)
          }
        }
      }
    }
    console.log(`checked ${entries} store packages, ${missing} incomplete`)
  }
  if (problems.length > 0) {
    console.error('materialize-workspace: INCOMPLETE COPY — refusing to ship a tree that cannot boot:')
    for (const p of problems) console.error('  -', p)
    process.exit(1)
  }
  console.log('materialized workspace at', out)
}

main().catch((e) => {
  console.error('materialize-workspace failed:', e)
  process.exit(1)
})
