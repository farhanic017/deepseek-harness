/** Read-only projection of the current Cordis Loader plugin entries. */

import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type {
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventorySnapshot,
} from './types.ts'

export type * from './types.ts'

/** Brand an existing Loader-tree entry id at the owning boundary. */
function pluginEntryId(value: string): PluginEntryId {
  return value as PluginEntryId
}

/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Complete public projection of Cordis Fiber states. */
const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, PluginFiberPhase>

/** Remote-only service exposing the Loader's current non-group entry state. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader']

  constructor(ctx: Context) {
    super(ctx, 'pluginInventory')
  }

  /**
   * Read the Loader directly on every call. Cordis's internal plugin/status
   * events already maintain Entry.fiber and Fiber.state, so a second cache
   * would only add another lifecycle truth to keep synchronized.
   * @returns Current non-group Loader entries in Loader order.
   */
  @Remote('list')
  list(): PluginInventorySnapshot {
    const entries: PluginInventoryEntry[] = []
    for (const entry of this.ctx.loader.entries()) {
      // Rows are plugin entries, not tree carriers: the root include and any
      // nested group wrap other rows and must not be listed as toggleable —
      // toggling a carrier disposes its whole subtree (including the web
      // server), which reads as a lost connection. Groups declared with
      // `group: true` are already skipped above; carriers like the root
      // Include mount their subtree without an `options.group` flag, so they
      // are detected by the subtree they own.
      if (entry.options.group) continue
      if (entry.subtree) continue
      entries.push({
        entryId: pluginEntryId(entry.id),
        moduleName: entry.options.name,
        enabled: !entry.disabled,
        fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
      })
    }
    return { entries }
  }

  /**
   * Toggle a plugin entry's enabled state. When disabling, the entry's fiber
   * is disposed; when enabling, it is re-initialized. The entry tree writes
   * through to persist the change.
   */
  @Remote('toggle')
  async toggle(entryId: PluginEntryId): Promise<boolean> {
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- branded id must be widened for Loader API
    const entry = this.ctx.loader.resolve(entryId as unknown as string)
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- loader returns undefined for unknown ids at runtime
    if (entry === undefined) throw new Error(`plugin entry not found: ${entryId}`)
    const nextDisabled = !entry.disabled
    await entry.update({ disabled: nextDisabled ? true : null })
    entry.parent.tree.write()
    return !nextDisabled
  }
}

export default PluginInventoryGateway
