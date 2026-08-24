/**
 * Atomic whole-file replacement for the JSON backend.
 *
 * Publish protocol: write a same-directory temp file, fsync it, then
 * `rename()` over the target. Rename is an atomic replace on POSIX and on
 * Windows (libuv maps it to `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING)`),
 * and replacement is the intended semantic here — unlike the session-log
 * backend's link()+unlink() no-clobber protocol, a unit file has exactly one
 * writer per process and last-write-wins is correct. After the rename the
 * parent directory is fsynced on POSIX so the new entry is crash-durable.
 * @module @deepseek-ai/dsh-storage-json/src/atomic
 */

import { open, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * Windows rename failure codes that a short bounded retry can clear: the
 * target is transiently locked by an antivirus scan or a brief concurrent
 * handle (the temp file is already fully written and fsynced, so the rename
 * is the only step that can hit this). These are robustness invariants of the
 * publish protocol, not deployment tunables.
 */
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RENAME_RETRY_ATTEMPTS = 5
const RENAME_RETRY_BASE_DELAY_MS = 50

/** Whether a rename failure is one a short retry can clear. */
function isTransientRenameError(error: unknown): boolean {
  return RENAME_RETRY_CODES.has((error as NodeJS.ErrnoException | null)?.code ?? '')
}

/**
 * Rename `from` over `to`, retrying transient Windows lock failures with
 * linear backoff. Any other failure propagates immediately.
 * @param from - source path (the fully written temp file).
 * @param to - target path.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      if (!isTransientRenameError(error) || attempt >= RENAME_RETRY_ATTEMPTS - 1) throw error
      await new Promise(resolve => setTimeout(resolve, RENAME_RETRY_BASE_DELAY_MS * (attempt + 1)))
    }
  }
}

/**
 * Durably replace `path` with `data`.
 * @param path - Absolute target file path.
 * @param data - Full new file content.
 * @returns resolution after the replacement is crash-durable.
 */
export async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = join(dirname(path), `.${randomUUID()}.tmp`)
  try {
    const handle = await open(tmp, 'wx', 0o600)
    try {
      await handle.writeFile(data, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await renameWithRetry(tmp, path)
    await fsyncDirectory(dirname(path))
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}

/** fsync a POSIX directory so a just-renamed entry is crash-durable. */
/* v8 ignore start -- Windows rejects O_RDONLY directory opens; POSIX coverage exercises this. */
async function fsyncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
/* v8 ignore stop */
