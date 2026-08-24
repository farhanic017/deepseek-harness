/**
 * electron-builder `beforeBuild` hook. Returning `false` tells electron-builder
 * that node_modules are handled outside of it, so it skips its own dependency
 * collection. That collection resolves the workspace packages through pnpm's
 * junctions (e.g. `@deepseek-ai/cordis` → `vendor/cordis`), which live outside
 * the app directory and abort the build with "must be under apps/electron".
 *
 * The packaged app never uses an in-asar node_modules: it boots through the
 * install-anchor walk in src/main/index.ts, which resolves the real workspace
 * tree when the app runs from inside a checkout.
 */
module.exports = async function skipNodeModules() {
  return false
}
