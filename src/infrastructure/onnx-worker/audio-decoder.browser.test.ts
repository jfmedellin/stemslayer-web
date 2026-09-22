import { describe, expect, test, vi } from 'vitest'

import { encodeFloat32Wav } from '../opfs/float32-wav'
import {
  AudioDecodeError,
  DecodedAudioChannelCountError,
  DecodedAudioEmptyError,
  DecodedAudioLengthMismatchError,
  WebAudioInferenceDecoder,
  type AudioBufferLike,
  type AudioContextLike,
} from './audio-decoder'

const TARGET_SAMPLE_RATE = 44_100

function sine(length: number, frequency: number, sampleRate: number): Float32Array {
  return Float32Array.from(
    { length },
    (_, index) => Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.25,
  )
}

function maxError(actual: Float32Array, expected: Float32Array): number {
  let maximum = 0
  for (let index = 0; index < actual.length; index += 1) {
    maximum = Math.max(maximum, Math.abs(actual[index] - expected[index]))
  }
  return maximum
}

function fakeBuffer(channels: readonly Float32Array[], sampleRate = TARGET_SAMPLE_RATE): AudioBufferLike {
  return {
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    sampleRate,
    getChannelData: (channel) => channels[channel],
  }
}

type FakeAudioContext = AudioContextLike & {
  decodeAudioData: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

function fakeContext(decoded: AudioBufferLike | Error): FakeAudioContext {
  return {
    decodeAudioData: vi.fn(async () => {
      if (decoded instanceof Error) throw decoded
      return decoded
    }),
    close: vi.fn(async () => undefined),
  }
}

describe('WebAudioInferenceDecoder (Chromium)', () => {
  test('decodes known stereo float32 WAV samples into owned 44.1 kHz planar channels', async () => {
    const left = sine(256, 440, TARGET_SAMPLE_RATE)
    const right = sine(256, 880, TARGET_SAMPLE_RATE)
    const bytes = encodeFloat32Wav({ sampleRate: TARGET_SAMPLE_RATE, planar: [left, right] })
    const decoder = new WebAudioInferenceDecoder()

    const decoded = await decoder.decode(bytes)

    expect(decoded.sampleRate).toBe(TARGET_SAMPLE_RATE)
    expect(decoded.planarChannels).toHaveLength(2)
    expect(decoded.planarChannels[0]).toHaveLength(left.length)
    expect(decoded.planarChannels[1]).toHaveLength(right.length)
    expect(maxError(decoded.planarChannels[0], left)).toBeLessThanOrEqual(1e-6)
    expect(maxError(decoded.planarChannels[1], right)).toBeLessThanOrEqual(1e-6)
  })

  test('uses a 44.1 kHz AudioContext so lower-rate input is resampled for the models', async () => {
    const sourceRate = 22_050
    const frameCount = 220
    const bytes = encodeFloat32Wav({
      sampleRate: sourceRate,
      planar: [sine(frameCount, 440, sourceRate), sine(frameCount, 660, sourceRate)],
    })

    const decoded = await new WebAudioInferenceDecoder().decode(bytes)

    expect(decoded.sampleRate).toBe(TARGET_SAMPLE_RATE)
    expect(decoded.planarChannels[0].length).toBeGreaterThanOrEqual(frameCount * 2 - 1)
    expect(decoded.planarChannels[0].length).toBeLessThanOrEqual(frameCount * 2 + 1)
    expect(decoded.planarChannels[1]).toHaveLength(decoded.planarChannels[0].length)
  })

  test('copies the upload bytes and decoded channels into independently owned buffers', async () => {
    const left = new Float32Array([0.1, 0.2])
    const right = new Float32Array([0.3, 0.4])
    const context = fakeContext(fakeBuffer([left, right]))
    const decoder = new WebAudioInferenceDecoder(() => context)
    const backing = new Uint8Array([9, 1, 2, 3, 9])
    const source = backing.subarray(1, 4)

    const decoded = await decoder.decode(source)
    const passedBytes = new Uint8Array(context.decodeAudioData.mock.calls[0][0] as ArrayBuffer)
    backing.fill(0)
    left.fill(0)
    right.fill(0)

    expect(passedBytes).toEqual(new Uint8Array([1, 2, 3]))
    expect(passedBytes.buffer).not.toBe(source.buffer)
    expect(decoded.planarChannels[0]).toEqual(new Float32Array([0.1, 0.2]))
    expect(decoded.planarChannels[1]).toEqual(new Float32Array([0.3, 0.4]))
    expect(decoded.planarChannels[0].buffer).not.toBe(left.buffer)
    expect(decoded.planarChannels[1].buffer).not.toBe(right.buffer)
    expect(context.close).toHaveBeenCalledOnce()
  })

  test('maps decode failure and closes the context', async () => {
    const context = fakeContext(new DOMException('unsupported data', 'EncodingError'))
    const decoder = new WebAudioInferenceDecoder(() => context)

    await expect(decoder.decode(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(AudioDecodeError)
    expect(context.close).toHaveBeenCalledOnce()
  })

  test('rejects an empty upload before decoding and closes the context', async () => {
    const context = fakeContext(fakeBuffer([new Float32Array([0.1]), new Float32Array([0.2])]))
    const decoder = new WebAudioInferenceDecoder(() => context)

    await expect(decoder.decode(new Uint8Array())).rejects.toBeInstanceOf(DecodedAudioEmptyError)
    expect(context.decodeAudioData).not.toHaveBeenCalled()
    expect(context.close).toHaveBeenCalledOnce()
  })

  test.each([
    ['empty', fakeBuffer([new Float32Array(), new Float32Array()]), DecodedAudioEmptyError],
    ['mono', fakeBuffer([new Float32Array([0.1])]), DecodedAudioChannelCountError],
    [
      'multichannel',
      fakeBuffer([new Float32Array([0.1]), new Float32Array([0.2]), new Float32Array([0.3])]),
      DecodedAudioChannelCountError,
    ],
  ])('rejects %s decoded audio and closes the context', async (_case, buffer, ErrorType) => {
    const context = fakeContext(buffer)
    const decoder = new WebAudioInferenceDecoder(() => context)

    await expect(decoder.decode(new Uint8Array([1]))).rejects.toBeInstanceOf(ErrorType)
    expect(context.close).toHaveBeenCalledOnce()
  })

  test('rejects unequal channel lengths and closes the context', async () => {
    const context = fakeContext({
      ...fakeBuffer([new Float32Array([0.1, 0.2]), new Float32Array([0.3])]),
      length: 2,
    })
    const decoder = new WebAudioInferenceDecoder(() => context)

    await expect(decoder.decode(new Uint8Array([1]))).rejects.toBeInstanceOf(
      DecodedAudioLengthMismatchError,
    )
    expect(context.close).toHaveBeenCalledOnce()
  })
})
