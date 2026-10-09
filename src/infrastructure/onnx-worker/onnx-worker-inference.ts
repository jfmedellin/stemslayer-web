import {
  InferenceCancelled,
  type InferenceHandle,
  type InferenceJob,
  type InferencePort,
  type InferenceProgress,
} from '../../application/ports/inference-port'
import type { ModelStorePort } from '../../application/ports/model-store-port'
import type { StemLaneWriteSession, StemStorePort } from '../../application/ports/stem-store-port'
import { WebAudioInferenceDecoder, type DecodedInferenceAudio } from './audio-decoder'
import {
  isWorkerOutboundMessage,
  type WorkerAckMessage,
  type WorkerJobMessage,
  type WorkerChunkMessage,
  type WorkerCompleteMessage,
} from './protocol'

interface AudioDecoder {
  decode(source: Uint8Array): Promise<DecodedInferenceAudio>
}

interface WorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: WorkerJobMessage | WorkerAckMessage, transfer?: Transferable[]): void
  terminate(): void
}

export interface OnnxWorkerInferenceOptions {
  readonly modelStore: ModelStorePort
  readonly stemStore: StemStorePort
  readonly decoder?: AudioDecoder
  readonly createWorker?: () => WorkerLike
}

function createModuleWorker(): WorkerLike {
  return new Worker(new URL('./onnx-worker-entry.ts', import.meta.url), { type: 'module' })
}

function workerFailure(message: string): Error {
  return new Error(`onnx-worker-inference.failed:${message}`)
}

/** Main-thread `InferencePort` adapter around one dedicated module Worker per run. */
export class OnnxWorkerInference implements InferencePort {
  private readonly modelStore: ModelStorePort
  private readonly stemStore: StemStorePort
  private readonly decoder: AudioDecoder
  private readonly createWorker: () => WorkerLike

  constructor(options: OnnxWorkerInferenceOptions) {
    this.modelStore = options.modelStore
    this.stemStore = options.stemStore
    this.decoder = options.decoder ?? new WebAudioInferenceDecoder()
    this.createWorker = options.createWorker ?? createModuleWorker
  }

  run(job: InferenceJob, onProgress: (progress: InferenceProgress) => void): InferenceHandle {
    let worker: WorkerLike | undefined
    let cancelled = false
    let finishing = false
    let settled = false
    let lastWindow = 0
    let totalWindows: number | undefined
    let persistence: Promise<void> | undefined
    let expectedFrameCount: number | undefined
    let nextChunkIndex = 0
    let nextOffset = 0
    const laneWriters = new Map<string, StemLaneWriteSession>()
    let resolveResult!: (keys: readonly string[]) => void
    let rejectResult!: (error: unknown) => void

    const result = new Promise<readonly string[]>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })

    const cleanup = (): Promise<void> => this.stemStore.delete(job.resultKey)
    const abortWriters = async (): Promise<void> => {
      const failures: unknown[] = []
      for (const writer of laneWriters.values()) {
        try { await writer.abort() } catch (error) { failures.push(error) }
      }
      laneWriters.clear()
      if (failures.length > 0) throw new AggregateError(failures, 'onnx-worker-inference.abort_failed')
    }
    const terminateWorker = (): void => {
      worker?.terminate()
      worker = undefined
    }
    const fail = async (error: unknown): Promise<void> => {
      if (settled || finishing) return
      finishing = true
      terminateWorker()
      await (persistence?.catch(() => undefined) ?? Promise.resolve())
      if (settled) return
      try { await abortWriters() } catch (abortError) {
        error = new AggregateError([error, abortError], 'onnx-worker-inference.abort_failed')
      }
      try {
        await cleanup()
      } catch (cleanupError) {
        if (error instanceof InferenceCancelled) {
          Object.defineProperty(error, 'cause', { value: cleanupError })
        } else {
          error = new AggregateError([error, cleanupError], 'onnx-worker-inference.cleanup_failed')
        }
      }
      settled = true
      rejectResult(error)
    }

    const checkCorrelation = (message: { trackId: string; resultKey: string }): boolean =>
      message.trackId === job.trackId && message.resultKey === job.resultKey

    const expectedIds = job.profile.lanes.map(({ laneId }) => laneId)
    const streamingSource = job.source instanceof Blob && (job.sourceFormat === 'MP3' || job.sourceFormat === 'WAV')
    const persistChunk = async (message: WorkerChunkMessage): Promise<void> => {
      if (
        message.sampleRate !== 44_100
        || (expectedFrameCount === undefined ? message.frameCount !== null : message.frameCount !== expectedFrameCount)
        || message.chunkIndex !== nextChunkIndex
        || message.offset !== nextOffset
        || JSON.stringify(message.lanes.map(({ laneId }) => laneId)) !== JSON.stringify(expectedIds)
      ) throw workerFailure('chunk_contract')

      if (laneWriters.size === 0) {
        for (const laneId of expectedIds) {
          laneWriters.set(laneId, await this.stemStore.beginLaneWrite(
            job.resultKey, laneId, message.sampleRate, message.frameCount ?? undefined,
          ))
        }
      }
      const chunkLength = message.lanes[0].channels[0].length
      for (const lane of message.lanes) {
        const writer = laneWriters.get(lane.laneId)
        if (writer === undefined) throw workerFailure('chunk_lane_contract')
        await writer.writeChunk(lane.channels)
      }
      nextChunkIndex += 1
      nextOffset += chunkLength
      if (cancelled) throw new InferenceCancelled()
      worker?.postMessage({
        kind: 'ack',
        trackId: job.trackId,
        resultKey: job.resultKey,
        chunkIndex: message.chunkIndex,
      })
    }

    const finalize = async (message: WorkerCompleteMessage): Promise<void> => {
      if (
        message.sampleRate !== 44_100
        || (expectedFrameCount !== undefined && message.frameCount !== expectedFrameCount)
        || nextOffset !== message.frameCount
        || JSON.stringify(message.lanes) !== JSON.stringify(expectedIds)
        || laneWriters.size !== expectedIds.length
      ) throw workerFailure('completion_contract')
      for (const laneId of expectedIds) {
        if (cancelled) throw new InferenceCancelled()
        const writer = laneWriters.get(laneId)
        if (writer === undefined) throw workerFailure('completion_lane_contract')
        await writer.finalize()
      }
      if (cancelled) throw new InferenceCancelled()
      laneWriters.clear()
      terminateWorker()
      settled = true
      resolveResult(Object.freeze(expectedIds.map((laneId) => `${job.resultKey}/${laneId}`)))
    }

    const start = async (): Promise<void> => {
      try {
        if (job.source instanceof Blob && !streamingSource) throw workerFailure('unsupported_streaming_format')
        await this.modelStore.ensure(job.profile.profileId, () => undefined)
        if (cancelled) return
        const modelBytes = await this.modelStore.read(job.profile.profileId)
        if (cancelled) return
        let decoded: DecodedInferenceAudio | undefined
        if (job.source instanceof Blob) {
          if (!streamingSource) throw workerFailure('unsupported_streaming_format')
        } else {
          decoded = await this.decoder.decode(job.source)
          if (cancelled) return
          expectedFrameCount = decoded.planarChannels[0].length
        }

        worker = this.createWorker()
        worker.onerror = (event) => { void fail(workerFailure(event.message)) }
        worker.onmessage = (event) => {
          if (cancelled || settled || finishing) return
          const message = event.data
          if (!isWorkerOutboundMessage(message) || !checkCorrelation(message)) {
            void fail(workerFailure('malformed_or_uncorrelated_message'))
            return
          }
          if (message.kind === 'progress') {
            if (
              message.window < lastWindow
              || (totalWindows !== undefined && totalWindows !== message.totalWindows)
            ) {
              void fail(workerFailure('non_monotonic_progress'))
              return
            }
            lastWindow = message.window
            totalWindows = message.totalWindows
            try {
              onProgress({ window: message.window, totalWindows: message.totalWindows })
            } catch (error) {
              void fail(error)
            }
            return
          }
          if (message.kind === 'error') {
            void fail(message.cancelled ? new InferenceCancelled() : workerFailure(message.message))
            return
          }
          persistence = message.kind === 'chunk' ? persistChunk(message) : finalize(message)
          void persistence.catch((error: unknown) => { void fail(error) })
        }

        const common = {
          kind: 'job',
          trackId: job.trackId,
          resultKey: job.resultKey,
          profileId: job.profile.profileId,
          modelBytes,
        } as const
        const message: WorkerJobMessage = streamingSource
          ? { ...common, source: job.source as Blob, sourceFormat: job.sourceFormat! }
          : { ...common, sampleRate: decoded!.sampleRate, planarChannels: decoded!.planarChannels }
        const transfer: Transferable[] = [modelBytes.buffer as ArrayBuffer]
        if (decoded !== undefined) transfer.push(...decoded.planarChannels.map(({ buffer }) => buffer as ArrayBuffer))
        worker.postMessage(message, transfer)
      } catch (error) {
        if (!cancelled) await fail(error)
      }
    }

    void start()

    return {
      result,
      terminate: () => {
        if (cancelled || settled || finishing) return
        cancelled = true
        finishing = true
        terminateWorker()
        const persistenceStopped = persistence?.catch(() => undefined) ?? Promise.resolve()
        const stopAndCleanup = async (): Promise<void> => {
          let failure: unknown
          try { await abortWriters() } catch (error) { failure = error }
          try { await cleanup() } catch (error) {
            failure = failure === undefined ? error : new AggregateError([failure, error], 'onnx-worker-inference.cleanup_failed')
          }
          if (failure !== undefined) throw failure
        }
        void persistenceStopped.then(stopAndCleanup).then(() => {
          settled = true
          rejectResult(new InferenceCancelled())
        }, (error: unknown) => {
          settled = true
          const cancellation = new InferenceCancelled()
          Object.defineProperty(cancellation, 'cause', { value: error })
          rejectResult(cancellation)
        })
      },
    }
  }
}
