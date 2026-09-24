/**
 * 32-bit float PCM WAV codec, byte-identical to the desktop encoder for
 * finite samples within [-1, 1]
 * (`SeparationWorker/engine/wav.py:encode_float32_wav`): `RIFF`/`WAVEfmt `
 * with a 16-byte fmt chunk (`<HHIIHH` = format tag 3 `WAVE_FORMAT_IEEE_FLOAT`,
 * channel count, sample rate, byte rate, block align, 32 bits per sample),
 * then a `data` chunk of interleaved little-endian float32 samples, no
 * metadata chunks (`docs/decisions/browser-storage.md` section 2).
 *
 * Pure functions, no browser or Node API dependency, usable from the main
 * thread and from the inference Worker (P7). Lives in `domain` (not
 * `infrastructure`, where P5 first placed it) so `application/open-in-mixer.ts`
 * can decode a stored lane's exact bytes (P9) without crossing the
 * application -> infrastructure layering boundary `eslint.config.js` enforces;
 * `infrastructure/onnx-worker` and `infrastructure/opfs` still use it freely,
 * since infrastructure may import domain.
 */

const FORMAT_TAG_IEEE_FLOAT = 3
const BITS_PER_SAMPLE = 32
const BYTES_PER_SAMPLE = 4
const FMT_CHUNK_LENGTH = 16
const RIFF_SIZE_OFFSET = 4
const CHANNEL_COUNT_OFFSET = 22
const SAMPLE_RATE_OFFSET = 24
const DATA_SIZE_OFFSET = 40
const DATA_OFFSET = 44

export interface EncodeFloat32WavInput {
  readonly sampleRate: number
  /** One `Float32Array` per channel, every channel the same length. */
  readonly planar: readonly Float32Array[]
}

export interface DecodedFloat32Wav {
  readonly sampleRate: number
  /** One `Float32Array` per channel, every channel the same length. */
  readonly planar: Float32Array[]
}

/** Non-finite audio samples cannot be encoded as valid stems or sources. */
export class NonFiniteAudioError extends Error {
  constructor(readonly sample: number) {
    super(`audio.non_finite_sample Audio contains a non-finite sample (${sample}); the WAV could not be encoded.`)
    this.name = 'NonFiniteAudioError'
  }
}

function assertFiniteSamples(planar: readonly Float32Array[]): void {
  for (const channel of planar) {
    for (const sample of channel) {
      if (!Number.isFinite(sample)) throw new NonFiniteAudioError(sample)
    }
  }
}

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    bytes[offset + index] = text.charCodeAt(index)
  }
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length))
}

/**
 * Encodes planar float32 audio into the desktop's WAV byte layout.
 * Preserves finite model samples even above 1; rejects non-finite samples.
 * Unlike the desktop encoder, raw stem publication does not apply a future
 * rendered-mixdown clipping policy. No normalization or limiting occurs.
 */
export function encodeFloat32Wav({ sampleRate, planar }: EncodeFloat32WavInput): Uint8Array {
  assertFiniteSamples(planar)

  const channelCount = planar.length
  const frameCount = channelCount > 0 ? planar[0].length : 0
  const blockAlign = channelCount * BYTES_PER_SAMPLE
  const byteRate = sampleRate * blockAlign
  const dataLength = frameCount * blockAlign
  const riffSize = 4 + (8 + FMT_CHUNK_LENGTH) + (8 + dataLength)
  const totalLength = 8 + riffSize

  const bytes = new Uint8Array(totalLength)
  const view = new DataView(bytes.buffer)

  writeAscii(bytes, 0, 'RIFF')
  view.setUint32(RIFF_SIZE_OFFSET, riffSize, true)
  writeAscii(bytes, 8, 'WAVE')
  writeAscii(bytes, 12, 'fmt ')
  view.setUint32(16, FMT_CHUNK_LENGTH, true)
  view.setUint16(20, FORMAT_TAG_IEEE_FLOAT, true)
  view.setUint16(CHANNEL_COUNT_OFFSET, channelCount, true)
  view.setUint32(SAMPLE_RATE_OFFSET, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, BITS_PER_SAMPLE, true)
  writeAscii(bytes, 36, 'data')
  view.setUint32(DATA_SIZE_OFFSET, dataLength, true)

  let offset = DATA_OFFSET
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      view.setFloat32(offset, planar[channel][frame], true)
      offset += BYTES_PER_SAMPLE
    }
  }

  return bytes
}

/** Decodes a WAV byte layout produced by `encodeFloat32Wav` back to planar float32. */
export function decodeFloat32Wav(bytes: Uint8Array): DecodedFloat32Wav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (readAscii(bytes, 0, 4) !== 'RIFF' || readAscii(bytes, 8, 4) !== 'WAVE') {
    throw new Error('float32-wav.not_a_wav_file')
  }

  const channelCount = view.getUint16(CHANNEL_COUNT_OFFSET, true)
  const sampleRate = view.getUint32(SAMPLE_RATE_OFFSET, true)
  const dataLength = view.getUint32(DATA_SIZE_OFFSET, true)
  const blockAlign = channelCount * BYTES_PER_SAMPLE
  const frameCount = blockAlign > 0 ? dataLength / blockAlign : 0

  const planar: Float32Array[] = Array.from({ length: channelCount }, () => new Float32Array(frameCount))
  let offset = DATA_OFFSET
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      planar[channel][frame] = view.getFloat32(offset, true)
      offset += BYTES_PER_SAMPLE
    }
  }

  return { sampleRate, planar }
}
