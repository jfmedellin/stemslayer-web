import {
  InferenceCancelled,
  type InferenceHandle,
  type InferenceJob,
  type InferencePort,
  type InferenceProgress,
} from '../../src/application/ports/inference-port'
import type { InMemoryStemStore } from './in-memory-stem-store'

/**
 * Scriptable by track id: `scriptSuccess` resolves with the given lane keys
 * and writes them into the injected `InMemoryStemStore` (standing in for the
 * real adapter writing each lane through `StemStorePort` from the Worker);
 * `scriptFailure` rejects with the given error; an unscripted track id hangs
 * until `terminate()` is called, matching a real run in flight.
 */
export class FakeInference implements InferencePort {
  readonly writtenLaneKeysByTrackId = new Map<string, readonly string[]>()

  private readonly successLaneKeysByTrackId = new Map<string, readonly string[]>()
  private readonly failuresByTrackId = new Map<string, Error>()

  constructor(private readonly stemStore: InMemoryStemStore) {}

  scriptSuccess(trackId: string, laneKeys: readonly string[]): void {
    this.successLaneKeysByTrackId.set(trackId, laneKeys)
  }

  scriptFailure(trackId: string, error: Error): void {
    this.failuresByTrackId.set(trackId, error)
  }

  run(job: InferenceJob, onProgress: (progress: InferenceProgress) => void): InferenceHandle {
    let settled = false
    let rejectResult: ((error: Error) => void) | undefined

    const result = new Promise<readonly string[]>((resolve, reject) => {
      rejectResult = (error) => {
        if (settled) return
        settled = true
        reject(error)
      }

      queueMicrotask(() => {
        if (settled) return

        const failure = this.failuresByTrackId.get(job.trackId)
        if (failure !== undefined) {
          settled = true
          reject(failure)
          return
        }

        const laneKeys = this.successLaneKeysByTrackId.get(job.trackId)
        if (laneKeys === undefined) return // unscripted: hang until terminate()

        onProgress({ window: 1, totalWindows: 1 })
        for (const key of laneKeys) this.stemStore.seed(key)
        this.writtenLaneKeysByTrackId.set(job.trackId, laneKeys)
        settled = true
        resolve(laneKeys)
      })
    })

    return {
      result,
      terminate: () => rejectResult?.(new InferenceCancelled()),
    }
  }
}
