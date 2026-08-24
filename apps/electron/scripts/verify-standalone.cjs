/**
 * Headless standalone-boot verification. Mirrors src/main/index.ts exactly
 * (importWorkspace through the anchor, internal-loader shim, farm heal, web
 * profile, boot with --port 0) but against a deploy tree that lives outside
 * the checkout, proving the packaged app needs nothing from the source tree.
 * Usage: node scripts/verify-standalone.cjs <deployDir>
 */
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { createRequire } = require('node:module')
const { pathToFileURL, fileURLToPath } = require('node:url')

const deployDir = path.resolve(process.argv[2])
const ANCHOR = path.join(deployDir, 'package.json')
if (!fs.existsSync(ANCHOR)) {
  console.error(`no package.json at ${ANCHOR}`)
  process.exit(2)
}
console.log('anchor:', ANCHOR)

async function importWorkspace(spec) {
  const entry = createRequire(ANCHOR).resolve(spec)
  return await import(pathToFileURL(entry).href)
}

function createElectronInternalLoader() {
  return {
    version: 'v1',
    async import(specifier, parentURL) {
      const baseDir = path.dirname(fileURLToPath(parentURL))
      const requireFromBase = createRequire(path.join(baseDir, 'noop.js'))
      const resolved = requireFromBase.resolve(specifier)
      return await import(pathToFileURL(resolved).href)
    },
  }
}

/**
 * Materialize the dependency layout pnpm's regular install would have
 * produced. `pnpm deploy --legacy` ships a junction-heavy store whose
 * per-package node_modules and peer links are missing or dangling once the
 * tree is copied (absolute build-machine targets), so nothing resolves.
 * Pass 1 hoists every store package into the top-level node_modules; pass 2
 * links each package's declared deps (dependencies + peers + optionals) into
 * its own node_modules. Idempotent — existing (valid) links are kept.
 */
function linkBundledWorkspace(anchorDir, log = () => {}) {
  const storeDir = path.join(anchorDir, 'node_modules', '.pnpm')
  if (!fs.existsSync(storeDir)) { log('linkBundledWorkspace: no .pnpm store, skipping'); return 0 }
  const topDir = path.join(anchorDir, 'node_modules')
  const IS_WIN = process.platform === 'win32'
  let linked = 0
  let skipped = 0
  const ensureLink = (target, link) => {
    try {
      if (fs.existsSync(link)) { skipped += 1; return }
      fs.mkdirSync(path.dirname(link), { recursive: true })
      fs.symlinkSync(target, link, IS_WIN ? 'junction' : 'dir')
      linked += 1
    } catch (e) {
      log(`linkBundledWorkspace: link failed ${link} -> ${target}: ${e.code ?? e}`)
    }
  }
  const entries = []
  for (const entry of fs.readdirSync(storeDir)) {
    const entryNm = path.join(storeDir, entry, 'node_modules')
    if (!fs.existsSync(entryNm)) continue
    for (const name of fs.readdirSync(entryNm)) {
      if (name.startsWith('@')) {
        const scopeDir = path.join(entryNm, name)
        for (const sub of fs.readdirSync(scopeDir)) entries.push({ pkgDir: path.join(scopeDir, sub), rel: `${name}/${sub}` })
      } else {
        entries.push({ pkgDir: path.join(entryNm, name), rel: name })
      }
    }
  }
  // Pass 1: hoist every store package to the top level.
  for (const { pkgDir, rel } of entries) {
    if (!fs.existsSync(path.join(pkgDir, 'package.json'))) continue
    ensureLink(pkgDir, path.join(topDir, rel))
  }
  // Pass 2: each package's own node_modules gets every declared dep.
  for (const { pkgDir } of entries) {
    const mp = path.join(pkgDir, 'package.json')
    if (!fs.existsSync(mp)) continue
    let manifest
    try { manifest = JSON.parse(fs.readFileSync(mp, 'utf8')) } catch { continue }
    const deps = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.peerDependencies ?? {}),
      ...(manifest.optionalDependencies ?? {}),
    }
    const requireFromPkg = createRequire(mp)
    for (const dep of Object.keys(deps)) {
      const link = path.join(pkgDir, 'node_modules', dep)
      if (fs.existsSync(link)) { skipped += 1; continue }
      let resolved
      try { resolved = requireFromPkg.resolve(`${dep}/package.json`) } catch { continue }
      ensureLink(path.dirname(resolved), link)
    }
  }
  log(`linkBundledWorkspace: ${linked} linked, ${skipped} skipped`)
  return linked
}

async function main() {
  const home = path.join(os.tmpdir(), 'dsh-standalone-home')
  const profileDir = path.join(home, 'profiles', 'web')
  // Mirror the packaged main: materialize the dependency layout first.
  linkBundledWorkspace(deployDir, console.log)
  const appBoot = await importWorkspace('@deepseek-ai/dsh-app-boot')
  const { PROFILE_TEMPLATES, initProfile, loadProfile, healProfilesModuleFallback } = appBoot
  const webBundles = PROFILE_TEMPLATES.web ?? ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
  initProfile(profileDir, webBundles)
  healProfilesModuleFallback(ANCHOR, home)
  const rootConfigPath = path.join(profileDir, 'cordis.yml')
  fs.writeFileSync(rootConfigPath, '# standalone root\n[]\n')
  const profile = loadProfile('dsh', 'web', ANCHOR, home, { userLayer: true })
  const patches = [...profile.layers.flatMap((l) => l.patches), ...profile.patches]
  console.log('patches:', patches.length, 'layers:', profile.layers.map((l) => l.packageName).join(','))

  const { boot } = await importWorkspace('@deepseek-ai/dsh-app-boot')
  const { createLaunchEnvironmentSnapshot } = await importWorkspace('@deepseek-ai/dsh-launch-environment')
  const { provideCmdline } = await importWorkspace('@deepseek-ai/dsh-cmdline')

  const ctx = await boot('dsh', rootConfigPath, patches, async (c) => {
    const envSnapshot = createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env }])
    c.provide('launchEnvironment', envSnapshot)
    c.loader.internal = createElectronInternalLoader()
    provideCmdline(c, {
      args: ['--port', '0'],
      exit: (code) => process.exit(code),
    })
  })
  const port = ctx.webServer.port
  console.log('BOOT OK, webServer port:', port)

  const res = await fetch(`http://127.0.0.1:${port}/`)
  const html = await res.text()
  console.log('index status:', res.status, 'has __DSH_BOOT__:', html.includes('__DSH_BOOT__'), 'bytes:', html.length)
  const manifest = html.match(/__DSH_BOOT__=(\{.*?\})</)
  if (manifest) {
    const boot = JSON.parse(manifest[1].replace(/&quot;/g, '"'))
    console.log('manifest plugin entries:', Array.isArray(boot.plugins) ? boot.plugins.length : 'n/a')
  }
  ctx.fiber.dispose()
  console.log('DISPOSED OK')
  process.exit(0)
}

function dumpError(e, depth = 0, seen = new Set()) {
  if (e === null || typeof e !== 'object' || seen.has(e)) return
  seen.add(e)
  const pad = '  '.repeat(depth)
  const name = e.constructor?.name ?? 'Error'
  console.error(`${pad}${name}: ${e.message}`)
  if (e.errors !== undefined && Array.isArray(e.errors)) {
    for (const sub of e.errors) dumpError(sub, depth + 1, seen)
  }
  if (e.cause !== undefined) dumpError(e.cause, depth + 1, seen)
  if (e.stack !== undefined && depth === 0) console.error(e.stack)
}

main().catch((e) => {
  console.error('STANDALONE BOOT FAILED:')
  dumpError(e)
  process.exit(1)
})
