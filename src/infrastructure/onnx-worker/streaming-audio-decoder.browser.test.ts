import { describe, expect, test, vi } from 'vitest'

import { encodeFloat32Wav } from '../../domain/audio/float32-wav'
import { StreamingAudioDecoder, type MpegDecoderLike } from './streaming-audio-decoder'

async function collect(
  chunks: AsyncIterable<readonly [Float32Array, Float32Array]>,
): Promise<readonly [Float32Array, Float32Array]> {
  const left: Float32Array[] = []
  const right: Float32Array[] = []
  for await (const [nextLeft, nextRight] of chunks) {
    left.push(nextLeft)
    right.push(nextRight)
  }
  const join = (parts: readonly Float32Array[]): Float32Array => {
    const result = new Float32Array(parts.reduce((total, part) => total + part.length, 0))
    let offset = 0
    for (const part of parts) {
      result.set(part, offset)
      offset += part.length
    }
    return result
  }
  return [join(left), join(right)]
}

describe('StreamingAudioDecoder', () => {
  test('decodes float WAV incrementally into ordered stereo target-rate frames', async () => {
    const left = Float32Array.from({ length: 20_000 }, (_unused, index) => index / 20_000)
    const right = Float32Array.from({ length: 20_000 }, (_unused, index) => -index / 20_000)
    const wav = encodeFloat32Wav({ sampleRate: 44_100, planar: [left, right] })
    const decoder = new StreamingAudioDecoder()
    const chunks = decoder.decode(new Blob([wav.slice().buffer as ArrayBuffer]))
    const actual = await collect(chunks)

    expect(actual[0]).toEqual(left)
    expect(actual[1]).toEqual(right)
  })

  test('feeds bounded MP3 byte slices to the streaming codec and emits its PCM incrementally', async () => {
    const decode = vi.fn((bytes: Uint8Array) => ({
      channelData: [Float32Array.from(bytes, (byte) => byte / 255)],
      samplesDecoded: bytes.length,
      sampleRate: 44_100,
      errors: [],
    }))
    const factory = vi.fn((): MpegDecoderLike => ({ ready: Promise.resolve(), decode, free: vi.fn() }))
    const decoder = new StreamingAudioDecoder({ createMpegDecoder: factory, sourceChunkBytes: 1024 })
    const source = new Blob([new Uint8Array(3_000).fill(127).buffer as ArrayBuffer])
    const actual = await collect(decoder.decode(source, 'MP3'))

    expect(factory).toHaveBeenCalledOnce()
    expect(decode.mock.calls.map(([bytes]) => bytes.length)).toEqual([1024, 1024, 952, 0])
    expect(actual[0]).toHaveLength(3_000)
    expect(actual[1]).toEqual(actual[0])
  })

  test('decodes fragmented MPEG Layer III frames through the installed WASM decoder', async () => {
    const frameLength = 417
    const sourceBytes = new Uint8Array(frameLength * 10)
    for (let frame = 0; frame < 10; frame += 1) {
      const offset = frame * frameLength
      sourceBytes.set([0xff, 0xfb, 0x90, 0x64], offset)
    }
    const actual = await collect(new StreamingAudioDecoder({ sourceChunkBytes: 317 })
      .decode(new Blob([sourceBytes.buffer as ArrayBuffer]), 'MP3'))

    expect(actual[0]).toHaveLength(11_520)
    expect(actual[1]).toHaveLength(11_520)
    expect(actual[0].every(Number.isFinite)).toBe(true)
    expect(actual[1]).toEqual(actual[0])
  })

  test('fails clearly and releases decoder state when streaming capability initialization fails', async () => {
    const free = vi.fn()
    const decoder = new StreamingAudioDecoder({ createMpegDecoder: () => ({
      ready: Promise.reject(new Error('wasm_unavailable')),
      decode: vi.fn(() => ({ channelData: [], samplesDecoded: 0, sampleRate: 44_100, errors: [] })),
      free,
    }) })
    await expect(collect(decoder.decode(new Blob([new Uint8Array([1]).buffer as ArrayBuffer]), 'MP3')))
      .rejects.toThrow('streaming-audio-decoder.mp3_decode_failed')
    expect(free).toHaveBeenCalledOnce()
  })

  test('stops an already-aborted MP3 stream before allocating decoder resources', async () => {
    const factory = vi.fn((): MpegDecoderLike => ({
      ready: Promise.resolve(),
      decode: vi.fn(() => ({ channelData: [], samplesDecoded: 0, sampleRate: 44_100, errors: [] })),
      free: vi.fn(),
    }))
    const free = vi.fn()
    const decoder = new StreamingAudioDecoder({ createMpegDecoder: () => {
      const codec = factory()
      return { ...codec, free: () => { free() } }
    } })
    const controller = new AbortController()
    controller.abort()
    await expect(collect(decoder.decode(
      new Blob([new Uint8Array([1]).buffer as ArrayBuffer]), 'MP3', controller.signal,
    ))).rejects.toMatchObject({ name: 'AbortError' })
    expect(factory).not.toHaveBeenCalled()
    expect(free).not.toHaveBeenCalled()
  })

})
