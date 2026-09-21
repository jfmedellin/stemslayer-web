import type { StemStorePort } from '../../application/ports/stem-store-port'

const DEFAULT_ROOT_DIRECTORY_NAME = 'stems'
const WAV_EXTENSION = '.wav'

/**
 * Thrown when a write hits the origin's storage quota mid-write (a
 * `QuotaExceededError` DOMException from the underlying writable stream).
 * The pre-flight `QuotaPort` check is the primary defense
 * (`docs/decisions/browser-storage.md` section 4); this is the fallback for
 * when another tab or origin consumed the headroom after that estimate.
 */
export class StorageQuotaExceededError extends Error {
  constructor(readonly resultKey: string, readonly laneId: string) {
    super('storage.quota_exceeded Not enough browser storage to save this separation. Remove old tracks and retry.')
    this.name = 'StorageQuotaExceededError'
  }
}

type CreateWritable = (fileHandle: FileSystemFileHandle) => Promise<FileSystemWritableFileStream>

export interface OpfsStemStoreOptions {
  /**
   * Name of this store's own top-level directory under
   * `navigator.storage.getDirectory()`. Defaults to the production root
   * `stems`; tests pass a unique name per test so they never touch the
   * production root and never observe each other's writes.
   */
  readonly rootDirectoryName?: string
  /**
   * Overrides how a writable stream is created for `writeLane`, so tests can
   * inject a writable that throws a `QuotaExceededError` DOMException
   * without needing to actually exhaust the origin's storage quota.
   */
  readonly createWritable?: CreateWritable
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function splitKey(key: string): readonly string[] {
  return key.split('/').filter((segment) => segment.length > 0)
}

async function getDirectory(
  parent: FileSystemDirectoryHandle,
  segments: readonly string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle | undefined> {
  let current = parent
  for (const segment of segments) {
    try {
      current = await current.getDirectoryHandle(segment, { create })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return undefined
      throw error
    }
  }
  return current
}

/**
 * `StemStorePort` over the Origin Private File System
 * (`docs/decisions/browser-storage.md` section 2): one directory per result
 * key under this store's root, one `<laneId>.wav` file per lane.
 *
 * A "key" accepted by `delete`/`exists` is either a whole result key (the
 * directory holding every lane) or one lane key within it (`${resultKey}/${laneId}`,
 * as `expectedLaneKeys` produces); this store resolves either shape by first
 * trying it as a directory, then as a `.wav` file.
 */
export class OpfsStemStore implements StemStorePort {
  private readonly rootDirectoryName: string
  private readonly createWritableOverride: CreateWritable | undefined
  private rootHandle: Promise<FileSystemDirectoryHandle> | undefined

  constructor(options: OpfsStemStoreOptions = {}) {
    this.rootDirectoryName = options.rootDirectoryName ?? DEFAULT_ROOT_DIRECTORY_NAME
    this.createWritableOverride = options.createWritable
  }

  private async root(): Promise<FileSystemDirectoryHandle> {
    this.rootHandle ??= navigator.storage.getDirectory().then((opfsRoot) =>
      opfsRoot.getDirectoryHandle(this.rootDirectoryName, { create: true }),
    )
    return this.rootHandle
  }

  async writeLane(resultKey: string, laneId: string, audio: Uint8Array): Promise<void> {
    const root = await this.root()
    const directory = await getDirectory(root, splitKey(resultKey), true)
    if (directory === undefined) throw new Error(`opfs-stem-store.write_failed:${resultKey}/${laneId}`)

    const fileHandle = await directory.getFileHandle(`${laneId}${WAV_EXTENSION}`, { create: true })
    const createWritable = this.createWritableOverride ?? ((handle: FileSystemFileHandle) => handle.createWritable())
    try {
      const writable = await createWritable(fileHandle)
      await writable.write(toArrayBuffer(audio))
      await writable.close()
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        throw new StorageQuotaExceededError(resultKey, laneId)
      }
      throw error
    }
  }

  async readLane(resultKey: string, laneId: string): Promise<Uint8Array> {
    const root = await this.root()
    const directory = await getDirectory(root, splitKey(resultKey), false)
    if (directory === undefined) {
      throw new Error(`opfs-stem-store.lane_not_found:${resultKey}/${laneId}`)
    }
    try {
      const fileHandle = await directory.getFileHandle(`${laneId}${WAV_EXTENSION}`)
      const file = await fileHandle.getFile()
      return new Uint8Array(await file.arrayBuffer())
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        throw new Error(`opfs-stem-store.lane_not_found:${resultKey}/${laneId}`, { cause: error })
      }
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    const segments = splitKey(key)
    if (segments.length === 0) return
    const parentSegments = segments.slice(0, -1)
    const name = segments[segments.length - 1]

    const root = await this.root()
    const parent = await getDirectory(root, parentSegments, false)
    if (parent === undefined) return

    for (const candidate of [name, `${name}${WAV_EXTENSION}`]) {
      try {
        await parent.removeEntry(candidate, { recursive: true })
        return
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    const segments = splitKey(key)
    if (segments.length === 0) return false
    const parentSegments = segments.slice(0, -1)
    const name = segments[segments.length - 1]

    const root = await this.root()
    const parent = await getDirectory(root, parentSegments, false)
    if (parent === undefined) return false

    try {
      await parent.getDirectoryHandle(name)
      return true
    } catch {
      // Not a directory; fall through to the lane-file shape.
    }
    try {
      await parent.getFileHandle(`${name}${WAV_EXTENSION}`)
      return true
    } catch {
      return false
    }
  }

  async listResultKeys(): Promise<readonly string[]> {
    const root = await this.root()
    const keys: string[] = []
    await collectResultKeys(root, [], keys)
    return keys
  }
}

/**
 * Recursively walks directories under `directory`, collecting the joined
 * relative path of every leaf directory (one that holds files, not further
 * subdirectories) as a result key — result keys may themselves be nested
 * paths (e.g. `stems/track-1`), so a fixed depth cannot be assumed.
 */
async function collectResultKeys(
  directory: FileSystemDirectoryHandle,
  pathSegments: readonly string[],
  out: string[],
): Promise<void> {
  const subdirectories: string[] = []
  let hasFiles = false

  for await (const [name, handle] of directory.entries()) {
    if (handle.kind === 'directory') {
      subdirectories.push(name)
    } else {
      hasFiles = true
    }
  }

  if (subdirectories.length === 0) {
    if (hasFiles && pathSegments.length > 0) out.push(pathSegments.join('/'))
    return
  }

  for (const name of subdirectories) {
    const child = await directory.getDirectoryHandle(name)
    await collectResultKeys(child, [...pathSegments, name], out)
  }
}
