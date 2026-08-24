/**
 * Replace dist/main/main.cjs inside an installed app.asar.
 * Usage: node scripts/patch-asar.cjs <path-to-app.asar> <path-to-new-main.cjs>
 */
const fs = require('node:fs')
const path = require('node:path')

// Locate @electron/asar from the workspace store.
const root = path.resolve(__dirname, '..', '..', '..')
const asarPath = fs.readdirSync(path.join(root, 'node_modules', '.pnpm'))
  .find(e => e.startsWith('@electron+asar@'))
if (!asarPath) { console.error('asar not found in store'); process.exit(2) }
const asar = require(path.join(root, 'node_modules', '.pnpm', asarPath, 'node_modules', '@electron', 'asar'))

const [asarFile, newMain] = process.argv.slice(2)
if (!asarFile || !newMain) { console.error('usage: patch-asar.cjs <app.asar> <main.cjs>'); process.exit(2) }
const absAsar = path.resolve(asarFile)
const absMain = path.resolve(newMain)
console.log('patching', absAsar, 'with', absMain)

async function main() {
  // Extract the archive to a temp dir, swap the file, repack.
  const tmp = path.join(path.dirname(absAsar), '.asar-patch-tmp')
  fs.rmSync(tmp, { recursive: true, force: true })
  await asar.extractAll(absAsar, tmp)
  const target = path.join(tmp, 'dist', 'main', 'main.cjs')
  fs.copyFileSync(absMain, target)
  fs.rmSync(absAsar)
  await asar.createPackage(tmp, absAsar)
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log('patched asar written to', absAsar)
}

main().catch((e) => { console.error('patch failed:', e); process.exit(1) })
