import { describe, expect, test } from 'vitest'

import { MODEL_SEGMENT_SAMPLES } from '../../../src/infrastructure/onnx-worker/windowing'
import { createBasicWindowProcessor } from '../../../src/infrastructure/onnx-worker/basic-inference'

/**
 * Pure-logic proof of the CAC wiring (`buildCacInput` -> session.run ->
 * `decodeCacOutputToWaveforms` -> `combineFrequencyAndTimeBranches`), driven
 * by a fully injected FAKE session — no real `onnxruntime-web` here, matching
 * `onnx-session-manager.test.ts`'s own node/browser split precedent. The
 * fake session mirrors the P7B-01 Basic synthetic fixture's own transform
 * (`freq = mag * 3`), but additionally varies the `time` branch's scale per
 * source (`time[s] = mix * (5 + s)`) so this test can also catch a
 * source-index wiring bug that a uniform scale (as the real fixture uses)
 * would silently pass — e.g. reusing source 0's time slice for every source.
 *
 * A full `MODEL_SEGMENT_SAMPLES` window is required by `createWindow`
 * Processor` itself (its own defensive check), so the "happy path" and every
 * output-shape test below pay a real forward-STFT cost (`buildCacInput`
 * always runs before the fake session is even consulted); only the
 * happy-path test additionally pays the real inverse-STFT decode cost. Both
 * costs are pure JS radix-2 FFT work (`fft.ts`), not real ONNX inference, and
 * complete in well under a second per test on this machine.
 */

const FRAME_COUNT = 336
const FREQ_SCALE = 3
const CAC_CHANNEL_COUNT = 4
const STFT_FREQ_BINS = 2048

function fullWindowSignal(phase: number): Float32Array {
  return Float32Array.from({ length: MODEL_SEGMENT_SAMPLES }, (_, index) => Math.sin((index + phase) * 0.0007) * 0.4)
}

/**
 * Interior/edge split for the round-trip tolerance, matching this task's own
 * instruction to assert the interior tightly and document edge behaviour
 * honestly rather than loosening one global bound. Measured empirically (see
 * this task's report) on this exact fake-session setup: excluding the outer
 * `EDGE_MARGIN` samples of a full `MODEL_SEGMENT_SAMPLES` lane, the maximum
 * observed error was ~4.8e-7 (Float32-rounding-sized) across all 8 lanes;
 * within that margin the error grows smoothly up to ~0.47 at the very last
 * sample. This is not a bug in this module: `stft.test.ts`'s own
 * `DemucsSpecFixture` comment already documents that `demucsForwardSpec` /
 * `demucsInverseSpec` is *not* a lossless round trip by design at the real
 * 343,980-sample segment length ("reproduces an original signal with ~0.35
 * max abs error, not ~1e-6") — this is HTDemucs' own lossy spectral encoding
 * that the model's learned mask normally compensates for; a synthetic
 * fixture with no learned weights cannot hide it. `processPlanarWindows`'
 * overlap-add across multiple windows (proven exact in `windowing.test.ts`)
 * is what actually removes this single-window edge artifact from the full
 * reconstructed track; this module is only responsible for one window.
 */
const EDGE_MARGIN = 2000
const INTERIOR_TOLERANCE = 1e-4
/** Loose sanity bound for the edge region: catches a real bug (e.g. a wrong
 * lane/source swap, which would produce an error on the order of the
 * signal's own scaled amplitude or an out-of-range/non-finite value) without
 * asserting a false-tight bound over region known to be lossy by design. */
const EDGE_SANITY_BOUND = 0.6

function maxErrorWithinRange(actual: Float32Array, expected: Float32Array, start: number, end: number): number {
  let maximum = 0
  for (let index = start; index < end; index += 1) {
    const diff = Math.abs(actual[index] - expected[index])
    if (!Number.isFinite(diff)) {
      throw new Error(`non-finite sample at index ${index}: actual=${actual[index]} expected=${expected[index]}`)
    }
    maximum = Math.max(maximum, diff)
  }
  return maximum
}

interface CapturedFeeds {
  readonly mix: { readonly dims: readonly number[]; readonly data: Float32Array }
  readonly mag: { readonly dims: readonly number[]; readonly data: Float32Array }
}

/**
 * Builds a fake `ort.InferenceSession`-shaped object (structurally cast, same
 * `as unknown as ...` pattern already used for fakes in
 * `onnx-session-manager.test.ts`) whose `run()` derives `freq`/`time` from the
 * real feeds it receives, so this test exercises the real decode math without
 * a real ONNX runtime.
 */
function createFakeSession(onFeeds?: (feeds: CapturedFeeds) => void): unknown {
  return {
    run: async (feeds: CapturedFeeds) => {
      onFeeds?.(feeds)

      const magData = feeds.mag.data
      const freqData = new Float32Array(magData.length * 4)
      for (let source = 0; source < 4; source += 1) {
        for (let index = 0; index < magData.length; index += 1) {
          freqData[source * magData.length + index] = magData[index] * FREQ_SCALE
        }
      }

      const mixData = feeds.mix.data
      const timeData = new Float32Array(mixData.length * 4)
      for (let source = 0; source < 4; source += 1) {
        const scale = 5 + source
        for (let index = 0; index < mixData.length; index += 1) {
          timeData[source * mixData.length + index] = mixData[index] * scale
        }
      }

      return {
        freq: { dims: [1, 4, CAC_CHANNEL_COUNT, STFT_FREQ_BINS, feeds.mag.dims[3]], data: freqData },
        time: { dims: [1, 4, 2, MODEL_SEGMENT_SAMPLES], data: timeData },
      }
    },
  }
}

function unopenableSession(): unknown {
  return {
    run: async () => {
      throw new Error('must not be called: window validation should fail first')
    },
  }
}

describe('createBasicWindowProcessor', () => {
  test('runs the session with correct mix/mag tensor names and dims, and produces 8 correctly ordered/sliced lanes', async () => {
    let captured: CapturedFeeds | undefined
    const session = createFakeSession((feeds) => {
      captured = feeds
    })
    const processor = createBasicWindowProcessor(session as never)

    const left = fullWindowSignal(0)
    const right = fullWindowSignal(11)
    const output = await processor([left, right])

    expect(captured).toBeDefined()
    expect(Object.keys(captured!).sort()).toEqual(['mag', 'mix'])
    expect(Array.from(captured!.mix.dims)).toEqual([1, 2, MODEL_SEGMENT_SAMPLES])
    expect(Array.from(captured!.mag.dims)).toEqual([1, CAC_CHANNEL_COUNT, STFT_FREQ_BINS, FRAME_COUNT])

    expect(output).toHaveLength(8)

    const channels = [left, right]
    let maxInteriorError = 0
    let maxEdgeError = 0
    for (let source = 0; source < 4; source += 1) {
      for (let channel = 0; channel < 2; channel += 1) {
        const lane = output[source * 2 + channel]
        expect(lane).toHaveLength(MODEL_SEGMENT_SAMPLES)

        // Every source shares the same freq-branch scale (FREQ_SCALE) but a
        // distinct time-branch scale (5 + source): a wrong per-source time
        // slice (e.g. reusing source 0 for every source) would shift this
        // lane's expected scale away from its actual one, which the interior
        // assertion below — tight enough to reject anything but Float32
        // rounding — would catch.
        const expectedScale = FREQ_SCALE + (5 + source)
        const expected = Float32Array.from(channels[channel], (sample) => sample * expectedScale)

        const interiorError = maxErrorWithinRange(lane, expected, EDGE_MARGIN, lane.length - EDGE_MARGIN)
        const edgeErrorLeft = maxErrorWithinRange(lane, expected, 0, EDGE_MARGIN)
        const edgeErrorRight = maxErrorWithinRange(lane, expected, lane.length - EDGE_MARGIN, lane.length)

        maxInteriorError = Math.max(maxInteriorError, interiorError)
        maxEdgeError = Math.max(maxEdgeError, edgeErrorLeft, edgeErrorRight)
      }
    }

    expect(maxInteriorError).toBeLessThan(INTERIOR_TOLERANCE)
    expect(maxEdgeError).toBeLessThan(EDGE_SANITY_BOUND)
  })

  test.each([
    ['too few channels', 1],
    ['too many channels', 3],
  ])('rejects a window with %s without ever calling the session', async (_name, channelCount) => {
    const session = unopenableSession()
    const processor = createBasicWindowProcessor(session as never)

    const window = Array.from({ length: channelCount }, () => fullWindowSignal(0))
    await expect(processor(window)).rejects.toThrow('basic-inference.invalid_window_shape')
  })

  test('rejects a channel with the wrong sample length without ever calling the session', async () => {
    const session = unopenableSession()
    const processor = createBasicWindowProcessor(session as never)

    const window = [fullWindowSignal(0), new Float32Array(MODEL_SEGMENT_SAMPLES - 1)]
    await expect(processor(window)).rejects.toThrow('basic-inference.invalid_window_shape')
  })

  test('rejects a session result missing the "freq" output', async () => {
    const session = { run: async () => ({ time: { dims: [1, 4, 2, MODEL_SEGMENT_SAMPLES], data: new Float32Array(4 * 2 * MODEL_SEGMENT_SAMPLES) } }) }
    const processor = createBasicWindowProcessor(session as never)

    await expect(processor([fullWindowSignal(0), fullWindowSignal(1)])).rejects.toThrow(
      'basic-inference.missing_output',
    )
  })

  test('rejects a session result missing the "time" output', async () => {
    const session = {
      run: async () => ({
        freq: {
          dims: [1, 4, CAC_CHANNEL_COUNT, STFT_FREQ_BINS, FRAME_COUNT],
          data: new Float32Array(4 * CAC_CHANNEL_COUNT * STFT_FREQ_BINS * FRAME_COUNT),
        },
      }),
    }
    const processor = createBasicWindowProcessor(session as never)

    await expect(processor([fullWindowSignal(0), fullWindowSignal(1)])).rejects.toThrow(
      'basic-inference.missing_output',
    )
  })

  test('rejects a "freq" output with the wrong shape', async () => {
    const session = {
      run: async () => ({
        freq: { dims: [1, 4, CAC_CHANNEL_COUNT, STFT_FREQ_BINS, FRAME_COUNT - 1], data: new Float32Array(10) },
        time: { dims: [1, 4, 2, MODEL_SEGMENT_SAMPLES], data: new Float32Array(4 * 2 * MODEL_SEGMENT_SAMPLES) },
      }),
    }
    const processor = createBasicWindowProcessor(session as never)

    await expect(processor([fullWindowSignal(0), fullWindowSignal(1)])).rejects.toThrow(
      'basic-inference.invalid_output_shape',
    )
  })

  test('rejects a "time" output whose data length does not match its declared dims', async () => {
    const session = {
      run: async () => ({
        freq: {
          dims: [1, 4, CAC_CHANNEL_COUNT, STFT_FREQ_BINS, FRAME_COUNT],
          data: new Float32Array(4 * CAC_CHANNEL_COUNT * STFT_FREQ_BINS * FRAME_COUNT),
        },
        time: { dims: [1, 4, 2, MODEL_SEGMENT_SAMPLES], data: new Float32Array(10) },
      }),
    }
    const processor = createBasicWindowProcessor(session as never)

    await expect(processor([fullWindowSignal(0), fullWindowSignal(1)])).rejects.toThrow(
      'basic-inference.invalid_output_shape',
    )
  })
})
