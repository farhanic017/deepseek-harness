/**
 * @deepseek-ai/dsh-host-electron-boot — Electron boot manifest provider.
 * Composes the client entry graph (like the web client-modules node half)
 * but writes it to a file instead of injecting into HTTP responses.
 * @module @deepseek-ai/dsh-host-electron-boot
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { WebBootEntry, WebBootGraph } from '@deepseek-ai/dsh-client-modules'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Electron boot manifest provider. */
    electronBoot: ElectronBootManifest
  }
}

/** package.json `dsh.client` declaration fields. */
interface DshClientDeclaration {
  inject?: string[]
  platform: string
  immediately?: boolean
}

/** Resolved package metadata for one `dsh.client` package. */
interface PkgMeta {
  clientPath: string
  inject?: string[]
  immediately: boolean
}

/** Graph row for one bundle rev. */
interface WebPluginRecord {
  entry: WebBootEntry
  clientPath: string
}

/** Service that composes the client entry graph and writes it to a file. */
export class ElectronBootManifest extends Service {
  static inject = ['loader']

  private readonly table = new Map<string, WebPluginRecord>()
  private readonly pkgMeta = new Map<string, PkgMeta | null>()
  private readonly resolvePkgJson: (spec: string) => string
  private composed: WebBootGraph
  private readonly outputPath: string

  constructor(ctx: Context) {
    super(ctx, 'electronBoot')
    if (ctx.baseUrl === undefined) {
      throw new Error('electron-boot: ctx.baseUrl is unset')
    }
    const require = createRequire(ctx.baseUrl)
    this.resolvePkgJson = spec => require.resolve(`${spec}/package.json`)
    // Output path for the boot manifest - use env var if set (for Electron app), fallback to dev path
    const envPath = process.env.DSH_BOOT_MANIFEST_PATH
    this.outputPath = envPath || join(ctx.baseUrl, '..', '..', '..', 'apps', 'electron', 'dist', 'renderer', 'boot-manifest.json')
    // Subscribe to plugin changes
    ctx.on('internal/plugin', (fiber) => {
      const entryName = fiber.entry?.options.name
      if (entryName === undefined) return
      this.dirty.add(entryName)
      if (this.flushQueued) return
      this.flushQueued = true
      queueMicrotask(() => {
        this.flushQueued = false
        this.flush()
      })
    })
    // Initial scan
    for (const entry of ctx.loader.entries()) this.dirty.add(entry.options.name)
    this.composed = this.compose()
    this.flush()
    this.writeManifest()
  }

  private readonly dirty = new Set<string>()
  private flushQueued = false

  /** Current composed entry graph. */
  graph(): WebBootGraph {
    return this.composed
  }

  /** Write the boot manifest to a file for the Electron main process. */
  private writeManifest(): void {
    try {
      const json = JSON.stringify(this.composed, null, 2)
      writeFileSync(this.outputPath, json, 'utf8')
      this.ctx.logger.info(`electron-boot: wrote boot manifest to ${this.outputPath}`)
    } catch (error) {
      this.ctx.logger.error('electron-boot: failed to write boot manifest', error)
    }
  }

  private compose(): WebBootGraph {
    const entries = [...this.table.values()].map(record => record.entry)
    return { rev: shortHash(JSON.stringify(entries)), entries }
  }

  private flush(): void {
    let changed = false
    for (const entryName of [...this.dirty]) {
      this.dirty.delete(entryName)
      try {
        if (this.processOne(entryName)) changed = true
      } catch (error) {
        this.ctx.logger.warn('electron-boot: flush error', error)
      }
    }
    if (changed) {
      this.composed = this.compose()
      this.writeManifest()
    }
  }

  private processOne(entryName: string): boolean {
    let qualifies = false
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.name === entryName && entry.fiber !== undefined && !entry.disabled) {
        qualifies = true
        break
      }
    }
    if (!qualifies) return this.table.delete(entryName)
    if (this.table.has(entryName)) return false
    const meta = this.resolveMeta(entryName)
    if (meta === null) return false
    const rev = this.initialBundleRevision(entryName, meta.clientPath)
    this.table.set(entryName, { entry: graphRow(entryName, rev, meta.inject, meta.immediately), clientPath: meta.clientPath })
    return true
  }

  private resolveMeta(pkgName: string): PkgMeta | null {
    const cached = this.pkgMeta.get(pkgName)
    if (cached !== undefined) return cached
    let pkgPath: string
    try {
      pkgPath = this.resolvePkgJson(pkgName)
    } catch {
      this.pkgMeta.set(pkgName, null)
      return null
    }
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>
    const dsh = pkg.dsh
    const decl = parseDshClient(
      pkgName,
      dsh !== null && typeof dsh === 'object' ? (dsh as Record<string, unknown>).client : undefined,
    )
    if (decl === undefined || decl.platform !== 'web') {
      this.pkgMeta.set(pkgName, null)
      return null
    }
    const clientRel = clientExportOf(pkgName, pkg.exports)
    if (clientRel === undefined) {
      throw new Error(`electron-boot: ${pkgName} declares dsh.client but exports no "./client" bundle`)
    }
    const meta: PkgMeta = {
      clientPath: join(dirname(pkgPath), clientRel),
      ...(decl.inject !== undefined ? { inject: decl.inject } : {}),
      immediately: decl.immediately === true,
    }
    this.pkgMeta.set(pkgName, meta)
    return meta
  }

  private initialBundleRevision(pkgName: string, clientPath: string): string {
    try {
      return shortHash(readFileSync(clientPath))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      throw new Error(`electron-boot: client bundle not found for ${pkgName} at ${clientPath}`)
    }
  }
}

function parseDshClient(pkgName: string, value: unknown): DshClientDeclaration | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null) {
    throw new Error(`electron-boot: ${pkgName} has a non-object dsh.client declaration`)
  }
  const decl = value as Record<string, unknown>
  if (typeof decl.platform !== 'string') {
    throw new Error(`electron-boot: ${pkgName} dsh.client.platform must be a string`)
  }
  if (decl.inject !== undefined && (!Array.isArray(decl.inject) || decl.inject.some(i => typeof i !== 'string'))) {
    throw new Error(`electron-boot: ${pkgName} dsh.client.inject must be a string array`)
  }
  if (decl.immediately !== undefined && typeof decl.immediately !== 'boolean') {
    throw new Error(`electron-boot: ${pkgName} dsh.client.immediately must be a boolean`)
  }
  return {
    platform: decl.platform,
    ...(decl.inject !== undefined ? { inject: decl.inject as string[] } : {}),
    ...(decl.immediately !== undefined ? { immediately: decl.immediately } : {}),
  }
}

function clientExportOf(pkgName: string, exportsField: unknown): string | undefined {
  if (typeof exportsField !== 'object' || exportsField === null) return undefined
  const client = (exportsField as Record<string, unknown>)['./client']
  if (client === undefined) return undefined
  if (typeof client === 'string') return client
  if (typeof client === 'object' && client !== null) {
    const fallback = (client as Record<string, unknown>).default
    if (typeof fallback === 'string') return fallback
  }
  throw new Error(`electron-boot: ${pkgName} exports["./client"] must be a string or an object with a string default`)
}

function graphRow(id: string, rev: string, injectEdges: string[] | undefined, immediately: boolean): WebBootEntry {
  return {
    id,
    url: `/plugins/${id}/client.js?rev=${rev}`,
    rev,
    ...(injectEdges !== undefined ? { inject: injectEdges } : {}),
    ...(immediately ? { immediately: true } : {}),
  }
}

function shortHash(input: string | Buffer): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12)
}

export default ElectronBootManifest
