/**
 * Derive the working directory a filesystem tool resolves relative paths against: the calling
 * agent's per-session workspace (`exec.agent.session.header.cwd`), so each session's
 * `read`/`write`/`edit` act on ITS workspace, not the server's launch dir — mirroring how
 * `dsh-tool-bash` defaults a bash `workdir` to the session cwd.
 * Non-agent calls return `undefined`, leaving the fallback in the provider rather than reading
 * `process.cwd()` at the tool boundary.
 * @module @deepseek-ai/dsh-tool-fs/session-cwd
 */

import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { canonicalPath } from '@deepseek-ai/dsh-sandbox'

const PARENT_PATH_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/

/**
 * The session workspace cwd for this call. When no workspace is selected and
 * the caller is an agent, fail fast instead of falling back to process.cwd()
 * — the agent should not scan the server's repo root when the user hasn't
 * picked a folder.
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @param requestedPath - the path the provider will resolve; parent traversal
 *   makes a symlinked cwd's filesystem identity observable.
 * @returns the calling agent's session cwd.
 * @throws when an agent has no workspace cwd.
 */
export function sessionCwd(exec: ToolExecution, requestedPath: string): string | undefined {
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined) {
    if (exec.agent !== undefined) {
      throw new Error(
        'No workspace selected — this file operation requires a workspace. ' +
        'Ask the user to pick a workspace first.',
      )
    }
    return undefined
  }
  if (!PARENT_PATH_SEGMENT.test(cwd) && !PARENT_PATH_SEGMENT.test(requestedPath)) return cwd
  return canonicalPath(cwd)
}

/**
 * Resolution options shared by all model-facing filesystem tools.
 * @param exec - the tool-execution context supplying session cwd and cancellation.
 * @param requestedPath - the path the provider will resolve.
 * @param policyWorkspaceRoot - resolved per-call root, when a mutation carries sandbox policy.
 * @returns provider resolution options for the current tool call.
 */
export function sessionResolveOptions(
  exec: ToolExecution,
  requestedPath: string,
  policyWorkspaceRoot?: string,
): { cwd?: string; signal?: AbortSignal } {
  const cwd = policyWorkspaceRoot ?? sessionCwd(exec, requestedPath)
  return {
    ...cwd !== undefined ? { cwd } : {},
    signal: exec.signal,
  }
}
