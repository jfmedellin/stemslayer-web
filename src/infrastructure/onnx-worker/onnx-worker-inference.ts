import {
  InferenceCancelled,
  type InferenceHandle,
  type InferenceJob,
  type InferencePort,
  type InferenceProgress,
} from '../../application/ports/inference-port'
import type { ModelStorePort } from '../../application/ports/model-store-port'
import type { StemStorePort } from '../../application/ports/stem-store-port'
import { encodeFloat32Wav } from '../opfs/float32-wav'
import { WebAudioInferenceDecoder, type DecodedInferenceAudio } from './audio-decoder'
import {
  isWorkerOutboundMessage,
  type WorkerJobMessage,
  type WorkerResultMessage,
} from './protocol'

interface AudioDecoder {
  decode(source: Uint8Array): Promise<DecodedInferenceAudio>
}

interface WorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: WorkerJobMessage, transfer: Transferable[]): void
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
    let resolveResult!: (keys: readonly string[]) => void
    let rejectResult!: (error: unknown) => void

    const result = new Promise<readonly string[]>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })

    const cleanup = (): Promise<void> => this.stemStore.delete(job.resultKey)
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

    const persist = async (message: WorkerResultMessage): Promise<void> => {
      const expectedIds = job.profile.lanes.map(({ laneId }) => laneId)
      const actualIds = message.lanes.map(({ laneId }) => laneId)
      if (message.sampleRate !== 44_100 || JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
        throw workerFailure('result_contract')
      }

      const keys: string[] = []
      for (const lane of message.lanes) {
        if (cancelled) throw new InferenceCancelled()
        const bytes = encodeFloat32Wav({ sampleRate: message.sampleRate, planar: lane.channels })
        await this.stemStore.writeLane(job.resultKey, lane.laneId, bytes)
        if (cancelled) throw new InferenceCancelled()
        keys.push(`${job.resultKey}/${lane.laneId}`)
      }
      if (cancelled) throw new InferenceCancelled()

      terminateWorker()
      settled = true
      resolveResult(Object.freeze(keys))
    }

    const start = async (): Promise<void> => {
      try {
        await this.modelStore.ensure(job.profile.profileId, () => undefined)
        if (cancelled) return
        const modelBytes = await this.modelStore.read(job.profile.profileId)
        if (cancelled) return
        const decoded = await this.decoder.decode(job.source)
        if (cancelled) return

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
          persistence = persist(message)
          void persistence.catch(fail)
        }

        const message: WorkerJobMessage = {
          kind: 'job',
          trackId: job.trackId,
          resultKey: job.resultKey,
          profileId: job.profile.profileId,
          sampleRate: decoded.sampleRate,
          modelBytes,
          planarChannels: decoded.planarChannels,
        }
        const transfer: Transferable[] = [
          modelBytes.buffer as ArrayBuffer,
          ...decoded.planarChannels.map(({ buffer }) => buffer as ArrayBuffer),
        ]
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
        void persistenceStopped.then(cleanup).then(() => {
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
