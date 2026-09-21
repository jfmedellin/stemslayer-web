/**
 * Runs pipeline inference over decoded PCM and writes stem lanes to storage
 * (`docs/decisions/architecture.md`, Runtime topology: fixed-length windows,
 * 25% overlap, cross-fade). Implemented by P7 (ONNX Worker adapter hosting
 * onnxruntime-web).
 *
 * The concrete job/progress payload shapes are defined when P7 designs the
 * worker message protocol; no P3a use case calls this port, so it is
 * declared with `unknown` payloads rather than a speculative contract.
 */
export interface InferencePort {
  run(job: unknown, onProgress: (progress: unknown) => void): Promise<void>
}
