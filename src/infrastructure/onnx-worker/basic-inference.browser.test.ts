import { beforeAll, describe, expect, test } from 'vitest'

import { OnnxSessionManager } from './onnx-session-manager'
import { MODEL_SEGMENT_SAMPLES, MODEL_WINDOW_STRIDE, type WindowProgress } from './windowing'
import { runBasicInference } from './basic-inference'

// Reuses the P7B-01 Basic-shaped synthetic fixture (`mix [1,2,343980]` +
// `mag [1,4,2048,336]` -> `freq [1,4,4,2048,336]` tiled x4 and scaled x3,
// `time [1,4,2,343980]` tiled x4 and scaled x5): every one of the 4 sources
// applies the exact same transform, so `freq`'s branch is `iSTFT(3 * mag)`,
// which P7a's own round-trip proves `≈ 3x` the original signal, and `time`'s
// branch is exactly `5x` the original mix (no STFT involved). Summed
// (`combineFrequencyAndTimeBranches`), each of the 8 lanes should reconstruct
// `≈ 8x` the original stereo signal, identically across all 4 sources.
import basicFixtureUrl from '../../../tests/infrastructure/onnx-worker/fixtures/basic-synthetic.onnx?url'

const EXPECTED_LANE_SCALE = 8
const SOURCE_COUNT = 4
const CHANNEL_COUNT = 2

/**
 * Measured empirically (see this task's report): unlike a raw single
 * `MODEL_SEGMENT_SAMPLES` window (which carries HTDemucs' own known lossy
 * `_spec`/`_ispec` edge inaccuracy near the model segment's own boundaries,
 * documented in `stft.test.ts`'s `DemucsSpecFixture` comment), this test's
 * two-window track keeps the first complete window aligned with the model
 * segment. As documented by `basic-inference.test.ts`, HTDemucs' lossy CAC
 * round-trip is accurate in the interior but has a bounded edge artifact,
 * so this browser proof keeps tight interior and explicit edge assertions
 * rather than pretending the synthetic identity mask is lossless.
 */
const TOLERANCE = 1e-3
const EDGE_MARGIN = 2000
const EDGE_SANITY_BOUND = 0.7

function signal(length: number, phase: number): Float32Array {
  return Float32Array.from({ length }, (_, index) => Math.sin((index + phase) * 0.0007) * 0.5)
}

function maxError(actual: Float32Array, expected: Float32Array): number {
  let maximum = 0
  for (let index = 0; index < actual.length; index += 1) {
    maximum = Math.max(maximum, Math.abs(actual[index] - expected[index]))
  }
  return maximum
}

async function fetchFixtureBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  return new Uint8Array(await response.arrayBuffer())
}

let basicBytes: Uint8Array

beforeAll(async () => {
  basicBytes = await fetchFixtureBytes(basicFixtureUrl)
})

describe('runBasicInference against the Basic-shaped synthetic fixture (Chromium)', () => {
  test(
    'reconstructs the fixture\'s known scale-by-8 transform (freq via STFT round-trip + time) across 2 overlapping windows, with monotonic progress',
    async () => {
      const frameCount = MODEL_SEGMENT_SAMPLES + 5
      const mix = [signal(frameCount, 0), signal(frameCount, 17)]

      const manager = new OnnxSessionManager({ navigatorRef: {} })
      const { session } = await manager.createSession(basicBytes)

      const progress: WindowProgress[] = []
      const result = await runBasicInference(session, mix, (event) => progress.push(event))

      expect(progress).toEqual([
        { window: 1, totalWindows: 2 },
        { window: 2, totalWindows: 2 },
      ])
      expect(result.stemCount).toBe(SOURCE_COUNT)
      expect(result.channelsPerStem).toBe(CHANNEL_COUNT)
      expect(result.stems).toHaveLength(SOURCE_COUNT)

      const channels = [mix[0], mix[1]]
      let maxInteriorError = 0
      let maxEdgeError = 0
      for (let source = 0; source < SOURCE_COUNT; source += 1) {
        for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
          const lane = result.stems[source][channel]
          expect(lane).toHaveLength(frameCount)

          const expected = Float32Array.from(channels[channel], (sample) => sample * EXPECTED_LANE_SCALE)
          maxInteriorError = Math.max(
            maxInteriorError,
            maxError(lane.subarray(EDGE_MARGIN, MODEL_WINDOW_STRIDE - EDGE_MARGIN), expected.subarray(EDGE_MARGIN, MODEL_WINDOW_STRIDE - EDGE_MARGIN)),
          )
          maxEdgeError = Math.max(
            maxEdgeError,
            maxError(lane.subarray(0, EDGE_MARGIN), expected.subarray(0, EDGE_MARGIN)),
            maxError(lane.subarray(MODEL_WINDOW_STRIDE - EDGE_MARGIN), expected.subarray(MODEL_WINDOW_STRIDE - EDGE_MARGIN)),
          )
        }
      }

      expect(maxInteriorError).toBeLessThanOrEqual(TOLERANCE)
      expect(maxEdgeError).toBeLessThan(EDGE_SANITY_BOUND)
    },
    120_000,
  )
})
