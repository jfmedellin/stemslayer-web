import { parseAudioFileFormat, type AudioFileFormat } from './parse-audio-file-format'
import { parseWavBitDepth } from './parse-wav-bit-depth'

export interface AudioFileMetadata {
  readonly fileName: string
  readonly format: AudioFileFormat
  /** `null` for every format without a fixed PCM bit depth to read (i.e. anything but WAV). */
  readonly bitDepth: number | null
  /** `null` when duration decoding fails; the file card shows a dash rather than crashing. */
  readonly durationSeconds: number | null
  readonly sizeBytes: number
}

export type DecodeDurationSeconds = (bytes: Uint8Array) => Promise<number>

/**
 * Real, browser-only duration decode: a short-lived `AudioContext` used only
 * to read `buffer.duration`, independent of `WebAudioInferenceDecoder`
 * (which forces a 44.1 kHz stereo resample for inference and rejects other
 * channel layouts — the display duration must not inherit that contract).
 */
export async function defaultDecodeDurationSeconds(bytes: Uint8Array): Promise<number> {
  const context = new AudioContext()
  try {
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const buffer = await context.decodeAudioData(arrayBuffer)
    return buffer.duration
  } finally {
    await context.close()
  }
}

/** Combines the file-name-derived format, a WAV-only bit-depth read, size, and an injected duration decode. */
export async function readAudioFileMetadata(
  fileName: string,
  bytes: Uint8Array,
  decodeDurationSeconds: DecodeDurationSeconds = defaultDecodeDurationSeconds,
): Promise<AudioFileMetadata> {
  const format = parseAudioFileFormat(fileName)
  const bitDepth = format === 'WAV' ? parseWavBitDepth(bytes) : null

  let durationSeconds: number | null
  try {
    durationSeconds = await decodeDurationSeconds(bytes)
  } catch {
    durationSeconds = null
  }

  return Object.freeze({ fileName, format, bitDepth, durationSeconds, sizeBytes: bytes.byteLength })
}
