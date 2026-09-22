import { describe, expect, test } from 'vitest'

import { ClippingError, decodeFloat32Wav, encodeFloat32Wav } from '../../src/domain/audio/float32-wav'

// Golden fixture: bytes computed by the desktop encoder
// (`SeparationWorker/engine/wav.py:encode_float32_wav`), read-only reference
// at `../separador-pistas/SeparationWorker/engine/wav.py`. Produced with:
//
//   .venv\Scripts\python.exe -c "
//   from SeparationWorker.engine.pcm import PlanarPCM
//   from SeparationWorker.engine.wav import encode_float32_wav
//   audio = PlanarPCM(sample_rate=44100, planar=((0.5, -0.25, 0.0), (1.0, -1.0, 0.125)))
//   print(encode_float32_wav(audio).hex())
//   "
const GOLDEN_SAMPLE_RATE = 44100
const GOLDEN_PLANAR = [
  Float32Array.from([0.5, -0.25, 0.0]),
  Float32Array.from([1.0, -1.0, 0.125]),
]
const GOLDEN_HEX =
  '524946463c00000057415645666d7420100000000300020044ac00002062050008002000646174611800000000' +
  '00003f0000803f000080be000080bf000000000000003e'

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

describe('encodeFloat32Wav', () => {
  test('matches the desktop encoder byte-for-byte on the golden fixture', () => {
    const bytes = encodeFloat32Wav({ sampleRate: GOLDEN_SAMPLE_RATE, planar: GOLDEN_PLANAR })

    expect(bytes).toEqual(hexToBytes(GOLDEN_HEX))
  })

  test('produces the fixed RIFF/WAVE/fmt layout: format tag 3, no metadata chunks', () => {
    const bytes = encodeFloat32Wav({ sampleRate: 44_100, planar: [Float32Array.from([0.25, -0.5])] })
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...bytes.slice(8, 16))).toBe('WAVEfmt ')
    expect(view.getUint16(20, true)).toBe(3) // WAVE_FORMAT_IEEE_FLOAT
    expect(view.getUint16(22, true)).toBe(1) // channel count
    expect(view.getUint32(24, true)).toBe(44_100)
    expect(view.getUint16(34, true)).toBe(32) // bits per sample
    expect(String.fromCharCode(...bytes.slice(36, 40))).toBe('data')
  })

  test('round trips through decodeFloat32Wav for mono and stereo, including an odd frame count', () => {
    const mono = { sampleRate: 48_000, planar: [Float32Array.from([0.1, -0.2, 0.3])] }
    const stereo = {
      sampleRate: 44_100,
      planar: [Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5]), Float32Array.from([-0.1, -0.2, -0.3, -0.4, -0.5])],
    }

    for (const fixture of [mono, stereo]) {
      const decoded = decodeFloat32Wav(encodeFloat32Wav(fixture))
      expect(decoded.sampleRate).toBe(fixture.sampleRate)
      expect(decoded.planar).toHaveLength(fixture.planar.length)
      decoded.planar.forEach((channel, index) => {
        // Float32 round trip: values already truncated to float32 by the typed array.
        expect(Array.from(channel)).toEqual(Array.from(fixture.planar[index]))
      })
    }
  })

  test('rejects a peak above 1.0 with a typed export.clipping error carrying the peak', () => {
    expect(() => encodeFloat32Wav({ sampleRate: 44_100, planar: [Float32Array.from([0.5, -1.25])] })).toThrow(
      ClippingError,
    )
    try {
      encodeFloat32Wav({ sampleRate: 44_100, planar: [Float32Array.from([0.5, -1.25])] })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ClippingError)
      expect((error as ClippingError).peak).toBeCloseTo(1.25, 5)
      expect((error as ClippingError).message).toContain('export.clipping')
      expect((error as ClippingError).message.toLowerCase()).toContain('gain')
    }
  })

  test('rejects a non-finite sample as a typed export.clipping error', () => {
    expect(() =>
      encodeFloat32Wav({ sampleRate: 44_100, planar: [Float32Array.from([0.1, Number.NaN])] }),
    ).toThrow(ClippingError)
  })
})
