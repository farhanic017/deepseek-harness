import { app, BrowserWindow, ipcMain, shell, dialog, Menu, nativeImage } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { writeFileSync, existsSync, appendFileSync, mkdirSync, symlinkSync, readdirSync, readFileSync, accessSync, lstatSync, unlinkSync, realpathSync } from 'node:fs'

const require = createRequire(import.meta.url)
const path = require('node:path')
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// app.isPackaged is the canonical Electron check; NODE_ENV alone is unreliable
// because `electron .` from a checkout does not set it.
const IS_DEV = process.env.NODE_ENV === 'development' || !app.isPackaged
const IS_MAC = process.platform === 'darwin'

// In production, the app runs from inside app.asar
const IS_PACKAGED = __dirname.includes('app.asar')

// Log file for debugging
const logFile = path.join(app.getPath('userData'), 'electron-main.log')
const log = (msg: string) => {
  const timestamp = new Date().toISOString()
  appendFileSync(logFile, `[${timestamp}] ${msg}\n`)
}
log('=== Electron main process starting ===')
log(`IS_DEV: ${IS_DEV}, IS_PACKAGED: ${IS_PACKAGED}, __dirname: ${__dirname}`)

// App icon
const getIconPath = (): string => {
  if (IS_DEV) {
    return path.join(__dirname, '../../resources/icon.png')
  }
  return path.join(process.resourcesPath, 'icon.png')
}
const appIcon = nativeImage.createFromPath(getIconPath())

// DSH home directory (profiles, sessions, credentials, settings live here)
const getDshHome = (): string => {
  return path.resolve(app.getPath('userData'))
}

// Profile constants
const PROFILE_ROOT_FILENAME = 'cordis.yml'
const PROFILE_NAME = 'web'

/**
 * Whether a directory owns a resolvable dsh-app-boot, either through a
 * top-level `node_modules/@deepseek-ai/dsh-app-boot` link (normal installs
 * and materialized trees) or through a pnpm store entry (a junction-free
 * `deploy` copy whose links the boot-time linker recreates).
 * @param dir - candidate install anchor directory.
 * @returns true when the directory can satisfy a boot.
 */
function ownsAppBoot(dir: string): boolean {
  if (existsSync(path.join(dir, 'node_modules', '@deepseek-ai', 'dsh-app-boot'))) return true
  const storeDir = path.join(dir, 'node_modules', '.pnpm')
  if (!existsSync(storeDir)) return false
  try {
    return readdirSync(storeDir).some(entry => entry.startsWith('@deepseek-ai+dsh-app-boot@'))
  } catch {
    return false
  }
}

/**
 * Find the directory that owns a resolvable `node_modules` for this app, in
 * order of preference:
 *
 * 1. The bundled standalone workspace at `<resources>/workspace` — the
 *    self-contained `pnpm deploy` tree shipped with the packaged app. A
 *    standalone install (no checkout on disk) resolves every package from
 *    here.
 * 2. The nearest ancestor (walking up from the bundled main) whose
 *    `node_modules/@deepseek-ai/dsh-app-boot` exists on the real filesystem
 *    — the source checkout (`apps/electron`) or a win-unpacked build that
 *    sits inside a checkout.
 *
 * Directories inside the asar are skipped: electron-builder's own workspace
 * copy is partial (it carries direct deps but not the transitive/peer
 * closure), so it can never satisfy a boot.
 * @returns the absolute anchor directory.
 */
function findInstallAnchorDir(): string {
  // Standalone packaged install: the shipped workspace tree.
  const bundledWorkspace = path.join(process.resourcesPath, 'workspace')
  if (ownsAppBoot(bundledWorkspace)) {
    return bundledWorkspace
  }
  let dir = __dirname
  for (let i = 0; i < 16; i += 1) {
    if (!dir.includes('app.asar') && ownsAppBoot(dir)) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // Fallback: assume the bundled main sits in <app>/dist/main (source layout).
  return IS_PACKAGED ? path.dirname(path.dirname(path.dirname(__dirname))) : path.resolve(__dirname, '../..')
}

/** Absolute path of this app's package.json (the profile boot install anchor). */
const installAnchor = path.join(findInstallAnchorDir(), 'package.json')

log(`Install anchor: ${installAnchor}`)

// A standalone install resolves from the bundled deploy tree. Materialize it
// BEFORE the first importWorkspace: the junction-free /XJ copy used by
// packaging has no top-level node_modules links, so bare specifiers cannot
// resolve until the linker recreates them from the .pnpm store.
if (installAnchor.startsWith(path.join(process.resourcesPath, 'workspace'))) {
  linkBundledWorkspace(path.dirname(installAnchor))
}

/**
 * Import a workspace package through the anchor's node_modules (works when
 * the app runs packaged but from inside a checkout whose real packages live
 * on disk), falling back to bare specifier resolution for a source run.
 * @param spec - the package name.
 * @returns the imported module namespace.
 */
async function importWorkspace(spec: string): Promise<any> {
  try {
    const entry = createRequire(installAnchor).resolve(spec)
    log(`Resolved ${spec} via anchor: ${entry}`)
    return await import(pathToFileURL(entry).href)
  } catch (error) {
    log(`Anchor resolution failed for ${spec}, falling back to bare import: ${error}`)
    return await import(spec)
  }
}

// Initialize and load the web profile (the supported browser surface: base +
// web-app bundles compose the HTTP server, API gateway, client-module serving,
// and the UI plugin roster — the same stack `dsh web` runs).

/**
 * Materialize the dependency layout pnpm's regular install would have
 * produced inside a bundled standalone workspace. `pnpm deploy --legacy`
 * ships a junction-heavy store whose per-package node_modules and peer links
 * are missing once the tree is copied, so nothing resolves. Pass 1 hoists
 * every store package into the top-level node_modules; pass 2 links each
 * package's declared deps (dependencies + peers + optionals) into its own
 * node_modules. Idempotent — existing (valid) links are kept.
 * @param anchorDir - the standalone workspace directory (owns node_modules).
 * @returns the number of links created.
 */
function linkBundledWorkspace(anchorDir: string): number {
  const storeDir = path.join(anchorDir, 'node_modules', '.pnpm')
  if (!existsSync(storeDir)) { log('linkBundledWorkspace: no .pnpm store, skipping'); return 0 }
  const topDir = path.join(anchorDir, 'node_modules')
  const IS_WIN = process.platform === 'win32'
  let linked = 0
  let skipped = 0
  const anchorResolved = path.resolve(anchorDir)
  const ensureLink = (target: string, link: string): void => {
    try {
      // A surviving junction is fine ONLY when it still resolves AND points
      // inside this bundled tree (build-machine paths to the original deploy
      // dir must be re-pointed so the packaged app is self-contained).
      let keep = false
      try {
        accessSync(link)
        keep = path.resolve(realpathSync(link)).startsWith(anchorResolved + path.sep)
      } catch {
        // Broken or missing — fall through to (re)create.
      }
      if (keep) { skipped += 1; return }
      // Remove a stale junction/symlink in the way before recreating.
      try {
        if (lstatSync(link).isSymbolicLink()) unlinkSync(link)
      } catch { /* not a link or already gone */ }
      mkdirSync(path.dirname(link), { recursive: true })
      symlinkSync(target, link, IS_WIN ? 'junction' : 'dir')
      linked += 1
    } catch (e) {
      log(`linkBundledWorkspace: link failed ${link} -> ${target}: ${(e as NodeJS.ErrnoException).code ?? e}`)
    }
  }
  const entries: Array<{ pkgDir: string; rel: string }> = []
  for (const entry of readdirSync(storeDir)) {
    const entryNm = path.join(storeDir, entry, 'node_modules')
    if (!existsSync(entryNm)) continue
    for (const name of readdirSync(entryNm)) {
      if (name.startsWith('@')) {
        const scopeDir = path.join(entryNm, name)
        for (const sub of readdirSync(scopeDir)) entries.push({ pkgDir: path.join(scopeDir, sub), rel: `${name}/${sub}` })
      } else {
        entries.push({ pkgDir: path.join(entryNm, name), rel: name })
      }
    }
  }
  // Pass 1: hoist every store package to the top level.
  for (const { pkgDir, rel } of entries) {
    if (!existsSync(path.join(pkgDir, 'package.json'))) continue
    ensureLink(pkgDir, path.join(topDir, rel))
  }
  // Pass 2: each package's own node_modules gets every declared dep.
  for (const { pkgDir } of entries) {
    const mp = path.join(pkgDir, 'package.json')
    if (!existsSync(mp)) continue
    let manifest: any
    try { manifest = JSON.parse(readFileSync(mp, 'utf8')) } catch { continue }
    const deps = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.peerDependencies ?? {}),
      ...(manifest.optionalDependencies ?? {}),
    }
    const requireFromPkg = createRequire(mp)
    for (const dep of Object.keys(deps)) {
      const link = path.join(pkgDir, 'node_modules', dep)
      if (existsSync(link)) { skipped += 1; continue }
      let resolved: string
      try { resolved = requireFromPkg.resolve(`${dep}/package.json`) } catch { continue }
      ensureLink(path.dirname(resolved), link)
    }
  }
  log(`linkBundledWorkspace: ${linked} linked, ${skipped} skipped`)
  return linked
}

/**
 * Provide the loader's `internal` module transport when the vendored Loader's
 * native one is unavailable. The vendored `node-addon-require-builtin` helper
 * exposes Node's internal ESM loader from the main process; under Electron the
 * addon's native ABI does not match Electron's embedded Node, so
 * `ModuleLoader.fromInternal()` returns undefined and the Loader then resolves
 * bare plugin specifiers relative to its own module — which misses the profile
 * node_modules farm. This shim resolves bare specifiers against the profile
 * directory (where healProfilesModuleFallback links the whole dependency
 * closure) using ordinary Node resolution, then loads through the standard
 * ESM machinery — the same semantics the native internal loader provides.
 * Only `import(specifier, parentURL)` is used by the vendored Include; no
 * other internal surface is touched.
 * @returns the internal-loader shim.
 */
function createElectronInternalLoader(): any {
  return {
    version: 'v1',
    async import(specifier: string, parentURL: string): Promise<any> {
      const baseDir = path.dirname(fileURLToPath(parentURL))
      const requireFromBase = createRequire(path.join(baseDir, 'noop.js'))
      const resolved = requireFromBase.resolve(specifier)
      return await import(pathToFileURL(resolved).href)
    },
  }
}
async function initializeWebProfile(): Promise<{ profileDir: string; patches: any[]; rootConfigPath: string }> {
  const dshHome = getDshHome()
  const profileDir = path.join(dshHome, 'profiles', PROFILE_NAME)

  log(`DSH Home: ${dshHome}`)
  log(`Profile dir: ${profileDir}`)

  const appBoot = await importWorkspace('@deepseek-ai/dsh-app-boot')
  const { PROFILE_TEMPLATES, initProfile, loadProfile, healProfilesModuleFallback, composeEntries } = appBoot
  const webBundles = PROFILE_TEMPLATES.web ?? ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
  log(`Initializing profile with bundles: ${webBundles.join(', ')}`)
  initProfile(profileDir, webBundles)

  // Link every package in the app's dependency closure into
  // $DSH_HOME/profiles/node_modules so the Loader (whose baseUrl is the
  // profile directory) can resolve bare plugin specifiers. This is the same
  // step the dsh CLI performs before boot; without it the profile has no
  // resolvable plugins and boot fails before the server can start.
  healProfilesModuleFallback(installAnchor, dshHome)

  // Create cordis.yml root config — a bare entry list, the same root the CLI
  // boots (the whole composition arrives as patches).
  const rootConfigPath = path.join(profileDir, PROFILE_ROOT_FILENAME)
  const rootConfig = `# dsh profile root — an empty entry list. The tree is composed as patches:\n# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any\n# --patch overlays. Edit cordis.patch.yml, not this file.\n[]\n`
  writeFileSync(rootConfigPath, rootConfig)

  // Load the profile to get composed patches
  const profile = loadProfile('dsh', PROFILE_NAME, installAnchor, dshHome, { userLayer: true })
  const bundlePatches = profile.layers.flatMap((l: { patches: any[] }) => l.patches)
  const allPatches = [...bundlePatches, ...profile.patches]

  // The shipped agent-preset root is app-owned — the same contract as the dsh
  // CLI, which appends its own config dir as the system root. Without it the
  // preset roster is empty and session creation fails with
  // agent-preset-not-found, which blocks adopting a picked workspace and
  // leaves the composer disabled. Only the app knows where its config sits,
  // so this overlay is assembled here, after the composition.
  const overlays: any[] = []
  const composed = composeEntries([...bundlePatches, ...profile.patches])
  const presetRow = composed.find((r: any) => typeof r.id === 'string' && r.id === 'agent-presets')
  if (presetRow !== undefined) {
    // Standalone install: the presets ship beside the workspace tree. Source
    // checkout: they live in apps/cli/config/agent-presets.
    const standalonePresetRoot = path.join(process.resourcesPath, 'workspace', 'config-agent-presets')
    const checkoutPresetRoot = path.resolve(path.dirname(installAnchor), '..', 'cli', 'config', 'agent-presets')
    const shippedPresetRoot = existsSync(standalonePresetRoot) ? standalonePresetRoot : checkoutPresetRoot
    if (existsSync(shippedPresetRoot)) {
      overlays.push({
        id: 'agent-presets',
        config: {
          ...((presetRow.config ?? {}) as Record<string, unknown>),
          roots: [{ path: shippedPresetRoot, trust: 'system' }],
        },
      })
      log(`Agent presets shipped root: ${shippedPresetRoot}`)
    } else {
      log(`No shipped agent presets at ${shippedPresetRoot}; preset roster will be empty`)
    }
  }

  log(`Loaded profile with ${profile.layers.length} bundle layers and ${profile.patches.length} user patches`)
  log(`Total patches: ${allPatches.length + overlays.length}`)

  return { profileDir, patches: [...allPatches, ...overlays], rootConfigPath }
}

let mainWindow: BrowserWindow | null = null
let dshContext: any = null
let appUrl: string | undefined

const LOADING_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>DeepSeek Harness</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 100%; height: 100%; background: #1a1a2e; color: #e4e4e7;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; }
      body { display: flex; align-items: center; justify-content: center; }
      .loading { display: flex; flex-direction: column; align-items: center; gap: 16px; color: #00d4aa; }
      .loading-spinner { width: 48px; height: 48px; border: 3px solid #16213e; border-top-color: #00d4aa;
        border-radius: 50%; animation: spin 1s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
  </head>
  <body>
    <div class="loading">
      <div class="loading-spinner"></div>
      <span>Starting DeepSeek Harness...</span>
    </div>
  </body>
</html>`

const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')

const errorPage = (title: string, message: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 100%; height: 100%; background: #1a1a2e; color: #e4e4e7;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; }
      body { display: flex; align-items: center; justify-content: center; padding: 40px; }
      .error { max-width: 640px; text-align: left; }
      h1 { color: #f87171; font-size: 18px; margin-bottom: 12px; }
      pre { background: #16213e; padding: 16px; border-radius: 8px; white-space: pre-wrap;
        word-break: break-word; font-size: 12px; line-height: 1.5; color: #cbd5e1; }
      p { margin-top: 12px; font-size: 13px; color: #94a3b8; }
    </style>
  </head>
  <body>
    <div class="error">
      <h1>${escapeHtml(title)}</h1>
      <pre>${escapeHtml(message)}</pre>
      <p>Details are also logged to: ${escapeHtml(logFile)}</p>
    </div>
  </body>
</html>`

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    icon: appIcon,
    title: 'DeepSeek Harness',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // The bundled preload is emitted as a CJS entry plus a shared chunk
      // (tsdown splits shared modules), and sandboxed preloads cannot follow
      // `require('./chunk-*.cjs')` — the script then fails to load and
      // Electron kills the renderer. Unsandboxed, the preload keeps the
      // contextIsolation boundary (it only exposes electronAPI to the page).
      sandbox: false,
      webSecurity: !IS_DEV,
      allowRunningInsecureContent: false,
    },
  })

  // Never show a blank page: render the loading state while the backend
  // boots, then swap to the app URL once the server is listening.
  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(LOADING_PAGE))

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    if (IS_DEV) {
      mainWindow?.webContents.openDevTools()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  createMenu()
}

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(IS_MAC ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ] as Electron.MenuItemConstructorOptions[],
    }] : []),
    {
      label: 'File',
      submenu: [
        IS_MAC ? { role: 'close' as const } : { role: 'quit' as const },
      ] as Electron.MenuItemConstructorOptions[],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        ...(IS_MAC ? [
          { role: 'pasteAndMatchStyle' as const },
          { role: 'delete' as const },
          { type: 'separator' },
          { label: 'Select All', role: 'selectAll' as const },
        ] as Electron.MenuItemConstructorOptions[] : [
          { role: 'delete' as const },
          { type: 'separator' },
          { role: 'selectAll' as const },
        ] as Electron.MenuItemConstructorOptions[]),
      ] as Electron.MenuItemConstructorOptions[],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' },
        { role: 'togglefullscreen' as const },
      ] as Electron.MenuItemConstructorOptions[],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        ...(IS_MAC ? [
          { role: 'zoom' as const },
          { type: 'separator' },
          { role: 'front' as const },
          { type: 'separator' },
          { role: 'window' as const },
        ] as Electron.MenuItemConstructorOptions[] : [
          { role: 'close' as const },
        ] as Electron.MenuItemConstructorOptions[]),
      ] as Electron.MenuItemConstructorOptions[]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: () => shell.openExternal('https://github.com/deepseek-ai/deepseek-harness'),
        },
        {
          label: 'Report Issue',
          click: () => shell.openExternal('https://github.com/deepseek-ai/deepseek-harness/issues'),
        },
        { type: 'separator' },
        {
          label: 'About DeepSeek Harness',
          click: () => dialog.showMessageBox(mainWindow!, {
            type: 'info',
            title: 'About DeepSeek Harness',
            message: 'DeepSeek Harness',
            detail: `Version ${app.getVersion()}\nElectron ${process.versions.electron}\nNode ${process.versions.node}`,
            icon: appIcon,
          }),
        },
      ] as Electron.MenuItemConstructorOptions[],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

async function startDshBackendAndOpenWindow(): Promise<void> {
  try {
    const { patches, rootConfigPath } = await initializeWebProfile()

    log(`Booting DSH with root config: ${rootConfigPath}`)

    // Boot the DSH context - use dynamic imports to avoid TS issues
    const { boot } = await importWorkspace('@deepseek-ai/dsh-app-boot')
    const { createLaunchEnvironmentSnapshot } = await importWorkspace('@deepseek-ai/dsh-launch-environment')
    const { provideCmdline } = await importWorkspace('@deepseek-ai/dsh-cmdline')

    dshContext = await boot('dsh', rootConfigPath, patches, async (ctx: any) => {
      // Provide the launch environment
      const envSnapshot = createLaunchEnvironmentSnapshot([
        { source: 'process', values: process.env as Record<string, string> }
      ])
      ctx.provide('launchEnvironment', envSnapshot)
      // Restore bare-specifier resolution under Electron (see
      // createElectronInternalLoader); must be set before the root include
      // mounts, which the prepare hook guarantees.
      ctx.loader.internal = createElectronInternalLoader()
      // The web-app startup row requires the launcher's command line; port 0
      // asks the OS for a free port so the desktop app never collides with a
      // concurrently running `dsh web`.
      provideCmdline(ctx, {
        args: ['--port', '0'],
        exit: (code: number) => {
          if (code === 0) {
            app.quit()
          } else {
            app.exit(code)
          }
        },
      })
    })

    log('DSH boot completed successfully')

    const port = dshContext.webServer?.port
    if (typeof port !== 'number') {
      throw new Error('DSH booted but no webServer port is available')
    }
    log(`Web server listening on 127.0.0.1:${port}`)

    appUrl = `http://127.0.0.1:${port}`
    if (mainWindow) {
      mainWindow.loadURL(appUrl)
    }
  } catch (err) {
    log(`Failed to start DSH backend: ${err}`)
    if (err instanceof Error) {
      log(`Stack: ${err.stack}`)
    }
    const message = err instanceof Error ? err.stack ?? err.message : String(err)
    if (mainWindow) {
      mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
        errorPage('DeepSeek Harness failed to start', message)
      ))
    }
  }
}

function stopDshBackend(): void {
  if (dshContext) {
    dshContext.fiber.dispose()
    dshContext = null
  }
}

app.whenReady().then(async () => {
  createWindow()
  await startDshBackendAndOpenWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      // The backend is still running (window-all-closed does not quit on
      // macOS); point the fresh window straight at the app URL instead of
      // leaving it on the loading page.
      if (appUrl !== undefined) {
        mainWindow?.loadURL(appUrl)
      }
    }
  })
})

app.on('window-all-closed', () => {
  stopDshBackend()
  if (!IS_MAC) {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopDshBackend()
})

ipcMain.handle('dsh:get-port', () => 0)

ipcMain.handle('dialog:open-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
  })
  return result.filePaths[0]
})

ipcMain.handle('dialog:save-file', async (_event, options: Electron.SaveDialogOptions) => {
  const result = await dialog.showSaveDialog(mainWindow!, options)
  return result.filePath
})

ipcMain.handle('shell:open-external', async (_event, url: string) => {
  await shell.openExternal(url)
})

ipcMain.handle('app:get-version', () => app.getVersion())

ipcMain.handle('app:get-path', (_event, name: string) => {
  return app.getPath(name as any)
})

// Menu actions — the custom renderer menu bar dispatches these via IPC.
ipcMain.on('menu:action', (_event, action: string) => {
  const wc = mainWindow?.webContents
  if (!wc) return
  switch (action) {
    case 'reload': wc.reload(); break
    case 'forceReload': wc.reloadIgnoringCache(); break
    case 'toggleDevTools': wc.toggleDevTools(); break
    case 'zoomIn': wc.setZoomLevel(wc.zoomLevel + 0.5); break
    case 'zoomOut': wc.setZoomLevel(wc.zoomLevel - 0.5); break
    case 'resetZoom': wc.setZoomLevel(0); break
    case 'toggleFullscreen': mainWindow?.setFullScreen(!mainWindow.isFullScreen()); break
    case 'minimize': mainWindow?.minimize(); break
    case 'close': mainWindow?.close(); break
    case 'quit': app.quit(); break
    case 'about': {
      dialog.showMessageBox(mainWindow!, {
        type: 'info',
        title: 'About DeepSeek Harness',
        message: 'DeepSeek Harness',
        detail: `Version ${app.getVersion()}\nElectron ${process.versions.electron}\nNode ${process.versions.node}`,
        icon: appIcon,
      }); break
    }
    case 'documentation': shell.openExternal('https://github.com/deepseek-ai/deepseek-harness'); break
    case 'reportIssue': shell.openExternal('https://github.com/deepseek-ai/deepseek-harness/issues'); break
  }
})
