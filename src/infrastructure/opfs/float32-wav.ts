/**
 * 32-bit float PCM WAV codec, byte-identical to the desktop encoder
 * (`SeparationWorker/engine/wav.py:encode_float32_wav`): `RIFF`/`WAVEfmt `
 * with a 16-byte fmt chunk (`<HHIIHH` = format tag 3 `WAVE_FORMAT_IEEE_FLOAT`,
 * channel count, sample rate, byte rate, block align, 32 bits per sample),
 * then a `data` chunk of interleaved little-endian float32 samples, no
 * metadata chunks (`docs/decisions/browser-storage.md` section 2).
 *
 * Pure functions, no browser or Node API dependency, usable from the main
 * thread and from the inference Worker (P7).
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

/**
 * Thrown when the audio peak exceeds the allowed absolute peak of 1, or
 * contains a non-finite sample — the same `export.clipping` refusal the
 * desktop encoder applies (`wav.py`'s `ExportError`), carrying the peak.
 */
export class ClippingError extends Error {
  constructor(readonly peak: number) {
    super(
      `export.clipping Export peak ${peak} exceeds the allowed absolute peak of 1. ` +
        'Reduce mixer gain and export again; no normalization or limiting was applied.',
    )
    this.name = 'ClippingError'
  }
}

function computePeak(planar: readonly Float32Array[]): number {
  let peak = 0
  for (const channel of planar) {
    for (const sample of channel) {
      if (!Number.isFinite(sample)) return Math.abs(sample)
      const abs = Math.abs(sample)
      if (abs > peak) peak = abs
    }
  }
  return peak
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
 * Encodes planar float32 audio into the desktop's exact WAV byte layout.
 * Rejects a peak above 1.0 or a non-finite sample with a typed
 * `ClippingError`, as the desktop does; no normalization or limiting.
 */
export function encodeFloat32Wav({ sampleRate, planar }: EncodeFloat32WavInput): Uint8Array {
  const peak = computePeak(planar)
  if (!Number.isFinite(peak) || peak > 1) {
    throw new ClippingError(peak)
  }

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
