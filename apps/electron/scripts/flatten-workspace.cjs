/**
 * Build a self-contained, junction-free, short-path node_modules for the
 * packaged app, from the pnpm deploy tree.
 *
 * WHY NOT SHIP THE DEPLOY TREE: it is a pnpm store layout —
 * `node_modules/.pnpm/<name>@<hash>/node_modules/<name>` with per-package
 * nested deps as junctions. Combined with the Windows install dir
 * (`C:\Users\...\AppData\Local\Programs\DeepSeek Harness\resources\workspace\`)
 * those paths routinely exceed the 260-char MAX_PATH limit, and NSIS silently
 * DROPS such files during extraction (13k+ files in practice). Also, 7za
 * follows junctions and blows up compression, and junctions point to absolute
 * build-machine paths that break on other machines.
 *
 * HOW: build a conventional hoisted layout with real directories only,
 * mirroring the boot-time linkBundledWorkspace semantics exactly:
 *   - Pass 1 hoists ONE copy of every package to the top-level node_modules,
 *     preferring the exact version the ROOT manifest resolves (pnpm's public
 *     hoist pick), else the first store entry found.
 *   - Pass 2 gives EVERY store copy (all versions) its EXACT resolved dep
 *     versions by copying them into its `node_modules/<dep>`, resolving via
 *     the deploy tree's own junction targets (the authoritative per-consumer
 *     version map — e.g. chokidar 4.0.3 for one consumer, 5.0.0 for another).
 *     Non-hoisted versions are copied nested where a consumer references them.
 *     A recursion-stack guard breaks workspace peer cycles (cordis <-> include);
 *     cycle members still resolve via the hoisted copy.
 *
 * Every path in the output is short, there are no junctions, and the boot-time
 * linkBundledWorkspace becomes a no-op (no .pnpm store) — it stays for safety.
 *
 * Usage: node scripts/flatten-workspace.cjs
 */
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

const root = path.resolve(__dirname, '..')
const deployDir = path.join(root, 'deploy')      // source: pnpm deploy tree (junctions intact)
const storeDir = path.join(deployDir, 'node_modules', '.pnpm')
const out = path.join(root, 'dist', 'workspace') // output: flattened workspace
const outNm = path.join(out, 'node_modules')

if (!fs.existsSync(path.join(deployDir, 'package.json'))) {
  console.error(`flatten-workspace: no deploy tree at ${deployDir}`)
  process.exit(2)
}
if (!fs.existsSync(storeDir)) {
  console.error(`flatten-workspace: no .pnpm store at ${storeDir}`)
  process.exit(2)
}

// ---------------------------------------------------------------------------
// Index the deploy store: name -> copies [{ pkgDir, version }]
// ---------------------------------------------------------------------------
const storeIndex = new Map()
for (const entry of fs.readdirSync(storeDir)) {
  const entryNm = path.join(storeDir, entry, 'node_modules')
  if (!fs.existsSync(entryNm)) continue
  const add = (name, pkgDir) => {
    let manifest
    try { manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) } catch { return }
    if (!storeIndex.has(name)) storeIndex.set(name, [])
    storeIndex.get(name).push({ pkgDir, version: manifest.version ?? '0.0.0' })
  }
  for (const name of fs.readdirSync(entryNm)) {
    if (name.startsWith('@')) {
      const scopeDir = path.join(entryNm, name)
      try { for (const sub of fs.readdirSync(scopeDir)) add(`${name}/${sub}`, path.join(scopeDir, sub)) } catch { /* ignore */ }
    } else {
      add(name, path.join(entryNm, name))
    }
  }
}
console.log(`flatten-workspace: indexed ${storeIndex.size} package names`)

/** Resolve a dep for a consumer, using the deploy tree's junction first. */
function resolveDepFor(consumerPkgDir, depName) {
  const link = path.join(consumerPkgDir, 'node_modules', depName)
  try {
    if (fs.lstatSync(link).isSymbolicLink()) {
      const target = fs.realpathSync(link)
      if (fs.existsSync(path.join(target, 'package.json'))) return target
    }
  } catch { /* fall through */ }
  try {
    const req = createRequire(path.join(consumerPkgDir, 'package.json'))
    return path.dirname(req.resolve(`${depName}/package.json`))
  } catch { return null }
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name)
    const d = path.join(dest, e.name)
    if (e.isDirectory()) copyDir(s, d)
    else if (e.isFile()) fs.copyFileSync(s, d)
  }
}

// ---------------------------------------------------------------------------
// Determine hoist order: root manifest's exact dep versions first
// ---------------------------------------------------------------------------
const rootManifest = JSON.parse(fs.readFileSync(path.join(deployDir, 'package.json'), 'utf8'))
const rootDeps = { ...(rootManifest.dependencies ?? {}), ...(rootManifest.peerDependencies ?? {}) }
const rootResolved = new Map() // name -> exact pkgDir
for (const dep of Object.keys(rootDeps)) {
  const r = resolveDepFor(deployDir, dep)
  if (r) rootResolved.set(dep, r)
}
const hoistOrder = new Map() // name -> copies in hoist preference order
for (const [name, copies] of storeIndex) {
  const exact = rootResolved.get(name)
  if (exact) {
    const exactPkg = path.resolve(exact)
    const ordered = [...copies].sort((a, b) => {
      const aIs = path.resolve(a.pkgDir) === exactPkg ? 0 : 1
      const bIs = path.resolve(b.pkgDir) === exactPkg ? 0 : 1
      return aIs - bIs
    })
    hoistOrder.set(name, ordered)
  } else {
    hoistOrder.set(name, copies)
  }
}

// ---------------------------------------------------------------------------
// Pass 1: hoist one copy of every package to the top level
// ---------------------------------------------------------------------------
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(outNm, { recursive: true })

let hoisted = 0
let hoistSkipped = 0
const hoistedHome = new Map() // name -> out node_modules path for the hoisted copy
for (const [name, copies] of hoistOrder) {
  const dest = path.join(outNm, name)
  if (fs.existsSync(dest)) { hoistSkipped += 1; continue }
  copyDir(copies[0].pkgDir, dest)
  hoistedHome.set(name, dest)
  hoisted += 1
}
console.log(`flatten-workspace: hoisted ${hoisted} packages, ${hoistSkipped} skipped`)

// ---------------------------------------------------------------------------
// Pass 2: exact per-consumer deps, cycle-safe
// ---------------------------------------------------------------------------
const inStack = new Set()
let nested = 0

function copyPackageWithDeps(pkgDir, dest) {
  copyDir(pkgDir, dest)
  let manifest
  try { manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) } catch { return }
  const deps = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.peerDependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
  }
  for (const dep of Object.keys(deps)) {
    const depDest = path.join(dest, 'node_modules', dep)
    if (fs.existsSync(depDest)) continue
    const resolved = resolveDepFor(pkgDir, dep)
    if (!resolved) continue
    const real = (() => { try { return fs.realpathSync(resolved) } catch { return resolved } })()
    if (inStack.has(real)) continue
    inStack.add(real)
    try { copyPackageWithDeps(resolved, depDest); nested += 1 } finally { inStack.delete(real) }
  }
}

// Every store copy gets its exact deps where it lives.
for (const [name, copies] of storeIndex) {
  const home = hoistedHome.get(name)
  if (home) {
    // Hoisted copy: replicate its exact deps.
    copyPackageWithDeps(copies[0].pkgDir, home)
  } else {
    // Shouldn't happen (every name gets hoisted), but be safe.
    for (const c of copies) { /* non-hoisted copies are reached via consumers */ }
  }
}
console.log(`flatten-workspace: ${nested} nested exact-version deps copied`)

// ---------------------------------------------------------------------------
// Root package files (package.json + app files) — the boot anchor lives here
// ---------------------------------------------------------------------------
for (const name of fs.readdirSync(deployDir)) {
  if (name === 'node_modules') continue
  const s = path.join(deployDir, name)
  const d = path.join(out, name)
  if (fs.lstatSync(s).isDirectory()) copyDir(s, d)
  else fs.copyFileSync(s, d)
}

// Safety: ensure no junctions remain in the output.
let links = 0
function countLinks(d) {
  let ents
  try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    const p = path.join(d, e.name)
    if (e.isSymbolicLink()) links++
    else if (e.isDirectory()) countLinks(p)
  }
}
countLinks(outNm)
console.log(`flatten-workspace: workspace at ${out}; residual links: ${links}`)
