import { InferenceSession, Tensor, env } from 'onnxruntime-web/wasm'
import { beforeAll, describe, expect, test } from 'vitest'

// `?url` fixture imports: the Vite dev server that backs this browser test
// serves these repository files as static assets, so the real
// `onnxruntime-web` WASM backend can `fetch` them exactly like it would any
// other model download. Provider selection (WebGPU-first, WASM fallback) is
// P7B-02's job; the WASM execution provider alone is enough to prove these
// synthetic fixtures load and run in a real `InferenceSession`.
import rockFixtureUrl from '../../../tests/infrastructure/onnx-worker/fixtures/rock-synthetic.onnx?url'
import basicFixtureUrl from '../../../tests/infrastructure/onnx-worker/fixtures/basic-synthetic.onnx?url'

const MIX_SHAPE = [1, 2, 343_980] as const
const MAG_SHAPE = [1, 4, 2048, 336] as const
const STEMS_SHAPE = [1, 6, 2, 343_980] as const
const FREQ_SHAPE = [1, 4, 4, 2048, 336] as const
const TIME_SHAPE = [1, 4, 2, 343_980] as const

const TOLERANCE = 1e-6

function product(shape: readonly number[]): number {
  return shape.reduce((total, dimension) => total * dimension, 1)
}

function filledTensor(shape: readonly number[], value: number): Tensor {
  return new Tensor('float32', new Float32Array(product(shape)).fill(value), shape as number[])
}

function assertConstantOutput(output: Tensor, expectedShape: readonly number[], expectedValue: number): void {
  expect(Array.from(output.dims)).toEqual(expectedShape)
  expect(output.type).toBe('float32')

  const data = output.data as Float32Array
  expect(data.length).toBe(product(expectedShape))
  for (let index = 0; index < data.length; index += 1) {
    if (Math.abs(data[index] - expectedValue) > TOLERANCE) {
      throw new Error(`expected element ${index} to be ${expectedValue}, got ${data[index]}`)
    }
  }
}

function basicMagTensor(): Tensor {
  const [, cacChannels, bins, frames] = MAG_SHAPE
  const data = new Float32Array(product(MAG_SHAPE))
  const valuesPerChannel = bins * frames
  for (let channel = 0; channel < cacChannels; channel += 1) {
    data.fill(channel + 1, channel * valuesPerChannel, (channel + 1) * valuesPerChannel)
  }
  return new Tensor('float32', data, MAG_SHAPE as unknown as number[])
}

function assertBasicFreqLayout(output: Tensor): void {
  const data = output.data as Float32Array
  const [, sourceCount, cacChannels, bins, frames] = FREQ_SHAPE
  for (let source = 0; source < sourceCount; source += 1) {
    for (let channel = 0; channel < cacChannels; channel += 1) {
      const index = ((source * cacChannels + channel) * bins) * frames
      expect(data[index]).toBe((channel + 1) * 3)
    }
  }
}

async function fetchFixtureBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  return new Uint8Array(await response.arrayBuffer())
}

beforeAll(() => {
  // Out of scope for P7B-01 (spike S1 territory): run single-threaded WASM,
  // matching the S2 baseline and this phase's own constraint against
  // cross-origin isolation / multithreaded WASM.
  env.wasm.numThreads = 1
})

describe('synthetic ONNX fixtures load into a real onnxruntime-web session (WASM provider)', () => {
  test('rock-synthetic.onnx: single mix input, single stems output, tiled x6 and scaled x2', async () => {
    const bytes = await fetchFixtureBytes(rockFixtureUrl)
    const session = await InferenceSession.create(bytes, { executionProviders: ['wasm'] })

    expect(session.inputNames).toEqual(['mix'])
    expect(session.outputNames).toEqual(['stems'])

    const feeds = { mix: filledTensor(MIX_SHAPE, 1) }
    const results = await session.run(feeds)

    assertConstantOutput(results.stems, STEMS_SHAPE, 2)
  })

  test('basic-synthetic.onnx: mix+mag inputs, freq+time outputs, tiled and scaled independently', async () => {
    const bytes = await fetchFixtureBytes(basicFixtureUrl)
    const session = await InferenceSession.create(bytes, { executionProviders: ['wasm'] })

    expect(session.inputNames.slice().sort()).toEqual(['mag', 'mix'])
    expect(session.outputNames.slice().sort()).toEqual(['freq', 'time'])

    const feeds = { mix: filledTensor(MIX_SHAPE, 1), mag: basicMagTensor() }
    const results = await session.run(feeds)

    expect(Array.from(results.freq.dims)).toEqual(FREQ_SHAPE)
    expect(results.freq.type).toBe('float32')
    expect(results.freq.data.length).toBe(product(FREQ_SHAPE))
    assertBasicFreqLayout(results.freq)
    assertConstantOutput(results.time, TIME_SHAPE, 5)
  })
})
