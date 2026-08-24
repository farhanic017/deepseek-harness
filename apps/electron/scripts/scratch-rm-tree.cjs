// Scratch helper: remove a directory tree iteratively (handles deep/long paths
// that rm -rf and fs.rmSync choke on). Usage: node scratch-rm-tree.cjs <dir>
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(process.argv[2])
if (!fs.existsSync(root)) {
  console.log('already gone:', root)
  process.exit(0)
}
const stack = [{ dir: root, phase: 0 }]
let dirs = 0
let files = 0
while (stack.length > 0) {
  const top = stack[stack.length - 1]
  if (top.phase === 0) {
    top.phase = 1
    let entries
    try {
      entries = fs.readdirSync(top.dir, { withFileTypes: true })
    } catch {
      stack.pop()
      continue
    }
    for (const entry of entries) {
      const p = path.join(top.dir, entry.name)
      if (entry.isDirectory()) {
        stack.push({ dir: p, phase: 0 })
      } else {
        try {
          fs.unlinkSync(p)
          files += 1
        } catch {
          /* locked or vanished mid-walk */
        }
      }
    }
  } else {
    try {
      fs.rmdirSync(top.dir)
      dirs += 1
    } catch {
      /* not empty yet (locked) or vanished */
    }
    stack.pop()
  }
}
console.log(`scratch-rm-tree done: ${dirs} dirs, ${files} files, exists=${fs.existsSync(root)}`)
