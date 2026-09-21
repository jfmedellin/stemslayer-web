import { describe, expect, test } from 'vitest'
import {
  OnnxSessionManager,
  OnnxSessionUnavailableError,
} from '../../../src/infrastructure/onnx-worker/onnx-session-manager'

/**
 * Pure provider-preference/fallback logic, proven with injected fakes for
 * both `navigator.gpu` and the two session-creation calls — no real
 * `onnxruntime-web` execution needed here, matching the strategy note in
 * `odd/tasks/p7b-onnx-worker.md`'s P7B-02 rules. End-to-end confirmation
 * that the real WASM provider works lives in the sibling
 * `onnx-session-manager.browser.test.ts`.
 */
describe('OnnxSessionManager provider selection', () => {
  test('WebGPU available and session creation succeeds -> WebGPU is used', async () => {
    const fakeSession = { name: 'fake-webgpu-session' } as never
    const createWebGpuSession = async () => fakeSession
    const createWasmSession = async () => {
      throw new Error('must not be called when WebGPU succeeds')
    }
    const manager = new OnnxSessionManager({
      navigatorRef: { gpu: {} },
      createWebGpuSession,
      createWasmSession,
    })

    const result = await manager.createSession(new Uint8Array([1, 2, 3]))

    expect(result.provider).toBe('webgpu')
    expect(result.session).toBe(fakeSession)
  })

  test('WebGPU available but session creation throws -> falls back to WASM', async () => {
    const fakeSession = { name: 'fake-wasm-session' } as never
    const webGpuError = new Error('webgpu session creation failed')
    const manager = new OnnxSessionManager({
      navigatorRef: { gpu: {} },
      createWebGpuSession: async () => {
        throw webGpuError
      },
      createWasmSession: async () => fakeSession,
    })

    const result = await manager.createSession(new Uint8Array([1, 2, 3]))

    expect(result.provider).toBe('wasm')
    expect(result.session).toBe(fakeSession)
  })

  test('WebGPU unavailable (navigator.gpu undefined) -> WASM directly, without trying WebGPU', async () => {
    const fakeSession = { name: 'fake-wasm-session' } as never
    const createWebGpuSession = async () => {
      throw new Error('must not be called when navigator.gpu is absent')
    }
    const manager = new OnnxSessionManager({
      navigatorRef: {},
      createWebGpuSession,
      createWasmSession: async () => fakeSession,
    })

    const result = await manager.createSession(new Uint8Array([1, 2, 3]))

    expect(result.provider).toBe('wasm')
    expect(result.session).toBe(fakeSession)
  })

  test('both providers fail -> typed error carrying both causes', async () => {
    const webGpuError = new Error('webgpu session creation failed')
    const wasmError = new Error('wasm session creation failed')
    const manager = new OnnxSessionManager({
      navigatorRef: { gpu: {} },
      createWebGpuSession: async () => {
        throw webGpuError
      },
      createWasmSession: async () => {
        throw wasmError
      },
    })

    await expect(manager.createSession(new Uint8Array([1, 2, 3]))).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(OnnxSessionUnavailableError)
      const unavailable = error as OnnxSessionUnavailableError
      expect(unavailable.webGpuCause).toBe(webGpuError)
      expect(unavailable.wasmCause).toBe(wasmError)
      return true
    })
  })

  test('when navigator.gpu is absent, the recorded WebGPU cause explains why', async () => {
    const wasmError = new Error('wasm session creation failed')
    const manager = new OnnxSessionManager({
      navigatorRef: {},
      createWasmSession: async () => {
        throw wasmError
      },
    })

    await expect(manager.createSession(new Uint8Array([1, 2, 3]))).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(OnnxSessionUnavailableError)
      const unavailable = error as OnnxSessionUnavailableError
      expect(unavailable.webGpuCause).toBeInstanceOf(Error)
      expect((unavailable.webGpuCause as Error).message).toContain('navigator.gpu is not present')
      expect(unavailable.wasmCause).toBe(wasmError)
      return true
    })
  })
})
