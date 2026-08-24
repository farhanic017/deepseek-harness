const fs = require('node:fs')
const path = require('node:path')

const mainPath = path.join(__dirname, '../dist/main/main.cjs')
let content = fs.readFileSync(mainPath, 'utf8')

// Fix the dirname issue by adding the require at the top
if (!content.includes("const dirname = require('node:path').dirname")) {
  content = content.replace(
    '//#region src/main/index.ts',
    "const dirname = require('node:path').dirname\n//#region src/main/index.ts"
  )
  fs.writeFileSync(mainPath, content)
  console.log('Fixed main.cjs: added dirname shim')
} else {
  console.log('main.cjs already fixed')
}