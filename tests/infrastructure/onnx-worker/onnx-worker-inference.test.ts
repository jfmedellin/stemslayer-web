import { describe, expect, test } from 'vitest'

import type { InferenceJob } from '../../../src/application/ports/inference-port'
import type { ModelFootprint, ModelStorePort } from '../../../src/application/ports/model-store-port'
import type { StemStorePort } from '../../../src/application/ports/stem-store-port'
import { BASIC_PROFILE } from '../../../src/domain/stem-profile'
import { OnnxWorkerInference } from '../../../src/infrastructure/onnx-worker/onnx-worker-inference'
import type { WorkerChunkMessage, WorkerCompleteMessage, WorkerJobMessage } from '../../../src/infrastructure/onnx-worker/protocol'

interface FakeWorker {
  postMessage(message: WorkerJobMessage, transfer: Transferable[]): void
  terminate(): void
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

function job(resultKey: string): InferenceJob {
  return {
    trackId: `track-${resultKey}`,
    profile: BASIC_PROFILE,
    source: Uint8Array.from([1, 2, 3]),
    resultKey,
  }
}

const modelStore: ModelStorePort = {
  getFootprint: async (): Promise<ModelFootprint> => ({ cached: true, sizeBytes: 1 }),
  ensure: async () => undefined,
  read: async () => Uint8Array.from([1]),
}

function chunkMessage(job: InferenceJob): WorkerChunkMessage {
  return {
    kind: 'chunk',
    trackId: job.trackId,
    resultKey: job.resultKey,
    sampleRate: 44_100,
    frameCount: 1,
    chunkIndex: 0,
    offset: 0,
    lanes: job.profile.lanes.map(({ laneId }) => ({
      laneId,
      channels: [new Float32Array([0.1]), new Float32Array([-0.1])],
    })),
  }
}

describe('OnnxWorkerInference against a fully injected fake Worker', () => {
  test('streams Blob sources through the worker and starts OPFS writers without guessing a frame count', async () => {
    const file = new Blob([Uint8Array.from([1, 2, 3])], { type: 'audio/wav' })
    let posted: WorkerJobMessage | undefined
    let writerFrameCount: number | undefined = 0
    let finalized = 0
    let chunkWritten = 0
    const fakeWorker: FakeWorker = {
      postMessage: (message) => { posted = message },
      terminate: () => undefined,
      onmessage: null,
      onerror: null,
    }
    const stemStore: StemStorePort = {
      beginLaneWrite: async (_key, _lane, _rate, frames) => {
        writerFrameCount = frames
        return {
          writeChunk: async () => { chunkWritten += 1 },
          finalize: async () => { finalized += 1 },
          abort: async () => undefined,
        }
      },
      writeLane: async () => undefined,
      readLane: async () => { throw new Error('unused') },
      delete: async () => undefined,
      exists: async () => false,
      listResultKeys: async () => [],
    }
    const inference = new OnnxWorkerInference({
      modelStore,
      stemStore,
      decoder: { decode: async () => { throw new Error('whole_track_decoder_used') } },
      createWorker: () => fakeWorker,
    })
    const theJob = { ...job('blob-stream'), source: file, sourceFormat: 'WAV' as const }
    const handle = inference.run(theJob, () => undefined)
    await new Promise<void>((resolve) => {
      const check = () => (fakeWorker.onmessage ? resolve() : setTimeout(check, 0))
      check()
    })
    expect(posted?.source).toBe(file)
    expect(posted?.sourceFormat).toBe('WAV')
    expect(posted?.planarChannels).toBeUndefined()
    const base = { trackId: theJob.trackId, resultKey: theJob.resultKey }
    fakeWorker.onmessage?.({ data: {
      kind: 'chunk', ...base, sampleRate: 44_100, frameCount: null, chunkIndex: 0, offset: 0,
      lanes: theJob.profile.lanes.map(({ laneId }) => ({
        laneId, channels: [new Float32Array([0.25]), new Float32Array([-0.25])],
      })),
    } } as MessageEvent<unknown>)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(writerFrameCount).toBeUndefined()
    expect(chunkWritten).toBe(theJob.profile.lanes.length)
    fakeWorker.onmessage?.({ data: {
      kind: 'complete', ...base, sampleRate: 44_100, frameCount: 1,
      lanes: theJob.profile.lanes.map(({ laneId }) => laneId),
    } satisfies WorkerCompleteMessage } as MessageEvent<unknown>)
    await expect(handle.result).resolves.toEqual(theJob.profile.lanes.map(({ laneId }) => `blob-stream/${laneId}`))
    expect(finalized).toBe(theJob.profile.lanes.length)
  })

  test('a generic Worker failure while a lane write is in-flight waits for the write before deleting the result', async () => {
    const order: string[] = []
    let releaseWrite: (() => void) | undefined
    const writeBlocked = new Promise<void>((resolve) => { releaseWrite = resolve })
    let writeStarted: (() => void) | undefined
    const writeStartedSignal = new Promise<void>((resolve) => { writeStarted = resolve })
    let writeCount = 0

    const stemStore: StemStorePort = {
      beginLaneWrite: async () => ({
        writeChunk: async () => {
        writeCount += 1
        if (writeCount === 1) {
          order.push('write-started')
          writeStarted?.()
          await writeBlocked
          order.push('write-resolved')
          return
        }
        // The job never actually completes: this keeps `persist()` from
        // succeeding after the first write is released, so the test proves
        // the wait-then-delete path for a genuinely failed run.
        throw new Error('second_write_failed')
        },
        finalize: async () => undefined,
        abort: async () => undefined,
      }),
      writeLane: async () => undefined,
      readLane: async () => { throw new Error('unused') },
      delete: async () => { order.push('delete-called') },
      exists: async () => false,
      listResultKeys: async () => [],
    }

    const fakeWorker: FakeWorker = {
      postMessage: () => undefined,
      terminate: () => undefined,
      onmessage: null,
      onerror: null,
    }
    const decoder = { decode: async () => ({ sampleRate: 44_100, planarChannels: [new Float32Array([0]), new Float32Array([0])] as const }) }

    const inference = new OnnxWorkerInference({
      modelStore,
      stemStore,
      decoder,
      createWorker: () => fakeWorker,
    })

    const theJob = job('race')
    const handle = inference.run(theJob, () => undefined)

    // Wait until the adapter has wired up the fake Worker's message handlers.
    await new Promise<void>((resolve) => {
      const check = () => (fakeWorker.onmessage ? resolve() : setTimeout(check, 0))
      check()
    })

    fakeWorker.onmessage?.({ data: chunkMessage(theJob) } as MessageEvent<unknown>)
    await writeStartedSignal

    // Simulate an unrelated Worker failure arriving while the write is still in flight.
    fakeWorker.onerror?.({ message: 'boom' } as ErrorEvent)

    // Flush pending microtasks; a buggy "delete without waiting" fail() would already have deleted here.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(order).toEqual(['write-started'])

    releaseWrite?.()
    await expect(handle.result).rejects.toThrow('boom')
    expect(order).toEqual(['write-started', 'write-resolved', 'delete-called'])
  })
})
