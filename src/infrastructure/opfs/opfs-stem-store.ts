import type { StemLaneInfo, StemLaneWriteSession, StemStorePort } from '../../application/ports/stem-store-port'
import { MIXER_FRAME_CHUNK_SIZE } from '../../domain/mixer/mixer'

const DEFAULT_ROOT_DIRECTORY_NAME = 'stems'
const WAV_EXTENSION = '.wav'
const EXPORT_READ_CHUNK_BYTES = 64 * 1024

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
type RemoveEntry = (directory: FileSystemDirectoryHandle, name: string) => Promise<void>

export interface OpfsStemStoreOptions {
  /**
   * Name of this store's own top-level directory under
   * `navigator.storage.getDirectory()`. Defaults to the production root
   * `stems`; tests pass a unique name per test so they never touch the
   * production root and never observe each other's writes.
   */
  readonly rootDirectoryName?: string
  /**
   * Overrides how a writable stream is created for whole-lane and incremental writes, so tests can
   * inject a writable that throws a `QuotaExceededError` DOMException
   * without needing to actually exhaust the origin's storage quota.
   */
  readonly createWritable?: CreateWritable
  /** Overrides OPFS lane removal so failed-cleanup retries are testable. */
  readonly removeEntry?: RemoveEntry
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function createWavHeader(sampleRate: number, frameCount: number): Uint8Array {
  const header = new Uint8Array(44)
  const view = new DataView(header.buffer)
  const dataBytes = frameCount * 2 * 4
  if (!Number.isSafeInteger(dataBytes) || dataBytes > 0xffff_ffff - 36 || sampleRate * 8 > 0xffff_ffff) {
    throw new Error('opfs-stem-store.wav_size_limit')
  }
  const text = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) header[offset + index] = value.charCodeAt(index)
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 3, true)
  view.setUint16(22, 2, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 8, true)
  view.setUint16(32, 8, true)
  view.setUint16(34, 32, true)
  text(36, 'data')
  view.setUint32(40, dataBytes, true)
  return header
}

function encodeStereoChunk(planar: readonly Float32Array[]): Uint8Array {
  if (planar.length !== 2 || planar[0].length !== planar[1].length) {
    throw new Error('opfs-stem-store.invalid_chunk_shape')
  }
  const bytes = new Uint8Array(planar[0].length * 8)
  const view = new DataView(bytes.buffer)
  let offset = 0
  for (let frame = 0; frame < planar[0].length; frame += 1) {
    const left = planar[0][frame]
    const right = planar[1][frame]
    if (!Number.isFinite(left) || !Number.isFinite(right)) throw new Error('opfs-stem-store.non_finite_sample')
    view.setFloat32(offset, left, true)
    view.setFloat32(offset + 4, right, true)
    offset += 8
  }
  return bytes
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
  private readonly removeEntryOverride: RemoveEntry | undefined
  private rootHandle: Promise<FileSystemDirectoryHandle> | undefined

  constructor(options: OpfsStemStoreOptions = {}) {
    this.rootDirectoryName = options.rootDirectoryName ?? DEFAULT_ROOT_DIRECTORY_NAME
    this.createWritableOverride = options.createWritable
    this.removeEntryOverride = options.removeEntry
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

  async beginLaneWrite(
    resultKey: string,
    laneId: string,
    sampleRate: number,
    frameCount: number,
  ): Promise<StemLaneWriteSession> {
    if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0 || !Number.isSafeInteger(frameCount) || frameCount <= 0) {
      throw new Error('opfs-stem-store.invalid_stream_shape')
    }
    const root = await this.root()
    const directory = await getDirectory(root, splitKey(resultKey), true)
    if (directory === undefined) throw new Error(`opfs-stem-store.write_failed:${resultKey}/${laneId}`)
    const fileHandle = await directory.getFileHandle(`${laneId}${WAV_EXTENSION}`, { create: true })
    const createWritable = this.createWritableOverride ?? ((handle: FileSystemFileHandle) => handle.createWritable())
    let writable: FileSystemWritableFileStream | undefined
    let framesWritten = 0
    let state: 'open' | 'finalized' | 'aborted' = 'open'
    let writableAborted = false
    let cleanupPending = false
    const removeFile = this.removeEntryOverride
      ? (): Promise<void> => this.removeEntryOverride!(directory, `${laneId}${WAV_EXTENSION}`)
      : (): Promise<void> => directory.removeEntry(`${laneId}${WAV_EXTENSION}`)
    const cleanup = async (): Promise<void> => {
      if (state === 'aborted') return
      let abortFailure: unknown
      if (state === 'open' && writable !== undefined && !writableAborted) {
        try {
          await writable.abort()
          writableAborted = true
        } catch (error) {
          abortFailure = error
        }
      }
      let removeFailure: unknown
      let removed = false
      try {
        await removeFile()
        removed = true
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotFoundError') removed = true
        else removeFailure = error
      }
      if (removed) state = 'aborted'
      cleanupPending = !removed
      const cleanupFailures = [abortFailure, removeFailure].filter((error) => error !== undefined)
      if (cleanupFailures.length === 1) throw cleanupFailures[0]
      if (cleanupFailures.length > 1) throw new AggregateError(cleanupFailures, 'opfs-stem-store.cleanup_failed')
    }
    const mappedError = (error: unknown): unknown => {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        return new StorageQuotaExceededError(resultKey, laneId)
      }
      return error
    }
    const failAndCleanup = async (error: unknown): Promise<never> => {
      const primaryError = mappedError(error)
      try {
        await cleanup()
      } catch (cleanupError) {
        throw new AggregateError(
          [primaryError, cleanupError],
          'opfs-stem-store.write_and_cleanup_failed',
          { cause: cleanupError },
        )
      }
      throw primaryError
    }
    try {
      writable = await createWritable(fileHandle)
      const header = createWavHeader(sampleRate, frameCount)
      await writable.write(header.buffer as ArrayBuffer)
    } catch (error) {
      return failAndCleanup(error)
    }
    return {
      writeChunk: async (planar: readonly Float32Array[]): Promise<void> => {
        if (state !== 'open' || cleanupPending) throw new Error('opfs-stem-store.stream_not_open')
        try {
          const bytes = encodeStereoChunk(planar)
          if (framesWritten + planar[0].length > frameCount) throw new Error('opfs-stem-store.too_many_frames')
          await writable!.write(bytes.buffer as ArrayBuffer)
          framesWritten += planar[0].length
        } catch (error) {
          return failAndCleanup(error)
        }
      },
      finalize: async (): Promise<void> => {
        if (state !== 'open' || cleanupPending) throw new Error('opfs-stem-store.stream_not_open')
        if (framesWritten !== frameCount) {
          return failAndCleanup(new Error(`opfs-stem-store.incomplete_stream:${framesWritten}:${frameCount}`))
        }
        try {
          await writable!.close()
          state = 'finalized'
        } catch (error) {
          return failAndCleanup(error)
        }
      },
      abort: cleanup,
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

  async readLaneFile(resultKey: string, laneId: string): Promise<File> {
    return this.laneFile(resultKey, laneId)
  }

  async openLaneStream(resultKey: string, laneId: string): Promise<ReadableStream<Uint8Array>> {
    const file = await this.laneFile(resultKey, laneId)
    let offset = 0
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        if (offset >= file.size) {
          controller.close()
          return
        }
        const end = Math.min(file.size, offset + EXPORT_READ_CHUNK_BYTES)
        const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer())
        offset = end
        controller.enqueue(bytes)
      },
    })
  }

  async createExportArchive(): Promise<import('../../application/ports/stem-store-port').ExportArchiveSession> {
    const root = await this.root()
    const directory = await root.getDirectoryHandle('.exports', { create: true })
    const fileName = `export-${crypto.randomUUID()}.zip`
    const fileHandle = await directory.getFileHandle(fileName, { create: true })
    const createWritable = this.createWritableOverride ?? ((handle: FileSystemFileHandle) => handle.createWritable())
    let writable: FileSystemWritableFileStream
    try {
      writable = await createWritable(fileHandle)
    } catch (error) {
      try {
        await directory.removeEntry(fileName)
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'opfs-stem-store.export_create_cleanup_failed', { cause: cleanupError })
      }
      throw error
    }
    let state: 'open' | 'complete' | 'aborted' | 'released' = 'open'
    let cleanupPromise: Promise<void> | undefined
    const cleanup = (): Promise<void> => {
      cleanupPromise ??= directory.removeEntry(fileName).catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
      })
      return cleanupPromise
    }
    const abort = async (): Promise<void> => {
      if (state === 'aborted' || state === 'released') return
      const wasOpen = state === 'open'
      state = 'aborted'
      let abortFailure: unknown
      if (wasOpen) {
        try { await writable.abort() } catch (error) { abortFailure = error }
      }
      let cleanupFailure: unknown
      try { await cleanup() } catch (error) { cleanupFailure = error }
      if (abortFailure !== undefined && cleanupFailure !== undefined) {
        throw new AggregateError([abortFailure, cleanupFailure], 'opfs-stem-store.export_cleanup_failed')
      }
      if (abortFailure !== undefined) throw abortFailure
      if (cleanupFailure !== undefined) throw cleanupFailure
    }
    return {
      write: async (chunk: Uint8Array): Promise<void> => {
        if (state !== 'open') throw new Error('opfs-stem-store.export_not_open')
        try {
          await writable.write(chunk.slice().buffer as ArrayBuffer)
        } catch (error) {
          try { await abort() } catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'opfs-stem-store.export_write_cleanup_failed', { cause: cleanupError })
          }
          throw error
        }
      },
      complete: async (): Promise<File> => {
        if (state !== 'open') throw new Error('opfs-stem-store.export_not_open')
        try {
          try { await writable.close() } catch (error) {
            throw new Error('opfs-stem-store.export_close_failed', { cause: error })
          }
          state = 'complete'
          let file: File
          try { file = await fileHandle.getFile() } catch (error) {
            throw new Error('opfs-stem-store.export_snapshot_failed', { cause: error })
          }
          return file
        } catch (error) {
          if (state === 'open') {
            try { await abort() } catch (cleanupError) {
              throw new AggregateError([error, cleanupError], 'opfs-stem-store.export_complete_cleanup_failed', { cause: cleanupError })
            }
          } else {
            try { await cleanup() } catch (cleanupError) {
              throw new AggregateError([error, cleanupError], 'opfs-stem-store.export_complete_cleanup_failed', { cause: cleanupError })
            }
          }
          throw error
        }
      },
      abort,
      release: async (): Promise<void> => {
        if (state !== 'complete') return
        state = 'released'
        await cleanup()
      },
    }
  }

  private async laneFile(resultKey: string, laneId: string): Promise<File> {
    const root = await this.root()
    const directory = await getDirectory(root, splitKey(resultKey), false)
    if (directory === undefined) throw new Error(`opfs-stem-store.lane_not_found:${resultKey}/${laneId}`)
    try {
      return await (await directory.getFileHandle(`${laneId}${WAV_EXTENSION}`)).getFile()
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        throw new Error(`opfs-stem-store.lane_not_found:${resultKey}/${laneId}`, { cause: error })
      }
      throw error
    }
  }

  async readLaneInfo(resultKey: string, laneId: string): Promise<StemLaneInfo> {
    const file = await this.laneFile(resultKey, laneId)
    if (file.size < 44) throw new Error('opfs-stem-store.invalid_wav_header')
    const bytes = new Uint8Array(await file.slice(0, 44).arrayBuffer())
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const ascii = (offset: number, value: string): boolean =>
      value.split('').every((character, index) => bytes[offset + index] === character.charCodeAt(0))
    const sampleRate = view.getUint32(24, true)
    const dataBytes = view.getUint32(40, true)
    const frameCount = dataBytes / 8
    if (
      !ascii(0, 'RIFF') || !ascii(8, 'WAVE') || !ascii(12, 'fmt ') || !ascii(36, 'data')
      || view.getUint32(4, true) !== file.size - 8
      || view.getUint32(16, true) !== 16
      || view.getUint16(20, true) !== 3
      || view.getUint16(22, true) !== 2
      || sampleRate <= 0
      || view.getUint32(28, true) !== sampleRate * 8
      || view.getUint16(32, true) !== 8
      || view.getUint16(34, true) !== 32
      || dataBytes !== file.size - 44
      || dataBytes % 8 !== 0
      || !Number.isSafeInteger(frameCount)
    ) throw new Error('opfs-stem-store.invalid_wav_header')
    return Object.freeze({ sampleRate, frameCount })
  }

  async readLaneFrames(
    resultKey: string,
    laneId: string,
    startFrame: number,
    frameCount: number,
    signal?: AbortSignal,
  ): Promise<readonly [Float32Array, Float32Array]> {
    const info = await this.readLaneInfo(resultKey, laneId)
    if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(frameCount)
      || startFrame < 0 || frameCount <= 0 || frameCount > MIXER_FRAME_CHUNK_SIZE
      || startFrame + frameCount > info.frameCount) {
      throw new Error('opfs-stem-store.invalid_frame_range')
    }
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
    const file = await this.laneFile(resultKey, laneId)
    const reader = file.slice(44 + startFrame * 8, 44 + (startFrame + frameCount) * 8).stream().getReader()
    const bytes = new Uint8Array(frameCount * 8)
    let offset = 0
    const abort = (): void => { void reader.cancel(signal?.reason) }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      while (offset < bytes.length) {
        if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
        const result = await reader.read()
        if (result.done || result.value === undefined) throw new Error('opfs-stem-store.truncated_frame_range')
        bytes.set(result.value, offset)
        offset += result.value.length
      }
    } finally {
      signal?.removeEventListener('abort', abort)
      reader.releaseLock()
    }
    const view = new DataView(bytes.buffer)
    const left = new Float32Array(frameCount)
    const right = new Float32Array(frameCount)
    for (let frame = 0; frame < frameCount; frame += 1) {
      left[frame] = view.getFloat32(frame * 8, true)
      right[frame] = view.getFloat32(frame * 8 + 4, true)
    }
    return [left, right]
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
