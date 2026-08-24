/**
 * @deepseek-ai/dsh-electron-app — the desktop-surface bundle's runtime glue plugin
 * plus the bundle patch (`cordis.patch.yml`, declared by the `dsh.bundle.patch`
 * manifest field). The plugin owns the desktop-surface glue.
 * @module @deepseek-ai/dsh-electron-app
 */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { addHarnessSourceSection } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-shell-env'

/** Stable Cordis plugin name. */
export const name = 'electron-app'

/** This dsh installation's root, from either this package's source or built entry. */
const SOURCE_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))

/** Plugin config. */
export interface Config {
  /** Register the model-visible surface context. */
  surfaceContext: boolean
}

export const Config: z<Config> = z.object({
  surfaceContext: z.boolean().default(true),
})

/** Model-visible orientation for sessions created through `dsh electron`. */
function electronSurfacePrompt(): string {
  return 'You are interacting with the user through the DeepSeek Harness Desktop App. '
    + 'When the user refers to "this app", "this window", or "the GUI" without naming another target, they mean this desktop application. '
    + 'The app provides a native desktop experience with full filesystem access, native terminal, and native subprocess support. '
    + 'Do not start a web server unless the user explicitly asks for it.'
}

/**
 * Mount the Electron runtime: surface prompt and orientation.
 * @param ctx - plugin context.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  if (config.surfaceContext) {
    ctx.inject(['systemPrompt'], (promptCtx) => {
      addHarnessSourceSection(promptCtx, SOURCE_ROOT)
      promptCtx.systemPrompt.section({
        name: 'app:electron-surface',
        order: -98,
        text: () => electronSurfacePrompt(),
      })
    })
  }

  // Signal that the electron app is ready
  ctx.effect(() => {
    console.log('electron-app: ready')
  }, 'electron-app: ready signal')
}
