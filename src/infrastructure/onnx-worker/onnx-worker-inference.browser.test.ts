import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { InferenceCancelled, type InferenceJob } from '../../application/ports/inference-port'
import type { StemStorePort } from '../../application/ports/stem-store-port'
import { BASIC_PROFILE, ROCK_PROFILE, type StemProfile } from '../../domain/stem-profile'
import { decodeFloat32Wav, encodeFloat32Wav } from '../../domain/audio/float32-wav'
import { OpfsStemStore } from '../opfs/opfs-stem-store'
import { InMemoryModelStore } from '../../../tests/fakes/in-memory-model-store'
import { MODEL_WINDOW_STRIDE, MODEL_SEGMENT_SAMPLES } from './windowing'
import basicFixtureUrl from '../../../tests/infrastructure/onnx-worker/fixtures/basic-synthetic.onnx?url'
import rockFixtureUrl from '../../../tests/infrastructure/onnx-worker/fixtures/rock-synthetic.onnx?url'
import { OnnxWorkerInference } from './onnx-worker-inference'

const FRAME_COUNT = 2_048
const INPUT_GAIN = 0.01
const BASIC_FIXTURE_GAIN = 8
const ROCK_FIXTURE_GAIN = 2

let rootDirectoryName: string
let stemStore: OpfsStemStore

beforeEach(() => {
  rootDirectoryName = `onnx-worker-inference-${crypto.randomUUID()}`
  stemStore = new OpfsStemStore({ rootDirectoryName })
})

afterEach(async () => {
  const root = await navigator.storage.getDirectory()
  await root.removeEntry(rootDirectoryName, { recursive: true }).catch(() => undefined)
})

function sourceWav(gain = INPUT_GAIN, frameCount = FRAME_COUNT): Uint8Array {
  const left = Float32Array.from({ length: frameCount }, (_, index) => Math.sin(index / 31) * gain)
  const right = Float32Array.from({ length: frameCount }, (_, index) => Math.cos(index / 47) * gain)
  return encodeFloat32Wav({ sampleRate: 44_100, planar: [left, right] })
}

function job(
  resultKey: string,
  gain = INPUT_GAIN,
  profile: StemProfile = BASIC_PROFILE,
  frameCount = FRAME_COUNT,
): InferenceJob {
  return {
    trackId: `track-${resultKey}`,
    profile,
    source: sourceWav(gain, frameCount),
    resultKey,
  }
}

async function adapter(store: StemStorePort = stemStore, profile: StemProfile = BASIC_PROFILE): Promise<OnnxWorkerInference> {
  const modelStore = new InMemoryModelStore()
  const response = await fetch(profile.profileId === ROCK_PROFILE.profileId ? rockFixtureUrl : basicFixtureUrl)
  modelStore.setBytes(profile.profileId, new Uint8Array(await response.arrayBuffer()))
  return new OnnxWorkerInference({ modelStore, stemStore: store })
}

describe('OnnxWorkerInference with the real module Worker', () => {
  test('persists real worker output through ordered incremental lane writers, never writeLane', async () => {
    let begins = 0
    let chunks = 0
    let legacyWrites = 0
    const chunkLengths: number[] = []
    const frameCount = MODEL_WINDOW_STRIDE + 32
    const streamingStore: StemStorePort = {
      beginLaneWrite: async (resultKey, laneId, sampleRate, frameCount) => {
        begins += 1
        const writer = await stemStore.beginLaneWrite(resultKey, laneId, sampleRate, frameCount)
        return {
          writeChunk: async (planar) => {
            chunks += 1
            chunkLengths.push(planar[0].length)
            await writer.writeChunk(planar)
          },
          finalize: () => writer.finalize(),
          abort: () => writer.abort(),
        }
      },
      writeLane: async () => { legacyWrites += 1; throw new Error('test.whole_lane_write_forbidden') },
      readLane: (resultKey, laneId) => stemStore.readLane(resultKey, laneId),
      delete: (resultKey) => stemStore.delete(resultKey),
      exists: (resultKey) => stemStore.exists(resultKey),
      listResultKeys: () => stemStore.listResultKeys(),
    }
    const inference = await adapter(streamingStore)

    const keys = await inference.run(job('streamed-real-worker', INPUT_GAIN, BASIC_PROFILE, frameCount), () => undefined).result

    expect(keys).toEqual(BASIC_PROFILE.lanes.map(({ laneId }) => `streamed-real-worker/${laneId}`))
    expect(begins).toBe(BASIC_PROFILE.lanes.length)
    expect(chunks).toBe(BASIC_PROFILE.lanes.length * 2)
    expect(chunkLengths.every((length) => length <= MODEL_SEGMENT_SAMPLES)).toBe(true)
    expect(chunkLengths.filter((length) => length === MODEL_WINDOW_STRIDE)).toHaveLength(BASIC_PROFILE.lanes.length)
    for (const lane of BASIC_PROFILE.lanes) {
      const stored = decodeFloat32Wav(await stemStore.readLane('streamed-real-worker', lane.laneId))
      expect(stored.planar[0]).toHaveLength(frameCount)
      for (const frame of [0, MODEL_WINDOW_STRIDE - 1, MODEL_WINDOW_STRIDE, frameCount - 1]) {
        const expected = Math.sin(frame / 31) * INPUT_GAIN * BASIC_FIXTURE_GAIN
        expect(stored.planar[0][frame]).toBeCloseTo(expected, 4)
      }
    }
    expect(legacyWrites).toBe(0)
  }, 30_000)

  test('runs Rock through the real worker and incrementally persists profile-ordered assembled lanes', async () => {
    let begun = 0
    const streamingStore: StemStorePort = {
      beginLaneWrite: async (resultKey, laneId, sampleRate, frameCount) => {
        begun += 1
        return stemStore.beginLaneWrite(resultKey, laneId, sampleRate, frameCount)
      },
      writeLane: async () => { throw new Error('test.whole_lane_write_forbidden') },
      readLane: (resultKey, laneId) => stemStore.readLane(resultKey, laneId),
      delete: (resultKey) => stemStore.delete(resultKey),
      exists: (resultKey) => stemStore.exists(resultKey),
      listResultKeys: () => stemStore.listResultKeys(),
    }
    const inference = await adapter(streamingStore, ROCK_PROFILE)
    const keys = await inference.run(job('rock-stream', INPUT_GAIN, ROCK_PROFILE), () => undefined).result

    expect(keys).toEqual(ROCK_PROFILE.lanes.map(({ laneId }) => `rock-stream/${laneId}`))
    expect(begun).toBe(ROCK_PROFILE.lanes.length)
    const frame = 511
    const left = Math.sin(frame / 31) * INPUT_GAIN
    const right = Math.cos(frame / 47) * INPUT_GAIN
    for (const lane of ROCK_PROFILE.lanes) {
      const stored = decodeFloat32Wav(await stemStore.readLane('rock-stream', lane.laneId))
      expect(stored.planar[0]).toHaveLength(FRAME_COUNT)
      expect(stored.planar[1]).toHaveLength(FRAME_COUNT)
      const expectedLeft = lane.laneId === 'other' ? left * ROCK_FIXTURE_GAIN * 2 : lane.laneId === 'guitar_center' ? left + right : lane.laneId === 'guitar_sides' ? left - right : left * ROCK_FIXTURE_GAIN
      const expectedRight = lane.laneId === 'other' ? right * ROCK_FIXTURE_GAIN * 2 : lane.laneId === 'guitar_center' ? left + right : lane.laneId === 'guitar_sides' ? right - left : right * ROCK_FIXTURE_GAIN
      expect(stored.planar[0][frame]).toBeCloseTo(expectedLeft, 4)
      expect(stored.planar[1][frame]).toBeCloseTo(expectedRight, 4)
    }
  }, 30_000)

  test('runs Basic through the real Worker/session/path and persists final profile lanes in OPFS', async () => {
    const inference = await adapter()
    const progress: Array<{ window: number; totalWindows: number }> = []

    const keys = await inference.run(job('success'), (event) => progress.push(event)).result

    expect(keys).toEqual(BASIC_PROFILE.lanes.map(({ laneId }) => `success/${laneId}`))
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.every((event, index) => index === 0 || event.window >= progress[index - 1].window)).toBe(true)
    expect(progress.at(-1)).toEqual({ window: progress.at(-1)?.totalWindows, totalWindows: progress.at(-1)?.totalWindows })

    const decodedSource = decodeFloat32Wav(sourceWav())
    for (const lane of BASIC_PROFILE.lanes) {
      const stored = decodeFloat32Wav(await stemStore.readLane('success', lane.laneId))
      expect(stored.sampleRate).toBe(44_100)
      expect(stored.planar).toHaveLength(2)
      expect(stored.planar[0]).toHaveLength(FRAME_COUNT)
      for (const frame of [17, 511, 1_337, 2_000]) {
        expect(stored.planar[0][frame]).toBeCloseTo(decodedSource.planar[0][frame] * BASIC_FIXTURE_GAIN, 4)
        expect(stored.planar[1][frame]).toBeCloseTo(decodedSource.planar[1][frame] * BASIC_FIXTURE_GAIN, 4)
      }
    }
  }, 30_000)

  test('persists finite model peaks above 1 unchanged through the real Worker and OPFS', async () => {
    const inference = await adapter()
    const gain = 0.2

    const keys = await inference.run(job('over-range', gain), () => undefined).result

    expect(keys).toEqual(BASIC_PROFILE.lanes.map(({ laneId }) => `over-range/${laneId}`))
    const stored = decodeFloat32Wav(await stemStore.readLane('over-range', BASIC_PROFILE.lanes[0].laneId))
    const expected = decodeFloat32Wav(sourceWav(gain)).planar[0][511] * BASIC_FIXTURE_GAIN
    expect(Math.abs(expected)).toBeGreaterThan(1)
    expect(stored.planar[0][511]).toBeCloseTo(expected, 4)
  }, 30_000)

  test('terminate is idempotent, rejects with InferenceCancelled, and removes the whole result', async () => {
    await stemStore.writeLane('cancelled', 'placeholder', Uint8Array.from([1]))
    const inference = await adapter()
    const state: { handle?: ReturnType<OnnxWorkerInference['run']> } = {}
    state.handle = inference.run(job('cancelled'), () => {
      state.handle?.terminate()
      state.handle?.terminate()
    })

    await expect(state.handle.result).rejects.toBeInstanceOf(InferenceCancelled)
    await expect(stemStore.exists('cancelled')).resolves.toBe(false)
  })

  test('removes all partial lanes when persistence fails after the first write', async () => {
    let writes = 0
    const failingStore: StemStorePort = {
      beginLaneWrite: async (resultKey, laneId, sampleRate, frameCount) => {
        const writer = await stemStore.beginLaneWrite(resultKey, laneId, sampleRate, frameCount)
        return {
          writeChunk: async (planar) => {
            writes += 1
            if (writes === 2) throw new Error('test.second_write_failed')
            await writer.writeChunk(planar)
          },
          finalize: () => writer.finalize(),
          abort: () => writer.abort(),
        }
      },
      writeLane: async (resultKey, laneId, bytes) => {
        await stemStore.writeLane(resultKey, laneId, bytes)
      },
      readLane: (resultKey, laneId) => stemStore.readLane(resultKey, laneId),
      delete: (resultKey) => stemStore.delete(resultKey),
      exists: (resultKey) => stemStore.exists(resultKey),
      listResultKeys: () => stemStore.listResultKeys(),
    }
    const inference = await adapter(failingStore)

    await expect(inference.run(job('partial'), () => undefined).result).rejects.toThrow('test.second_write_failed')
    expect(writes).toBe(2)
    await expect(stemStore.exists('partial')).resolves.toBe(false)
  }, 30_000)

  test('cancellation during an in-flight lane write waits for the write before deleting the result', async () => {
    const order: string[] = []
    let releaseWrite: (() => void) | undefined
    const writeBlocked = new Promise<void>((resolve) => { releaseWrite = resolve })
    let writeStarted: (() => void) | undefined
    const writeStartedSignal = new Promise<void>((resolve) => { writeStarted = resolve })
    let firstWrite = true
    const state: { handle?: ReturnType<OnnxWorkerInference['run']> } = {}

    const raceStore: StemStorePort = {
      beginLaneWrite: async (resultKey, laneId, sampleRate, frameCount) => {
        const writer = await stemStore.beginLaneWrite(resultKey, laneId, sampleRate, frameCount)
        return {
          writeChunk: async (planar) => {
            if (firstWrite) {
              firstWrite = false
              order.push('write-started')
              queueMicrotask(() => state.handle?.terminate())
              writeStarted?.()
              await writeBlocked
              order.push('write-resolved')
            }
            await writer.writeChunk(planar)
          },
          finalize: () => writer.finalize(),
          abort: () => writer.abort(),
        }
      },
      writeLane: async (resultKey, laneId, bytes) => {
        await stemStore.writeLane(resultKey, laneId, bytes)
      },
      readLane: (resultKey, laneId) => stemStore.readLane(resultKey, laneId),
      delete: async (resultKey) => {
        order.push('delete-called')
        await stemStore.delete(resultKey)
      },
      exists: (resultKey) => stemStore.exists(resultKey),
      listResultKeys: () => stemStore.listResultKeys(),
    }

    const inference = await adapter(raceStore)
    state.handle = inference.run(job('race'), () => undefined)

    await writeStartedSignal
    // Flush every pending microtask (including terminate()'s cleanup chain) before asserting
    // that a buggy "delete without waiting" implementation would already have deleted here.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(order).toEqual(['write-started'])

    releaseWrite?.()
    await expect(state.handle?.result).rejects.toBeInstanceOf(InferenceCancelled)
    expect(order).toEqual(['write-started', 'write-resolved', 'delete-called'])
    await expect(stemStore.exists('race')).resolves.toBe(false)
  }, 30_000)

  test('cancellation during finalization waits, aborts completed files, and deletes the result', async () => {
    const order: string[] = []
    let releaseFinalize: (() => void) | undefined
    const finalizeBlocked = new Promise<void>((resolve) => { releaseFinalize = resolve })
    let finalizeStarted: (() => void) | undefined
    const finalizeStartedSignal = new Promise<void>((resolve) => { finalizeStarted = resolve })
    const handleRef: { current?: ReturnType<OnnxWorkerInference['run']> } = {}
    const racingStore: StemStorePort = {
      beginLaneWrite: async (resultKey, laneId, sampleRate, frameCount) => {
        const writer = await stemStore.beginLaneWrite(resultKey, laneId, sampleRate, frameCount)
        let firstFinalize = true
        return {
          writeChunk: (planar) => writer.writeChunk(planar),
          finalize: async () => {
            if (firstFinalize) {
              firstFinalize = false
              order.push('finalize-started')
              queueMicrotask(() => handleRef.current?.terminate())
              finalizeStarted?.()
              await finalizeBlocked
              order.push('finalize-resolved')
            }
            await writer.finalize()
          },
          abort: () => writer.abort(),
        }
      },
      writeLane: async () => { throw new Error('test.whole_lane_write_forbidden') },
      readLane: (resultKey, laneId) => stemStore.readLane(resultKey, laneId),
      delete: async (resultKey) => { order.push('delete-called'); await stemStore.delete(resultKey) },
      exists: (resultKey) => stemStore.exists(resultKey),
      listResultKeys: () => stemStore.listResultKeys(),
    }
    const inference = await adapter(racingStore)
    const cancelHandle = inference.run(job('finalize-race'), () => undefined)
    handleRef.current = cancelHandle

    await finalizeStartedSignal
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(order).toEqual(['finalize-started'])
    releaseFinalize?.()

    await expect(cancelHandle.result).rejects.toBeInstanceOf(InferenceCancelled)
    expect(order).toEqual(['finalize-started', 'finalize-resolved', 'delete-called'])
    await expect(stemStore.exists('finalize-race')).resolves.toBe(false)
  }, 30_000)

  test('a cleanup failure during cancellation still rejects with InferenceCancelled', async () => {
    const deleteError = new Error('test.delete_failed')
    const deleteFailingStore: StemStorePort = {
      beginLaneWrite: (resultKey, laneId, sampleRate, frameCount) =>
        stemStore.beginLaneWrite(resultKey, laneId, sampleRate, frameCount),
      writeLane: (resultKey, laneId, bytes) => stemStore.writeLane(resultKey, laneId, bytes),
      readLane: (resultKey, laneId) => stemStore.readLane(resultKey, laneId),
      delete: async () => { throw deleteError },
      exists: (resultKey) => stemStore.exists(resultKey),
      listResultKeys: () => stemStore.listResultKeys(),
    }
    const inference = await adapter(deleteFailingStore)
    const state: { handle?: ReturnType<OnnxWorkerInference['run']> } = {}
    state.handle = inference.run(job('cleanup-fails'), () => {
      state.handle?.terminate()
    })

    const error: unknown = await state.handle.result.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(InferenceCancelled)
    expect((error as { cause?: unknown }).cause).toBe(deleteError)
  })
})
