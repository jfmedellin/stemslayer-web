import { describe, expect, test } from 'vitest'

import type { InferenceJob } from '../../../src/application/ports/inference-port'
import type { ModelFootprint, ModelStorePort } from '../../../src/application/ports/model-store-port'
import type { StemStorePort } from '../../../src/application/ports/stem-store-port'
import { BASIC_PROFILE } from '../../../src/domain/stem-profile'
import { OnnxWorkerInference } from '../../../src/infrastructure/onnx-worker/onnx-worker-inference'
import type { WorkerJobMessage, WorkerResultMessage } from '../../../src/infrastructure/onnx-worker/protocol'

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

function resultMessage(job: InferenceJob): WorkerResultMessage {
  return {
    kind: 'result',
    trackId: job.trackId,
    resultKey: job.resultKey,
    sampleRate: 44_100,
    lanes: job.profile.lanes.map(({ laneId }) => ({
      laneId,
      channels: [new Float32Array([0.1]), new Float32Array([-0.1])],
    })),
  }
}

describe('OnnxWorkerInference against a fully injected fake Worker', () => {
  test('a generic Worker failure while a lane write is in-flight waits for the write before deleting the result', async () => {
    const order: string[] = []
    let releaseWrite: (() => void) | undefined
    const writeBlocked = new Promise<void>((resolve) => { releaseWrite = resolve })
    let writeStarted: (() => void) | undefined
    const writeStartedSignal = new Promise<void>((resolve) => { writeStarted = resolve })
    let writeCount = 0

    const stemStore: StemStorePort = {
      writeLane: async () => {
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

    fakeWorker.onmessage?.({ data: resultMessage(theJob) } as MessageEvent<unknown>)
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
