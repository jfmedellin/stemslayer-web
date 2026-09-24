import type { NavigatorGpuLike, OnnxProvider } from '../../infrastructure/onnx-worker/onnx-session-manager'

/**
 * Display-only echo of `OnnxSessionManager`'s own `navigator.gpu` presence
 * check (`docs/decisions/design-reference.md` section 4, T3). This never
 * creates a session or repeats the WebGPU-then-WASM fallback trial — it
 * only mirrors the same truthy check so the "Engine" readout matches what
 * `OnnxSessionManager.createSession` will actually attempt first.
 */
export function detectEngineProvider(navigatorRef: NavigatorGpuLike): OnnxProvider {
  return navigatorRef.gpu ? 'webgpu' : 'wasm'
}
