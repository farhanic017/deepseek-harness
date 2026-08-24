const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// Get the project root (parent of scripts folder)
const projectRoot = path.join(__dirname, '..')
const srcDir = path.join(projectRoot, 'node_modules')
const destDir = path.join(projectRoot, 'node_modules_resolved')

console.log('Resolving node_modules with robocopy...')

try {
  if (process.platform === 'win32') {
    // /E = copy subdirectories including empty ones
    // /COPY:DAT = copy Data, Attributes, Timestamps
    // /XD node_modules = exclude nested node_modules directories to avoid infinite recursion
    // /R:0 /W:0 = no retries on failures
    // Robocopy returns non-zero exit codes on success (bitmask), so we need to check stderr
    const result = execSync(`robocopy "${srcDir}" "${destDir}" /E /COPY:DAT /XD node_modules /R:0 /W:0`, { 
      stdio: 'pipe',
      cwd: projectRoot,
      encoding: 'utf8'
    })
    console.log(result)
  } else {
    // On non-Windows, use cp -rL to resolve symlinks
    execSync(`cp -rL "${srcDir}/" "${destDir}/"`, { 
      stdio: 'inherit',
      cwd: projectRoot
    })
    console.log('cp -rL completed successfully')
  }
} catch (error) {
  // Robocopy returns exit codes > 0 on success (bitmask), so we check if it actually copied files
  if (error.stdout && error.stdout.includes('Copied')) {
    console.log(error.stdout)
    console.log('Robocopy completed successfully')
  } else {
    console.error('Copy failed:', error.message)
    process.exit(1)
  }
}

console.log('Copied resolved node_modules to', destDir)