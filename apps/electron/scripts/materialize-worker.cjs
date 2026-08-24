/**
 * Worker for materialize-workspace.cjs. Reads a manifest (one
 * source\tdest pair per line, argv[2]) and copies each source with the
 * cycle-aware junction-resolving copier. Each worker owns a disjoint
 * destination subtree, so per-worker cycle detection is safe.
 */
const fs = require('node:fs')
const path = require('node:path')

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

const manifestFile = process.argv[2]
const lines = fs.readFileSync(manifestFile, 'utf8').split('\n').filter(Boolean)
const ancestors = new Set()
for (const line of lines) {
  const tab = line.indexOf('\t')
  if (tab < 0) continue
  const s = line.slice(0, tab)
  const d = line.slice(tab + 1)
  fs.mkdirSync(path.dirname(d), { recursive: true })
  copyDir(s, d, ancestors)
}
console.log(`worker done: ${lines.length} entries`)
