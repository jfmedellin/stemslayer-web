import { describe, expect, test, vi } from 'vitest'

import {
  MODEL_SEGMENT_SAMPLES,
  MODEL_WINDOW_STRIDE,
  createTriangularWeight,
  createWindowOffsets,
  processPlanarWindows,
} from '../../../src/infrastructure/onnx-worker/windowing'

function signal(length: number, phase = 0): Float32Array {
  return Float32Array.from({ length }, (_, index) => Math.sin((index + phase) * 0.013) * 0.75)
}

function maxError(actual: Float32Array, expected: Float32Array): number {
  let maximum = 0
  for (let index = 0; index < actual.length; index += 1) {
    maximum = Math.max(maximum, Math.abs(actual[index] - expected[index]))
  }
  return maximum
}

async function reconstructIdentity(planar: readonly Float32Array[]) {
  return processPlanarWindows(planar, async (window) => window.map((channel) => channel.slice()))
}

describe('fixed ONNX window plan', () => {
  test('uses the S2 segment and 25%-overlap stride constants', () => {
    expect(MODEL_SEGMENT_SAMPLES).toBe(343_980)
    expect(MODEL_WINDOW_STRIDE).toBe(257_985)
    expect(MODEL_SEGMENT_SAMPLES - MODEL_WINDOW_STRIDE).toBe(85_995)
  })

  test('creates deterministic ascending offsets through the final partial window', () => {
    expect(createWindowOffsets(1)).toEqual([0])
    expect(createWindowOffsets(MODEL_SEGMENT_SAMPLES)).toEqual([0, MODEL_WINDOW_STRIDE])
    expect(createWindowOffsets(MODEL_WINDOW_STRIDE * 2 + 7)).toEqual([
      0,
      MODEL_WINDOW_STRIDE,
      MODEL_WINDOW_STRIDE * 2,
    ])
  })

  test('builds the full normalized triangular segment weight', () => {
    const weight = createTriangularWeight()
    const half = MODEL_SEGMENT_SAMPLES / 2

    expect(weight).toHaveLength(MODEL_SEGMENT_SAMPLES)
    expect(weight[0]).toBeCloseTo(1 / half, 7)
    expect(weight[half - 1]).toBe(1)
    expect(weight[half]).toBe(1)
    expect(weight.at(-1)).toBeCloseTo(1 / half, 7)
  })
})

describe('processPlanarWindows', () => {
  test.each([
    ['short', 9_001],
    ['exact segment', MODEL_SEGMENT_SAMPLES],
    ['overlapping', MODEL_SEGMENT_SAMPLES + 31_337],
    ['partial final', MODEL_WINDOW_STRIDE * 2 + 7],
  ])('reconstructs a %s signal within 1e-6', async (_name, length) => {
    const input = [signal(length), signal(length, 17)]
    const output = await reconstructIdentity(input)

    expect(output).toHaveLength(input.length)
    for (let channel = 0; channel < input.length; channel += 1) {
      expect(output[channel]).not.toBe(input[channel])
      expect(maxError(output[channel], input[channel])).toBeLessThanOrEqual(1e-6)
    }
  })

  test('symmetrically extends a short natural chunk and center-trims its output', async () => {
    const input = [Float32Array.from([1, 2, 3])]
    let observedWindow: readonly Float32Array[] | undefined

    const output = await processPlanarWindows(input, (window) => {
      observedWindow = window
      return window.map((channel) => channel.slice())
    })

    const trimStart = Math.floor((MODEL_SEGMENT_SAMPLES - input[0].length) / 2)
    expect(observedWindow?.[0].length).toBe(MODEL_SEGMENT_SAMPLES)
    expect(Array.from(observedWindow?.[0].subarray(trimStart, trimStart + 3) ?? [])).toEqual([1, 2, 3])
    expect(observedWindow?.[0][trimStart - 1]).toBe(0)
    expect(observedWindow?.[0][trimStart + 3]).toBe(0)
    expect(Array.from(output[0])).toEqual([1, 2, 3])
  })

  test('uses available source context around a partial final window before center trim', async () => {
    const length = MODEL_WINDOW_STRIDE + 5
    const input = [Float32Array.from({ length }, (_, index) => index)]
    const windows: Float32Array[] = []

    await processPlanarWindows(input, (window) => {
      windows.push(window[0].slice())
      return window.map((channel) => channel.slice())
    })

    const naturalLength = 5
    const trimStart = Math.floor((MODEL_SEGMENT_SAMPLES - naturalLength) / 2)
    expect(windows).toHaveLength(2)
    expect(windows[1][trimStart]).toBe(MODEL_WINDOW_STRIDE)
    expect(windows[1][trimStart + naturalLength - 1]).toBe(length - 1)
    expect(windows[1][trimStart - 1]).toBe(MODEL_WINDOW_STRIDE - 1)
    expect(windows[1][trimStart + naturalLength]).toBe(0)
  })

  test('does not mutate the caller input when a processor mutates its window', async () => {
    const source = Float32Array.from([0.1, 0.2, 0.3])
    const snapshot = source.slice()

    await processPlanarWindows([source], (window) => {
      window[0].fill(0)
      return [window[0].slice()]
    })

    expect(source).toEqual(snapshot)
  })

  test('reports each completed window exactly once in ascending order', async () => {
    const length = MODEL_WINDOW_STRIDE * 2 + 1
    const progress = vi.fn()

    await processPlanarWindows([signal(length)], (window) => [window[0].slice()], progress)

    expect(progress.mock.calls.map(([event]) => event)).toEqual([
      { window: 1, totalWindows: 3 },
      { window: 2, totalWindows: 3 },
      { window: 3, totalWindows: 3 },
    ])
  })

  test('blends distinct window outputs with independently calculated triangular weights', async () => {
    const frameCount = MODEL_WINDOW_STRIDE * 2 + 7
    let windowNumber = 0
    const [output] = await processPlanarWindows([new Float32Array(frameCount)], () => {
      windowNumber += 1
      return [new Float32Array(MODEL_SEGMENT_SAMPLES).fill(windowNumber)]
    })

    const independentWeight = (index: number): number => {
      const half = MODEL_SEGMENT_SAMPLES / 2
      return index < half ? (index + 1) / half : (MODEL_SEGMENT_SAMPLES - index) / half
    }
    const expectedBlend = (leftValue: number, rightValue: number, overlapIndex: number): number => {
      const leftWeight = independentWeight(MODEL_WINDOW_STRIDE + overlapIndex)
      const rightWeight = independentWeight(overlapIndex)
      return (leftValue * leftWeight + rightValue * rightWeight) / (leftWeight + rightWeight)
    }

    const firstOverlapSamples = [0, Math.floor((MODEL_SEGMENT_SAMPLES - MODEL_WINDOW_STRIDE) / 2), 85_994]
    for (const overlapIndex of firstOverlapSamples) {
      expect(output[MODEL_WINDOW_STRIDE + overlapIndex]).toBeCloseTo(
        expectedBlend(1, 2, overlapIndex),
        6,
      )
    }

    for (const overlapIndex of [0, 3, 6]) {
      expect(output[MODEL_WINDOW_STRIDE * 2 + overlapIndex]).toBeCloseTo(
        expectedBlend(2, 3, overlapIndex),
        6,
      )
    }
    expect(windowNumber).toBe(3)
  })

  test.each([
    ['no channels', []],
    ['empty channels', [new Float32Array(0)]],
    ['unaligned channels', [new Float32Array(2), new Float32Array(3)]],
  ])('rejects invalid planar input: %s', async (_name, planar) => {
    await expect(processPlanarWindows(planar, (window) => window)).rejects.toThrow('windowing.invalid_input_shape')
  })

  test('rejects an output with the wrong segment length', async () => {
    await expect(
      processPlanarWindows([signal(4)], () => [new Float32Array(MODEL_SEGMENT_SAMPLES - 1)]),
    ).rejects.toThrow('windowing.invalid_output_shape')
  })

  test('rejects a changed output channel count between windows', async () => {
    let calls = 0
    await expect(
      processPlanarWindows([signal(MODEL_WINDOW_STRIDE + 1)], (window) => {
        calls += 1
        return calls === 1 ? [window[0].slice(), window[0].slice()] : [window[0].slice()]
      }),
    ).rejects.toThrow('windowing.invalid_output_shape')
  })
})
