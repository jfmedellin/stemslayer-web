import type { StemProfile } from '../../domain/stem-profile'

/**
 * One separation job handed to the inference runtime.
 *
 * `source` is deliberately opaque beyond "bytes or a decoded-PCM handle":
 * P3b never decodes audio (P9's job), so it only ever carries the raw file
 * bytes through; the real adapter (P7) decides how to turn that into the
 * fixed-length, 25%-overlap windows described in
 * `docs/decisions/architecture.md`'s Runtime topology.
 */
export interface InferenceJob {
  readonly trackId: string
  readonly profile: StemProfile
  readonly source: Uint8Array
  readonly resultKey: string
}

/** One inference window has completed, out of the job's fixed total. */
export interface InferenceProgress {
  readonly window: number
  readonly totalWindows: number
}

/** Raised by a pending `InferenceHandle.result` after `terminate()`. */
export class InferenceCancelled extends Error {
  constructor() {
    super('inference.cancelled')
    this.name = 'InferenceCancelled'
  }
}

export interface InferenceHandle {
  /**
   * Resolves with the stem-store keys written for every lane once inference
   * completes; rejects with `InferenceCancelled` after `terminate()`, or
   * with any other error the run failed with.
   */
  readonly result: Promise<readonly string[]>
  /** Aborts the run; the pending `result` rejects with `InferenceCancelled`. */
  terminate(): void
}

/**
 * Runs pipeline inference over the job's source and writes stem lanes to
 * storage (`docs/decisions/architecture.md`, Runtime topology: fixed-length
 * windows, 25% overlap, cross-fade). Implemented by P7 (ONNX Worker adapter
 * hosting onnxruntime-web, writing each lane through `StemStorePort` from
 * inside the Worker).
 */
export interface InferencePort {
  run(job: InferenceJob, onProgress: (progress: InferenceProgress) => void): InferenceHandle
}
