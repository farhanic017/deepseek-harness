let electron = require("electron");
let node_url = require("node:url");
let node_module = require("node:module");
let node_fs = require("node:fs");
//#region src/main/index.ts
const path = (0, node_module.createRequire)(require("url").pathToFileURL(__filename).href)("node:path");
const __dirname$1 = path.dirname((0, node_url.fileURLToPath)(require("url").pathToFileURL(__filename).href));
const IS_DEV = process.env.NODE_ENV === "development" || !electron.app.isPackaged;
const IS_MAC = process.platform === "darwin";
const IS_PACKAGED = __dirname$1.includes("app.asar");
const logFile = path.join(electron.app.getPath("userData"), "electron-main.log");
const log = (msg) => {
	(0, node_fs.appendFileSync)(logFile, `[${(/* @__PURE__ */ new Date()).toISOString()}] ${msg}\n`);
};
log("=== Electron main process starting ===");
log(`IS_DEV: ${IS_DEV}, IS_PACKAGED: ${IS_PACKAGED}, __dirname: ${__dirname$1}`);
const getIconPath = () => {
	if (IS_DEV) return path.join(__dirname$1, "../../resources/icon.png");
	return path.join(process.resourcesPath, "icon.png");
};
const appIcon = electron.nativeImage.createFromPath(getIconPath());
const getDshHome = () => {
	return path.resolve(electron.app.getPath("userData"));
};
const PROFILE_ROOT_FILENAME = "cordis.yml";
const PROFILE_NAME = "web";
/**
* Whether a directory owns a resolvable dsh-app-boot, either through a
* top-level `node_modules/@deepseek-ai/dsh-app-boot` link (normal installs
* and materialized trees) or through a pnpm store entry (a junction-free
* `deploy` copy whose links the boot-time linker recreates).
* @param dir - candidate install anchor directory.
* @returns true when the directory can satisfy a boot.
*/
function ownsAppBoot(dir) {
	if ((0, node_fs.existsSync)(path.join(dir, "node_modules", "@deepseek-ai", "dsh-app-boot"))) return true;
	const storeDir = path.join(dir, "node_modules", ".pnpm");
	if (!(0, node_fs.existsSync)(storeDir)) return false;
	try {
		return (0, node_fs.readdirSync)(storeDir).some((entry) => entry.startsWith("@deepseek-ai+dsh-app-boot@"));
	} catch {
		return false;
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
function findInstallAnchorDir() {
	const bundledWorkspace = path.join(process.resourcesPath, "workspace");
	if (ownsAppBoot(bundledWorkspace)) return bundledWorkspace;
	let dir = __dirname$1;
	for (let i = 0; i < 16; i += 1) {
		if (!dir.includes("app.asar") && ownsAppBoot(dir)) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return IS_PACKAGED ? path.dirname(path.dirname(path.dirname(__dirname$1))) : path.resolve(__dirname$1, "../..");
}
/** Absolute path of this app's package.json (the profile boot install anchor). */
const installAnchor = path.join(findInstallAnchorDir(), "package.json");
log(`Install anchor: ${installAnchor}`);
if (installAnchor.startsWith(path.join(process.resourcesPath, "workspace"))) linkBundledWorkspace(path.dirname(installAnchor));
/**
* Import a workspace package through the anchor's node_modules (works when
* the app runs packaged but from inside a checkout whose real packages live
* on disk), falling back to bare specifier resolution for a source run.
* @param spec - the package name.
* @returns the imported module namespace.
*/
async function importWorkspace(spec) {
	try {
		const entry = (0, node_module.createRequire)(installAnchor).resolve(spec);
		log(`Resolved ${spec} via anchor: ${entry}`);
		return await import((0, node_url.pathToFileURL)(entry).href);
	} catch (error) {
		log(`Anchor resolution failed for ${spec}, falling back to bare import: ${error}`);
		return await import(spec);
	}
}
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
function linkBundledWorkspace(anchorDir) {
	const storeDir = path.join(anchorDir, "node_modules", ".pnpm");
	if (!(0, node_fs.existsSync)(storeDir)) {
		log("linkBundledWorkspace: no .pnpm store, skipping");
		return 0;
	}
	const topDir = path.join(anchorDir, "node_modules");
	const IS_WIN = process.platform === "win32";
	let linked = 0;
	let skipped = 0;
	const anchorResolved = path.resolve(anchorDir);
	const ensureLink = (target, link) => {
		try {
			let keep = false;
			try {
				(0, node_fs.accessSync)(link);
				keep = path.resolve((0, node_fs.realpathSync)(link)).startsWith(anchorResolved + path.sep);
			} catch {}
			if (keep) {
				skipped += 1;
				return;
			}
			try {
				if ((0, node_fs.lstatSync)(link).isSymbolicLink()) (0, node_fs.unlinkSync)(link);
			} catch {}
			(0, node_fs.mkdirSync)(path.dirname(link), { recursive: true });
			(0, node_fs.symlinkSync)(target, link, IS_WIN ? "junction" : "dir");
			linked += 1;
		} catch (e) {
			log(`linkBundledWorkspace: link failed ${link} -> ${target}: ${e.code ?? e}`);
		}
	};
	const entries = [];
	for (const entry of (0, node_fs.readdirSync)(storeDir)) {
		const entryNm = path.join(storeDir, entry, "node_modules");
		if (!(0, node_fs.existsSync)(entryNm)) continue;
		for (const name of (0, node_fs.readdirSync)(entryNm)) if (name.startsWith("@")) {
			const scopeDir = path.join(entryNm, name);
			for (const sub of (0, node_fs.readdirSync)(scopeDir)) entries.push({
				pkgDir: path.join(scopeDir, sub),
				rel: `${name}/${sub}`
			});
		} else entries.push({
			pkgDir: path.join(entryNm, name),
			rel: name
		});
	}
	for (const { pkgDir, rel } of entries) {
		if (!(0, node_fs.existsSync)(path.join(pkgDir, "package.json"))) continue;
		ensureLink(pkgDir, path.join(topDir, rel));
	}
	for (const { pkgDir } of entries) {
		const mp = path.join(pkgDir, "package.json");
		if (!(0, node_fs.existsSync)(mp)) continue;
		let manifest;
		try {
			manifest = JSON.parse((0, node_fs.readFileSync)(mp, "utf8"));
		} catch {
			continue;
		}
		const deps = {
			...manifest.dependencies ?? {},
			...manifest.peerDependencies ?? {},
			...manifest.optionalDependencies ?? {}
		};
		const requireFromPkg = (0, node_module.createRequire)(mp);
		for (const dep of Object.keys(deps)) {
			const link = path.join(pkgDir, "node_modules", dep);
			if ((0, node_fs.existsSync)(link)) {
				skipped += 1;
				continue;
			}
			let resolved;
			try {
				resolved = requireFromPkg.resolve(`${dep}/package.json`);
			} catch {
				continue;
			}
			ensureLink(path.dirname(resolved), link);
		}
	}
	log(`linkBundledWorkspace: ${linked} linked, ${skipped} skipped`);
	return linked;
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
function createElectronInternalLoader() {
	return {
		version: "v1",
		async import(specifier, parentURL) {
			const baseDir = path.dirname((0, node_url.fileURLToPath)(parentURL));
			return await import((0, node_url.pathToFileURL)((0, node_module.createRequire)(path.join(baseDir, "noop.js")).resolve(specifier)).href);
		}
	};
}
async function initializeWebProfile() {
	const dshHome = getDshHome();
	const profileDir = path.join(dshHome, "profiles", PROFILE_NAME);
	log(`DSH Home: ${dshHome}`);
	log(`Profile dir: ${profileDir}`);
	const { PROFILE_TEMPLATES, initProfile, loadProfile, healProfilesModuleFallback, composeEntries } = await importWorkspace("@deepseek-ai/dsh-app-boot");
	const webBundles = PROFILE_TEMPLATES.web ?? ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"];
	log(`Initializing profile with bundles: ${webBundles.join(", ")}`);
	initProfile(profileDir, webBundles);
	healProfilesModuleFallback(installAnchor, dshHome);
	const rootConfigPath = path.join(profileDir, PROFILE_ROOT_FILENAME);
	(0, node_fs.writeFileSync)(rootConfigPath, `# dsh profile root — an empty entry list. The tree is composed as patches:\n# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any\n# --patch overlays. Edit cordis.patch.yml, not this file.\n[]\n`);
	const profile = loadProfile("dsh", PROFILE_NAME, installAnchor, dshHome, { userLayer: true });
	const bundlePatches = profile.layers.flatMap((l) => l.patches);
	const allPatches = [...bundlePatches, ...profile.patches];
	const overlays = [];
	const presetRow = composeEntries([...bundlePatches, ...profile.patches]).find((r) => typeof r.id === "string" && r.id === "agent-presets");
	if (presetRow !== void 0) {
		const standalonePresetRoot = path.join(process.resourcesPath, "workspace", "config-agent-presets");
		const checkoutPresetRoot = path.resolve(path.dirname(installAnchor), "..", "cli", "config", "agent-presets");
		const shippedPresetRoot = (0, node_fs.existsSync)(standalonePresetRoot) ? standalonePresetRoot : checkoutPresetRoot;
		if ((0, node_fs.existsSync)(shippedPresetRoot)) {
			overlays.push({
				id: "agent-presets",
				config: {
					...presetRow.config ?? {},
					roots: [{
						path: shippedPresetRoot,
						trust: "system"
					}]
				}
			});
			log(`Agent presets shipped root: ${shippedPresetRoot}`);
		} else log(`No shipped agent presets at ${shippedPresetRoot}; preset roster will be empty`);
	}
	log(`Loaded profile with ${profile.layers.length} bundle layers and ${profile.patches.length} user patches`);
	log(`Total patches: ${allPatches.length + overlays.length}`);
	return {
		profileDir,
		patches: [...allPatches, ...overlays],
		rootConfigPath
	};
}
let mainWindow = null;
let dshContext = null;
let appUrl;
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
</html>`;
const escapeHtml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const errorPage = (title, message) => `<!doctype html>
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
</html>`;
function createWindow() {
	mainWindow = new electron.BrowserWindow({
		width: 1400,
		height: 900,
		minWidth: 1e3,
		minHeight: 700,
		icon: appIcon,
		title: "DeepSeek Harness",
		show: false,
		autoHideMenuBar: true,
		backgroundColor: "#1a1a2e",
		webPreferences: {
			preload: path.join(__dirname$1, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
			webSecurity: !IS_DEV,
			allowRunningInsecureContent: false
		}
	});
	mainWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(LOADING_PAGE));
	mainWindow.once("ready-to-show", () => {
		mainWindow?.show();
		if (IS_DEV) mainWindow?.webContents.openDevTools();
	});
	mainWindow.on("closed", () => {
		mainWindow = null;
	});
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		electron.shell.openExternal(url);
		return { action: "deny" };
	});
	createMenu();
}
function createMenu() {
	const template = [
		...IS_MAC ? [{
			label: electron.app.name,
			submenu: [
				{ role: "about" },
				{ type: "separator" },
				{ role: "services" },
				{ type: "separator" },
				{ role: "hide" },
				{ role: "hideOthers" },
				{ role: "unhide" },
				{ type: "separator" },
				{ role: "quit" }
			]
		}] : [],
		{
			label: "File",
			submenu: [IS_MAC ? { role: "close" } : { role: "quit" }]
		},
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				...IS_MAC ? [
					{ role: "pasteAndMatchStyle" },
					{ role: "delete" },
					{ type: "separator" },
					{
						label: "Select All",
						role: "selectAll"
					}
				] : [
					{ role: "delete" },
					{ type: "separator" },
					{ role: "selectAll" }
				]
			]
		},
		{
			label: "View",
			submenu: [
				{ role: "reload" },
				{ role: "forceReload" },
				{ role: "toggleDevTools" },
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" }
			]
		},
		{
			label: "Window",
			submenu: [{ role: "minimize" }, ...IS_MAC ? [
				{ role: "zoom" },
				{ type: "separator" },
				{ role: "front" },
				{ type: "separator" },
				{ role: "window" }
			] : [{ role: "close" }]]
		},
		{
			label: "Help",
			submenu: [
				{
					label: "Documentation",
					click: () => electron.shell.openExternal("https://github.com/deepseek-ai/deepseek-harness")
				},
				{
					label: "Report Issue",
					click: () => electron.shell.openExternal("https://github.com/deepseek-ai/deepseek-harness/issues")
				},
				{ type: "separator" },
				{
					label: "About DeepSeek Harness",
					click: () => electron.dialog.showMessageBox(mainWindow, {
						type: "info",
						title: "About DeepSeek Harness",
						message: "DeepSeek Harness",
						detail: `Version ${electron.app.getVersion()}\nElectron ${process.versions.electron}\nNode ${process.versions.node}`,
						icon: appIcon
					})
				}
			]
		}
	];
	const menu = electron.Menu.buildFromTemplate(template);
	electron.Menu.setApplicationMenu(menu);
}
async function startDshBackendAndOpenWindow() {
	try {
		const { patches, rootConfigPath } = await initializeWebProfile();
		log(`Booting DSH with root config: ${rootConfigPath}`);
		const { boot } = await importWorkspace("@deepseek-ai/dsh-app-boot");
		const { createLaunchEnvironmentSnapshot } = await importWorkspace("@deepseek-ai/dsh-launch-environment");
		const { provideCmdline } = await importWorkspace("@deepseek-ai/dsh-cmdline");
		dshContext = await boot("dsh", rootConfigPath, patches, async (ctx) => {
			const envSnapshot = createLaunchEnvironmentSnapshot([{
				source: "process",
				values: process.env
			}]);
			ctx.provide("launchEnvironment", envSnapshot);
			ctx.loader.internal = createElectronInternalLoader();
			provideCmdline(ctx, {
				args: ["--port", "0"],
				exit: (code) => {
					if (code === 0) electron.app.quit();
					else electron.app.exit(code);
				}
			});
		});
		log("DSH boot completed successfully");
		const port = dshContext.webServer?.port;
		if (typeof port !== "number") throw new Error("DSH booted but no webServer port is available");
		log(`Web server listening on 127.0.0.1:${port}`);
		appUrl = `http://127.0.0.1:${port}`;
		if (mainWindow) mainWindow.loadURL(appUrl);
	} catch (err) {
		log(`Failed to start DSH backend: ${err}`);
		if (err instanceof Error) log(`Stack: ${err.stack}`);
		const message = err instanceof Error ? err.stack ?? err.message : String(err);
		if (mainWindow) mainWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(errorPage("DeepSeek Harness failed to start", message)));
	}
}
function stopDshBackend() {
	if (dshContext) {
		dshContext.fiber.dispose();
		dshContext = null;
	}
}
electron.app.whenReady().then(async () => {
	createWindow();
	await startDshBackendAndOpenWindow();
	electron.app.on("activate", () => {
		if (electron.BrowserWindow.getAllWindows().length === 0) {
			createWindow();
			if (appUrl !== void 0) mainWindow?.loadURL(appUrl);
		}
	});
});
electron.app.on("window-all-closed", () => {
	stopDshBackend();
	if (!IS_MAC) electron.app.quit();
});
electron.app.on("before-quit", () => {
	stopDshBackend();
});
electron.ipcMain.handle("dsh:get-port", () => 0);
electron.ipcMain.handle("dialog:open-directory", async () => {
	return (await electron.dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] })).filePaths[0];
});
electron.ipcMain.handle("dialog:save-file", async (_event, options) => {
	return (await electron.dialog.showSaveDialog(mainWindow, options)).filePath;
});
electron.ipcMain.handle("shell:open-external", async (_event, url) => {
	await electron.shell.openExternal(url);
});
electron.ipcMain.handle("app:get-version", () => electron.app.getVersion());
electron.ipcMain.handle("app:get-path", (_event, name) => {
	return electron.app.getPath(name);
});
electron.ipcMain.on("menu:action", (_event, action) => {
	const wc = mainWindow?.webContents;
	if (!wc) return;
	switch (action) {
		case "reload":
			wc.reload();
			break;
		case "forceReload":
			wc.reloadIgnoringCache();
			break;
		case "toggleDevTools":
			wc.toggleDevTools();
			break;
		case "zoomIn":
			wc.setZoomLevel(wc.zoomLevel + .5);
			break;
		case "zoomOut":
			wc.setZoomLevel(wc.zoomLevel - .5);
			break;
		case "resetZoom":
			wc.setZoomLevel(0);
			break;
		case "toggleFullscreen":
			mainWindow?.setFullScreen(!mainWindow.isFullScreen());
			break;
		case "minimize":
			mainWindow?.minimize();
			break;
		case "close":
			mainWindow?.close();
			break;
		case "quit":
			electron.app.quit();
			break;
		case "about":
			electron.dialog.showMessageBox(mainWindow, {
				type: "info",
				title: "About DeepSeek Harness",
				message: "DeepSeek Harness",
				detail: `Version ${electron.app.getVersion()}\nElectron ${process.versions.electron}\nNode ${process.versions.node}`,
				icon: appIcon
			});
			break;
		case "documentation":
			electron.shell.openExternal("https://github.com/deepseek-ai/deepseek-harness");
			break;
		case "reportIssue":
			electron.shell.openExternal("https://github.com/deepseek-ai/deepseek-harness/issues");
			break;
	}
});
//#endregion

//# sourceMappingURL=main.cjs.map