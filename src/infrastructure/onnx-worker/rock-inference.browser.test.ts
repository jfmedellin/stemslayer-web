import { beforeAll, describe, expect, test, vi } from 'vitest'

import { OnnxSessionManager } from './onnx-session-manager'
import { MODEL_WINDOW_STRIDE } from './windowing'
import { runRockInference } from './rock-inference'

// Reuses the P7B-01 Rock-shaped synthetic fixture (`mix [1,2,343980]` ->
// `stems [1,6,2,343980]`, tiled x6, scaled x2): each stem's output equals the
// input mix scaled by the fixture's own deterministic constant (2), the same
// for every one of the 6 stems. Overlap-add is a linear, per-channel
// operation (proven generically in `windowing.test.ts`'s identity
// reconstruction), so reconstructing this scale-by-2 transform end to end
// must reproduce `2 * originalMix` within the same 1e-6 tolerance.
import rockFixtureUrl from '../../../tests/infrastructure/onnx-worker/fixtures/rock-synthetic.onnx?url'

const EXPECTED_STEM_SCALE = 2
const EXPECTED_STEM_COUNT = 6
const TOLERANCE = 1e-6

async function fetchFixtureBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  return new Uint8Array(await response.arrayBuffer())
}

function signal(length: number, phase: number): Float32Array {
  return Float32Array.from({ length }, (_, index) => Math.sin((index + phase) * 0.013) * 0.5)
}

function maxError(actual: Float32Array, expected: Float32Array): number {
  let maximum = 0
  for (let index = 0; index < actual.length; index += 1) {
    maximum = Math.max(maximum, Math.abs(actual[index] - expected[index]))
  }
  return maximum
}

let rockBytes: Uint8Array

beforeAll(async () => {
  rockBytes = await fetchFixtureBytes(rockFixtureUrl)
})

describe('runRockInference against the Rock-shaped synthetic fixture (Chromium)', () => {
  test('produces 6 full-length stereo stems reconstructing the fixture\'s known scale-by-2 transform', async () => {
    // 3 windows: offsets 0, MODEL_WINDOW_STRIDE, MODEL_WINDOW_STRIDE * 2 all
    // fall before frameCount, matching windowing.test.ts's own "partial
    // final" shape.
    const frameCount = MODEL_WINDOW_STRIDE * 2 + 1_000
    const mix = [signal(frameCount, 0), signal(frameCount, 17)]

    const manager = new OnnxSessionManager({ navigatorRef: {} })
    const { session } = await manager.createSession(rockBytes)

    const progress = vi.fn()
    const result = await runRockInference(session, mix, progress)

    expect(result.stemCount).toBe(EXPECTED_STEM_COUNT)
    expect(result.channelsPerStem).toBe(mix.length)
    expect(result.stems).toHaveLength(EXPECTED_STEM_COUNT)

    expect(progress.mock.calls.map(([event]) => event)).toEqual([
      { window: 1, totalWindows: 3 },
      { window: 2, totalWindows: 3 },
      { window: 3, totalWindows: 3 },
    ])

    for (const stem of result.stems) {
      expect(stem).toHaveLength(mix.length)
      for (let channel = 0; channel < mix.length; channel += 1) {
        expect(stem[channel]).toHaveLength(frameCount)
        const expected = Float32Array.from(mix[channel], (sample) => sample * EXPECTED_STEM_SCALE)
        expect(maxError(stem[channel], expected)).toBeLessThanOrEqual(TOLERANCE)
      }
    }
  })

  test('reports monotonically increasing window progress even for a single-window signal', async () => {
    // A short natural chunk (well under one stride) always yields exactly
    // one window (`createWindowOffsets`'s own "short" case).
    const mix = [signal(10, 3), signal(10, 41)]

    const manager = new OnnxSessionManager({ navigatorRef: {} })
    const { session } = await manager.createSession(rockBytes)

    const seenWindows: number[] = []
    const result = await runRockInference(session, mix, (event) => {
      seenWindows.push(event.window)
    })

    expect(seenWindows).toEqual([1])
    expect(result.stems).toHaveLength(EXPECTED_STEM_COUNT)
  })
})
