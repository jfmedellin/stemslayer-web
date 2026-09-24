import * as ort from 'onnxruntime-web/webgpu'

// No COOP/COEP headers in this app (`docs/decisions/spike-s2.md`, S2's own
// finding): WASM must run single-threaded, or it fails to initialize
// without `SharedArrayBuffer`. Set once at module load, matching the S2
// harness (`spikes/s2/harness.worker.js`) and P7B-01's own fixture test.
ort.env.wasm.numThreads = 1

/** Which onnxruntime-web execution provider a created session actually runs on. */
export type OnnxProvider = 'webgpu' | 'wasm'

/** A created `InferenceSession` plus the provider it actually ended up using. */
export interface OnnxSessionResult {
  readonly session: ort.InferenceSession
  readonly provider: OnnxProvider
}

/** Bytes onnxruntime-web accepts to build an `InferenceSession`. */
export type OnnxModelBytes = ArrayBuffer | Uint8Array

/**
 * Thrown when neither the WebGPU nor the WASM execution provider could
 * create a session. Carries both underlying causes so a caller (or this
 * task's own tracker evidence) can report why each provider was rejected,
 * matching the spike's own habit of surfacing the exact error text
 * (`spikes/s2/HARNESS.md`, "WebGPU concern") instead of swallowing it.
 */
export class OnnxSessionUnavailableError extends Error {
  readonly webGpuCause: unknown
  readonly wasmCause: unknown

  constructor(webGpuCause: unknown, wasmCause: unknown) {
    super('onnx-session.unavailable')
    this.name = 'OnnxSessionUnavailableError'
    this.webGpuCause = webGpuCause
    this.wasmCause = wasmCause
  }
}

/** The minimal shape this module reads off `navigator`; injectable for tests. */
export interface NavigatorGpuLike {
  readonly gpu?: unknown
}

type SessionFactory = (bytes: OnnxModelBytes) => Promise<ort.InferenceSession>

export interface OnnxSessionManagerOptions {
  /**
   * Defaults to the real `navigator`, or `{}` when `navigator` does not
   * exist (e.g. a Node test project). Inject `{ gpu: undefined }` /
   * `{ gpu: {} }` to force the "unavailable" / "present" branch
   * deterministically in a test, matching S2's own `detectGpu()`
   * (`spikes/s2/harness.js`), which checks `!!navigator.gpu` the same way.
   */
  readonly navigatorRef?: NavigatorGpuLike
  /** Defaults to a real `ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'] })`. */
  readonly createWebGpuSession?: SessionFactory
  /** Defaults to a real `ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] })`. */
  readonly createWasmSession?: SessionFactory
}

/**
 * Creates `onnxruntime-web` sessions with WebGPU preferred and WASM as a
 * real, always-available fallback (`docs/decisions/spike-s2.md`'s runtime
 * decision). Any failure creating the WebGPU session — `navigator.gpu`
 * missing, an adapter request failing inside onnxruntime-web, or the
 * session-creation call itself throwing (e.g. a rejected graph) — falls
 * back to WASM rather than propagating. Only when WASM also fails does
 * `createSession` reject, with `OnnxSessionUnavailableError` carrying both
 * causes.
 */
export class OnnxSessionManager {
  private readonly navigatorRef: NavigatorGpuLike
  private readonly createWebGpuSession: SessionFactory
  private readonly createWasmSession: SessionFactory

  constructor(options: OnnxSessionManagerOptions = {}) {
    this.navigatorRef = options.navigatorRef ?? (typeof navigator === 'undefined' ? {} : navigator)
    this.createWebGpuSession = options.createWebGpuSession ?? defaultCreateWebGpuSession
    this.createWasmSession = options.createWasmSession ?? defaultCreateWasmSession
  }

  async createSession(modelBytes: OnnxModelBytes): Promise<OnnxSessionResult> {
    let webGpuCause: unknown

    if (this.navigatorRef.gpu) {
      try {
        const session = await this.createWebGpuSession(modelBytes)
        return { session, provider: 'webgpu' }
      } catch (error) {
        webGpuCause = error
      }
    } else {
      webGpuCause = new Error('onnx-session.webgpu-unavailable: navigator.gpu is not present')
    }

    try {
      const session = await this.createWasmSession(modelBytes)
      return { session, provider: 'wasm' }
    } catch (wasmCause) {
      throw new OnnxSessionUnavailableError(webGpuCause, wasmCause)
    }
  }
}

function defaultCreateWebGpuSession(bytes: OnnxModelBytes): Promise<ort.InferenceSession> {
  return ort.InferenceSession.create(toUint8Array(bytes), { executionProviders: ['webgpu'] })
}

function defaultCreateWasmSession(bytes: OnnxModelBytes): Promise<ort.InferenceSession> {
  return ort.InferenceSession.create(toUint8Array(bytes), { executionProviders: ['wasm'] })
}

/** onnxruntime-web's typings only overload `create` for `Uint8Array` or a bare `ArrayBufferLike`; normalize here so a caller can still pass either. */
function toUint8Array(bytes: OnnxModelBytes): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
}
