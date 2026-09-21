/**
 * Worker message protocol shared by the main-thread `OnnxWorkerInference`
 * adapter and the ONNX Worker script (P7B-05). Pure discriminated-union
 * types plus a shallow type guard — no `onnxruntime-web`, DOM, or Worker
 * global dependency — so this module runs in the Node test project as well
 * as the browser.
 */

/**
 * Sent once, main thread -> Worker: starts a separation job.
 *
 * `planarChannels` is already-decoded planar audio for the whole track, one
 * `Float32Array` per channel, ready to hand to P7a's `processPlanarWindows`
 * inside the Worker. This protocol never decodes audio itself: turning
 * `InferenceJob.source` bytes (`application/ports/inference-port.ts`) into
 * this planar shape happens in whatever code constructs this message, not
 * here.
 */
export interface WorkerJobMessage {
  readonly kind: 'job'
  /** `InferenceJob.trackId`; echoed back on every progress/result/error message for correlation. */
  readonly trackId: string
  /**
   * `InferenceJob.profile.profileId` only — the Worker resolves its ONNX
   * session and `PlanarWindowProcessor` from this id and never receives the
   * full `StemProfile` (lane display metadata stays on the main thread/UI).
   */
  readonly profileId: string
  /** `InferenceJob.resultKey`, forwarded to `StemStorePort.writeLane` inside the Worker. */
  readonly resultKey: string
  /** Whole-track planar audio, already decoded; see the interface comment above. */
  readonly planarChannels: readonly Float32Array[]
}

/** Sent repeatedly, Worker -> main thread: one `processPlanarWindows` window completed. */
export interface WorkerProgressMessage {
  readonly kind: 'progress'
  readonly trackId: string
  /** Matches `InferenceProgress` (`application/ports/inference-port.ts`) exactly. */
  readonly window: number
  readonly totalWindows: number
}

/** Sent once on success, Worker -> main thread: every stem lane was written. */
export interface WorkerResultMessage {
  readonly kind: 'result'
  readonly trackId: string
  /** The `StemStorePort.writeLane` keys the Worker wrote; resolves `InferenceHandle.result`. */
  readonly laneKeys: readonly string[]
}

/**
 * Sent once on failure or cancellation, Worker -> main thread.
 *
 * `cancelled` distinguishes a `terminate()`-triggered abort from any other
 * failure: the main-thread adapter rejects the pending
 * `InferenceHandle.result` with `InferenceCancelled`
 * (`application/ports/inference-port.ts`) only when `cancelled` is `true`,
 * and with a plain `Error` otherwise.
 */
export interface WorkerErrorMessage {
  readonly kind: 'error'
  readonly trackId: string
  readonly message: string
  readonly cancelled: boolean
}

/** Every message the Worker ever posts back to the main thread. */
export type WorkerOutboundMessage = WorkerProgressMessage | WorkerResultMessage | WorkerErrorMessage

/** Every message either side of the Worker boundary can send. */
export type WorkerMessage = WorkerJobMessage | WorkerOutboundMessage

const WORKER_MESSAGE_KINDS: ReadonlySet<WorkerMessage['kind']> = new Set(['job', 'progress', 'result', 'error'])

/**
 * Shallow discriminant check: confirms `value` is a non-null object with a
 * recognized `kind`. It does not validate the remaining fields for that
 * kind — deep payload validation belongs to the Worker's own message
 * handler (P7B-05), which owns the trust boundary with a real `postMessage`
 * origin.
 */
export function isWorkerMessage(value: unknown): value is WorkerMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const kind = (value as { kind?: unknown }).kind
  return typeof kind === 'string' && WORKER_MESSAGE_KINDS.has(kind as WorkerMessage['kind'])
}
