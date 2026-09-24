import { transitionTrack, updateTrackMetadata } from '../domain/track'
import type { CatalogPort } from './ports/catalog-port'
import type { InferencePort } from './ports/inference-port'
import type { ModelStorePort } from './ports/model-store-port'
import type { StemStorePort } from './ports/stem-store-port'
import { separate, type SeparateHandle, type SeparateProgressEvent } from './separate'
import { CANCELLED_ERROR_DETAIL } from './separation-copy'

export interface SeparationQueueDeps {
  readonly catalog: CatalogPort
  readonly stemStore: StemStorePort
  readonly modelStore: ModelStorePort
  readonly inference: InferencePort
  readonly onProgress?: (trackId: string, event: SeparateProgressEvent) => void
}

interface PendingJob {
  readonly trackId: string
  readonly source: Uint8Array
}

/**
 * FIFO admission bounded to one running job at a time (desktop `JobManager`
 * semantics, `job_manager.py:284-343`: extra submissions queue rather than
 * being rejected, and a queued job that gets cancelled never starts).
 *
 * `cancel` on a queued job removes it from the queue and lands the row on
 * `interrupted` without ever calling `separate`; `cancel` on the running job
 * forwards to its `SeparateHandle.terminate()`, whose own settlement lands
 * the row on `interrupted`; `cancel` on a track that is neither queued nor
 * running returns `false`.
 */
export class SeparationQueue {
  private readonly deps: SeparationQueueDeps
  private readonly pending: PendingJob[] = []
  private running: Readonly<{ trackId: string; handle: SeparateHandle }> | undefined

  constructor(deps: SeparationQueueDeps) {
    this.deps = deps
  }

  enqueue(trackId: string, source: Uint8Array): void {
    this.pending.push({ trackId, source })
    this.pump()
  }

  cancel(trackId: string): boolean {
    const pendingIndex = this.pending.findIndex((job) => job.trackId === trackId)
    if (pendingIndex !== -1) {
      this.pending.splice(pendingIndex, 1)
      void this.landQueuedCancelInterrupted(trackId)
      return true
    }

    if (this.running?.trackId === trackId) {
      this.running.handle.terminate()
      return true
    }

    return false
  }

  private async landQueuedCancelInterrupted(trackId: string): Promise<void> {
    const track = await this.deps.catalog.getById(trackId)
    if (track === undefined || (track.status !== 'preparing' && track.status !== 'processing')) {
      return
    }
    const interrupted = updateTrackMetadata(transitionTrack(track, 'interrupted'), {
      errorDetail: CANCELLED_ERROR_DETAIL,
    })
    await this.deps.catalog.update(interrupted)
  }

  private pump(): void {
    if (this.running !== undefined) return
    const next = this.pending.shift()
    if (next === undefined) return

    const handle = separate(next.trackId, next.source, {
      catalog: this.deps.catalog,
      stemStore: this.deps.stemStore,
      modelStore: this.deps.modelStore,
      inference: this.deps.inference,
      onProgress: (event) => this.deps.onProgress?.(next.trackId, event),
    })
    this.running = { trackId: next.trackId, handle }
    void handle.result.finally(() => {
      this.running = undefined
      this.pump()
    })
  }
}
