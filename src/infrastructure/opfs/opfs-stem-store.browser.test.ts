import { afterEach, beforeEach, expect, test } from 'vitest'

import { encodeFloat32Wav } from '../../domain/audio/float32-wav'
import { OpfsStemStore, StorageQuotaExceededError } from './opfs-stem-store'

let rootDirectoryName: string

beforeEach(() => {
  // Each test gets its own root directory name so tests never touch the
  // production `stems` root and never see each other's writes.
  rootDirectoryName = `opfs-test-${Math.random().toString(36).slice(2)}`
})

afterEach(async () => {
  const opfsRoot = await navigator.storage.getDirectory()
  await opfsRoot.removeEntry(rootDirectoryName, { recursive: true }).catch(() => undefined)
})

function newStore(overrides: ConstructorParameters<typeof OpfsStemStore>[0] = {}): OpfsStemStore {
  return new OpfsStemStore({ rootDirectoryName, ...overrides })
}

test('writeLane then readLane round trips the exact bytes', async () => {
  const store = newStore()
  const audio = Uint8Array.from([82, 73, 70, 70, 1, 2, 3, 4])

  await store.writeLane('stems/track-1', 'vocals', audio)

  await expect(store.readLane('stems/track-1', 'vocals')).resolves.toEqual(audio)
})

test('streams a lane and removes the staged ZIP after the download snapshot is released', async () => {
  const store = newStore()
  const original = Uint8Array.from({ length: 120_000 }, (_unused, index) => index % 251)
  await store.writeLane('stems/export', 'vocals', original)
  const file = await store.readLaneFile('stems/export', 'vocals')
  expect(file.size).toBe(original.length)
  const received: number[] = []
  const reader = (await store.openLaneStream('stems/export', 'vocals')).getReader()
  while (true) {
    const result = await reader.read()
    if (result.done) break
    received.push(result.value.length)
  }
  expect(received.length).toBeGreaterThan(1)
  expect(Math.max(...received)).toBeLessThanOrEqual(65_536)

  const opfsRoot = await navigator.storage.getDirectory()
  const exports = await (await opfsRoot.getDirectoryHandle(rootDirectoryName)).getDirectoryHandle('.exports', { create: true })
  const archive = await store.createExportArchive()
  await archive.write(Uint8Array.from([1, 2, 3]))
  await archive.write(Uint8Array.from([4, 5]))
  const snapshot = await archive.complete()
  expect(new Uint8Array(await snapshot.arrayBuffer())).toEqual(Uint8Array.from([1, 2, 3, 4, 5]))
  const remaining: string[] = []
  for await (const [name] of exports.entries()) remaining.push(name)
  expect(remaining).toHaveLength(1)
  await archive.release()
  const afterRelease: string[] = []
  for await (const [name] of exports.entries()) afterRelease.push(name)
  expect(afterRelease).toEqual([])
  await expect(store.readLane('stems/export', 'vocals')).resolves.toEqual(original)
})

test('removes temporary archive files on abort and staging creation failure without touching source stems', async () => {
  let failNextExport = false
  const store = newStore({
    createWritable: async (handle) => {
      if (failNextExport && handle.name.startsWith('export-')) throw new Error('temporary storage unavailable')
      return handle.createWritable()
    },
  })
  const source = Uint8Array.from([82, 73, 70, 70, 1, 2, 3, 4])
  await store.writeLane('stems/keep', 'vocals', source)

  const staging = await store.createExportArchive()
  await staging.write(Uint8Array.from([1, 2]))
  await staging.abort()
  await expect(staging.write(Uint8Array.from([3]))).rejects.toThrow('export_not_open')
  failNextExport = true
  await expect(store.createExportArchive()).rejects.toThrow('temporary storage unavailable')
  await expect(store.readLane('stems/keep', 'vocals')).resolves.toEqual(source)

  const opfsRoot = await navigator.storage.getDirectory()
  const exports = await (await opfsRoot.getDirectoryHandle(rootDirectoryName)).getDirectoryHandle('.exports', { create: true })
  const remaining: string[] = []
  for await (const [name] of exports.entries()) remaining.push(name)
  expect(remaining).toEqual([])
})

test('incremental lane writer emits byte-identical WAV and finalizes only after all frames arrive', async () => {
  const store = newStore()
  const left = Float32Array.from([0.1, -0.2, 0.3, -0.4])
  const right = Float32Array.from([-0.5, 0.6, -0.7, 0.8])
  const writer = await store.beginLaneWrite('stems/streamed', 'vocals', 44_100, left.length)

  await writer.writeChunk([left.subarray(0, 2), right.subarray(0, 2)])
  await writer.writeChunk([left.subarray(2), right.subarray(2)])
  await writer.finalize()

  await expect(store.readLane('stems/streamed', 'vocals')).resolves.toEqual(
    encodeFloat32Wav({ sampleRate: 44_100, planar: [left, right] }),
  )
})

test('reads validated WAV metadata and exact aligned frame ranges without returning the whole lane', async () => {
  const store = newStore()
  const left = Float32Array.from([0.1, -0.2, 0.3, -0.4, 0.5])
  const right = Float32Array.from([-0.5, 0.6, -0.7, 0.8, -0.9])
  await store.writeLane('stems/ranged', 'vocals', encodeFloat32Wav({ sampleRate: 48_000, planar: [left, right] }))

  await expect(store.readLaneInfo('stems/ranged', 'vocals')).resolves.toEqual({ sampleRate: 48_000, frameCount: 5 })
  await expect(store.readLaneFrames('stems/ranged', 'vocals', 2, 2)).resolves.toEqual([
    Float32Array.from([0.3, -0.4]),
    Float32Array.from([-0.7, 0.8]),
  ])
  await expect(store.readLaneFrames('stems/ranged', 'vocals', 4, 2)).rejects.toThrow('opfs-stem-store.invalid_frame_range')

  const large = new Float32Array(16_385)
  await store.writeLane('stems/range-limit', 'vocals', encodeFloat32Wav({ sampleRate: 48_000, planar: [large, large] }))
  await expect(store.readLaneFrames('stems/range-limit', 'vocals', 0, 16_385))
    .rejects.toThrow('opfs-stem-store.invalid_frame_range')
})

test('rejects an invalid float WAV format and an already-aborted frame-range request', async () => {
  const store = newStore()
  const bytes = encodeFloat32Wav({ sampleRate: 44_100, planar: [new Float32Array([0.25]), new Float32Array([-0.25])] })
  const malformed = bytes.slice()
  new DataView(malformed.buffer).setUint16(20, 1, true)
  await store.writeLane('stems/malformed-range', 'vocals', malformed)
  await expect(store.readLaneInfo('stems/malformed-range', 'vocals')).rejects.toThrow('opfs-stem-store.invalid_wav_header')

  const controller = new AbortController()
  controller.abort()
  await store.writeLane('stems/aborted-range', 'vocals', bytes)
  await expect(store.readLaneFrames('stems/aborted-range', 'vocals', 0, 1, controller.signal))
    .rejects.toMatchObject({ name: 'AbortError' })
})

test('aborting an incremental lane writer removes its partial file', async () => {
  const store = newStore()
  const writer = await store.beginLaneWrite('stems/aborted', 'vocals', 44_100, 4)
  await writer.writeChunk([new Float32Array([0.1, 0.2]), new Float32Array([0.3, 0.4])])

  await writer.abort()

  await expect(store.exists('stems/aborted/vocals')).resolves.toBe(false)
})

test('incremental quota refusal maps to the typed error and removes the partial lane', async () => {
  let writes = 0
  const store = newStore({
    createWritable: async () => ({
      write: async () => {
        writes += 1
        if (writes === 2) throw new DOMException('mock quota exceeded', 'QuotaExceededError')
      },
      close: async () => undefined,
      abort: async () => undefined,
    } as unknown as FileSystemWritableFileStream),
  })
  const writer = await store.beginLaneWrite('stems/quota-stream', 'vocals', 44_100, 2)

  await expect(writer.writeChunk([new Float32Array([0.1, 0.2]), new Float32Array([0.3, 0.4])]))
    .rejects.toBeInstanceOf(StorageQuotaExceededError)
  await expect(store.exists('stems/quota-stream/vocals')).resolves.toBe(false)
})

test('finalize rejects a truncated lane and removes its partial WAV', async () => {
  const store = newStore()
  const writer = await store.beginLaneWrite('stems/truncated', 'vocals', 44_100, 4)
  await writer.writeChunk([new Float32Array([0.1, 0.2]), new Float32Array([0.3, 0.4])])

  await expect(writer.finalize()).rejects.toThrow('opfs-stem-store.incomplete_stream:2:4')
  await expect(store.exists('stems/truncated/vocals')).resolves.toBe(false)
})

test('a malformed non-finite chunk aborts and removes partial OPFS output', async () => {
  const store = newStore()
  const writer = await store.beginLaneWrite('stems/malformed', 'vocals', 44_100, 2)

  await expect(writer.writeChunk([
    Float32Array.from([0.1, Number.NaN]),
    Float32Array.from([0.3, 0.4]),
  ])).rejects.toThrow('opfs-stem-store.non_finite_sample')
  await expect(store.exists('stems/malformed/vocals')).resolves.toBe(false)
})

test('a chunk overrun aborts and removes partial OPFS output', async () => {
  const store = newStore()
  const writer = await store.beginLaneWrite('stems/overrun', 'vocals', 44_100, 2)
  await writer.writeChunk([Float32Array.from([0.1]), Float32Array.from([0.2])])

  await expect(writer.writeChunk([
    Float32Array.from([0.3, 0.4]),
    Float32Array.from([0.5, 0.6]),
  ])).rejects.toThrow('opfs-stem-store.too_many_frames')
  await expect(store.exists('stems/overrun/vocals')).resolves.toBe(false)
})

test('a failed cleanup preserves both errors and a later abort retries file removal', async () => {
  const cleanupFailure = new Error('test.remove_entry_failed')
  let removeAttempts = 0
  const store = newStore({
    removeEntry: async (directory, name) => {
      removeAttempts += 1
      if (removeAttempts === 1) throw cleanupFailure
      await directory.removeEntry(name)
    },
  })
  const writer = await store.beginLaneWrite('stems/retry-cleanup', 'vocals', 44_100, 2)

  let writeFailure: unknown
  try {
    await writer.writeChunk([
      Float32Array.from([0.1, Number.NaN]),
      Float32Array.from([0.3, 0.4]),
    ])
  } catch (error) {
    writeFailure = error
  }

  expect(writeFailure).toBeInstanceOf(AggregateError)
  expect((writeFailure as AggregateError).errors).toEqual([
    expect.objectContaining({ message: 'opfs-stem-store.non_finite_sample' }),
    cleanupFailure,
  ])
  await expect(store.exists('stems/retry-cleanup/vocals')).resolves.toBe(true)
  await expect(writer.writeChunk([
    Float32Array.from([0.2]),
    Float32Array.from([0.3]),
  ])).rejects.toThrow('opfs-stem-store.stream_not_open')

  await writer.abort()

  expect(removeAttempts).toBe(2)
  await expect(store.exists('stems/retry-cleanup/vocals')).resolves.toBe(false)
})

test('writeLane can write more than one lane under the same result key', async () => {
  const store = newStore()
  await store.writeLane('stems/track-1', 'vocals', Uint8Array.from([1]))
  await store.writeLane('stems/track-1', 'drums', Uint8Array.from([2]))

  await expect(store.readLane('stems/track-1', 'vocals')).resolves.toEqual(Uint8Array.from([1]))
  await expect(store.readLane('stems/track-1', 'drums')).resolves.toEqual(Uint8Array.from([2]))
})

test('exists reports true for a stored result key and for a stored lane key, false otherwise', async () => {
  const store = newStore()
  await store.writeLane('stems/track-1', 'vocals', Uint8Array.from([1]))

  await expect(store.exists('stems/track-1')).resolves.toBe(true)
  await expect(store.exists('stems/track-1/vocals')).resolves.toBe(true)
  await expect(store.exists('stems/track-2')).resolves.toBe(false)
})

test('listResultKeys returns every written result key, empty when nothing is stored', async () => {
  const store = newStore()
  await expect(store.listResultKeys()).resolves.toEqual([])

  await store.writeLane('stems/track-1', 'vocals', Uint8Array.from([1]))
  await store.writeLane('stems/track-2', 'drums', Uint8Array.from([2]))

  const keys = await store.listResultKeys()
  expect(keys).toHaveLength(2)
  expect(keys).toEqual(expect.arrayContaining(['stems/track-1', 'stems/track-2']))
})

test('delete on a whole result key removes every lane under it recursively', async () => {
  const store = newStore()
  await store.writeLane('stems/track-1', 'vocals', Uint8Array.from([1]))
  await store.writeLane('stems/track-1', 'drums', Uint8Array.from([2]))

  await store.delete('stems/track-1')

  await expect(store.exists('stems/track-1')).resolves.toBe(false)
  await expect(store.listResultKeys()).resolves.toEqual([])
})

test('delete on a single lane key removes only that lane, keeping its siblings', async () => {
  const store = newStore()
  await store.writeLane('stems/track-1', 'vocals', Uint8Array.from([1]))
  await store.writeLane('stems/track-1', 'drums', Uint8Array.from([2]))

  await store.delete('stems/track-1/vocals')

  await expect(store.exists('stems/track-1/vocals')).resolves.toBe(false)
  await expect(store.readLane('stems/track-1', 'drums')).resolves.toEqual(Uint8Array.from([2]))
})

test('deleting an unknown key is a no-op', async () => {
  const store = newStore()

  await expect(store.delete('stems/missing')).resolves.toBeUndefined()
})

test('a QuotaExceededError from the writable stream is mapped to a typed StorageQuotaExceededError', async () => {
  const store = newStore({
    createWritable: async () => {
      throw new DOMException('mock quota exceeded', 'QuotaExceededError')
    },
  })

  await expect(store.writeLane('stems/track-1', 'vocals', Uint8Array.from([1]))).rejects.toBeInstanceOf(
    StorageQuotaExceededError,
  )
  try {
    await store.writeLane('stems/track-1', 'vocals', Uint8Array.from([1]))
    expect.unreachable()
  } catch (error) {
    expect(error).toBeInstanceOf(StorageQuotaExceededError)
    expect((error as Error).message).toContain(
      'Not enough browser storage to save this separation. Remove old tracks and retry.',
    )
  }
})

test('two different root directory names never observe each other\'s writes', async () => {
  const store = newStore()
  await store.writeLane('stems/track-1', 'vocals', Uint8Array.from([1]))

  const otherRootName = `${rootDirectoryName}-other`
  const otherStore = new OpfsStemStore({ rootDirectoryName: otherRootName })
  try {
    await expect(otherStore.exists('stems/track-1')).resolves.toBe(false)
  } finally {
    const opfsRoot = await navigator.storage.getDirectory()
    await opfsRoot.removeEntry(otherRootName, { recursive: true }).catch(() => undefined)
  }
})
