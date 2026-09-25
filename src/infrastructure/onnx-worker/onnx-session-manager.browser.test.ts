import { beforeAll, describe, expect, test } from 'vitest'
import { OnnxSessionManager } from './onnx-session-manager'

// Reuses the P7B-01 Rock-shaped synthetic fixture (`mix [1,2,343980]` ->
// `stems [1,6,2,343980]`, tiled x6, scaled x2) so this test proves the real
// `onnxruntime-web` provider-selection path, not a re-derivation of the
// fixture itself (already proven against the WASM provider directly in
// `onnx-fixtures.browser.test.ts`).
import rockFixtureUrl from '../../../tests/infrastructure/onnx-worker/fixtures/rock-synthetic.onnx?url'

const MIX_SHAPE = [1, 2, 343_980] as const
const STEMS_SHAPE = [1, 6, 2, 343_980] as const
const EXPECTED_STEMS_VALUE = 2
const TOLERANCE = 1e-6

function product(shape: readonly number[]): number {
  return shape.reduce((total, dimension) => total * dimension, 1)
}

async function fetchFixtureBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  return new Uint8Array(await response.arrayBuffer())
}

function assertConstantStemsOutput(output: { dims: readonly number[]; data: unknown }, expectedValue: number): void {
  expect(Array.from(output.dims)).toEqual(STEMS_SHAPE)
  const data = output.data as Float32Array
  expect(data.length).toBe(product(STEMS_SHAPE))
  for (let index = 0; index < data.length; index += 1) {
    if (Math.abs(data[index] - expectedValue) > TOLERANCE) {
      throw new Error(`expected element ${index} to be ${expectedValue}, got ${data[index]}`)
    }
  }
}

let rockBytes: Uint8Array

beforeAll(async () => {
  rockBytes = await fetchFixtureBytes(rockFixtureUrl)
})

describe('OnnxSessionManager against a real onnxruntime-web runtime (Chromium)', () => {
  test('forces the WASM provider when navigator.gpu is unavailable, and runs real inference', async () => {
    const manager = new OnnxSessionManager({ navigatorRef: {} })

    const { session, provider } = await manager.createSession(rockBytes)
    expect(provider).toBe('wasm')

    const { Tensor } = await import('onnxruntime-web/webgpu')
    const feeds = { mix: new Tensor('float32', new Float32Array(product(MIX_SHAPE)).fill(1), MIX_SHAPE as unknown as number[]) }
    const results = await session.run(feeds)

    assertConstantStemsOutput(results.stems, EXPECTED_STEMS_VALUE)
  })

  test('detects this browser\'s real navigator.gpu and resolves a runnable provider', async () => {
    const gpuPresent = typeof navigator !== 'undefined' && Boolean((navigator as unknown as { gpu?: unknown }).gpu)
    const manager = new OnnxSessionManager()

    const { session, provider } = await manager.createSession(rockBytes)

    // navigator.gpu only reports that the WebGPU entry point is exposed; it says
    // nothing about a usable adapter. OnnxSessionManager documents a fallback to
    // WASM on any WebGPU session failure, and a GPU-less CI runner exercises
    // exactly that path, so a present-but-unusable GPU legitimately resolves to
    // WASM. Assert the invariants that hold on every platform instead: a
    // provider was chosen, and WebGPU is never chosen without navigator.gpu.
    expect(['webgpu', 'wasm']).toContain(provider)
    if (!gpuPresent) {
      expect(provider).toBe('wasm')
    }

    const { Tensor } = await import('onnxruntime-web/webgpu')
    const feeds = { mix: new Tensor('float32', new Float32Array(product(MIX_SHAPE)).fill(1), MIX_SHAPE as unknown as number[]) }
    const results = await session.run(feeds)

    assertConstantStemsOutput(results.stems, EXPECTED_STEMS_VALUE)
  })
})
