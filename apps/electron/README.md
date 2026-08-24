# DeepSeek Harness Desktop (Electron)

> **Built by [farhanic017](https://github.com/farhanic017)** — Web → Desktop port: transformed the live-server web app into a native Electron desktop shell (installer, native workspace picker, windowing) — with dedication through 103° fever.
> Support: **[Patreon — Farhanic](https://www.patreon.com/cw/Farhanic)** ❤️

An Electron desktop shell for the DeepSeek Harness agent. The window boots the
same DSH surface the browser gets from `dsh web` — the local web server, API
gateway, client-module serving, and UI plugin roster — and points the
`BrowserWindow` at `http://127.0.0.1:<port>`. The server binds an OS-assigned
port (`--port 0`), so the desktop app never collides with a concurrently
running `dsh web`.

## Run from a checkout

```sh
pnpm --filter @deepseek-ai/dsh-electron dev
```

The dev script builds the web frontend, compiles the main/preload bundles, and
launches `electron .`. The main process resolves the workspace packages through
the checkout's `apps/electron/node_modules` (via the profile module fallback,
the same mechanism the `dsh` CLI uses), so the backend boots without any
packaging step.

## Build

```sh
pnpm --filter @deepseek-ai/dsh-electron build          # web + main/preload bundles
pnpm --filter @deepseek-ai/dsh-electron build:unpacked # + electron-builder dir layout
```

The window shows a loading page while the backend boots, swaps to the app URL
once the server listens, and renders a failure report (with the log location)
if boot fails. Runtime diagnostics are appended to
`<userData>/electron-main.log`.

## How boot works

The main process mirrors the `dsh` CLI's `runProfile` flow:

1. Find the app install anchor — the nearest ancestor of the bundled `main.cjs`
   whose `node_modules/@deepseek-ai/dsh-app-boot` exists on the real
   filesystem (this also covers a packaged build placed inside a checkout).
2. `initProfile` + `healProfilesModuleFallback` — link the app's dependency
   closure into `<userData>/profiles/node_modules` so the Loader resolves bare
   plugin specifiers from the profile directory.
3. `loadProfile('web')` + `boot` with the launch environment and the command
   line (`--port 0`), exactly like the CLI's `dsh web`.
4. Read `ctx.webServer.port` and load that URL in the window.

## Runtime requirements

- **Electron ≥ 39** (embeds Node 22.20). The base packages use Node 22-only
  APIs (`zlib.createZstdDecompress`, `module.stripTypeScriptTypes`), which
  Electron 30's embedded Node 20 does not provide — boot fails at the loader
  with module-import errors. The workspace's `allowBuilds.electron: true`
  entry lets pnpm run Electron's postinstall so the runtime binary is
  downloaded.
- The vendored Loader's native internal ESM loader (`node-addon-require-builtin`)
  cannot load under Electron's Node ABI, so the main process installs a small
  `internal` shim that resolves bare plugin specifiers against the profile
  directory (see `createElectronInternalLoader` in `src/main/index.ts`).
- The preload is bundled as a CJS entry plus a shared chunk, which sandboxed
  preloads cannot follow; the window therefore runs with `sandbox: false`
  (context isolation stays on, `nodeIntegration` stays off).

## Known limitations

- The desktop-specific surface (native directory picker, terminal, subprocess,
  filesystem rows in `packages/bundle/electron-app/cordis.patch.yml`) is not
  mounted by the current composition: the `@deepseek-ai/dsh-electron` plugin
  rows it references do not exist, and the web-app glue requires the web
  server, so the app rides the standard web surface instead. The preload IPC
  bridge (`window.electronAPI`) is also a stub — the renderer talks to the
  backend over the same-origin HTTP/WebSocket connection the web GUI uses.
- A standalone packaged build (no checkout on disk) cannot resolve the
  workspace packages: the anchor walk finds only the partial dependency tree
  electron-builder packs, and `electron-builder` cannot currently complete a
  Windows dir build from this workspace because its dependency collector
  follows the pnpm workspace junctions (`vendor/cordis` etc.) outside the
  project directory. Run the app from a checkout.
