import { parseAudioFileFormat, type AudioFileFormat } from './parse-audio-file-format'
import { parseWavBitDepth } from './parse-wav-bit-depth'
export { MAX_SOURCE_BYTES } from '../audio-file-limits'
const WAV_HEADER_READ_BYTES = 64 * 1024

export interface AudioFileMetadata {
  readonly fileName: string
  readonly format: AudioFileFormat
  /** `null` for every format without a fixed PCM bit depth to read (i.e. anything but WAV). */
  readonly bitDepth: number | null
  /** Duration measured by the bounded MP3/WAV decoder before reading the source bytes. */
  readonly durationSeconds: number
  readonly sizeBytes: number
}

/** Combines measured duration with file metadata; WAV headers are read with a fixed upper bound. */
export async function readAudioFileMetadata(
  fileName: string,
  source: Blob,
  durationSeconds: number,
): Promise<AudioFileMetadata> {
  const format = parseAudioFileFormat(fileName)
  const headerBytes = format === 'WAV'
    ? new Uint8Array(await source.slice(0, WAV_HEADER_READ_BYTES).arrayBuffer())
    : null
  const bitDepth = headerBytes === null ? null : parseWavBitDepth(headerBytes)
  return Object.freeze({ fileName, format, bitDepth, durationSeconds, sizeBytes: source.size })
}
