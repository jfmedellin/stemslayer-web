import { describe, expect, test } from 'vitest'

import { encodeFloat32Wav } from '../../domain/audio/float32-wav'
import { StreamingAudioDecoder } from './streaming-audio-decoder'

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

})
