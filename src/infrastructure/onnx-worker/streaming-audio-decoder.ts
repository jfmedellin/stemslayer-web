const TARGET_SAMPLE_RATE = 44_100
const DEFAULT_SOURCE_CHUNK_BYTES = 16 * 1024
const PCM_OUTPUT_CHUNK_FRAMES = 16 * 1024
const MAX_WAV_FORMAT_BYTES = 4096

interface StreamingAudioDecoderOptions {
  readonly sourceChunkBytes?: number
}

interface DecodedInputChunk {
  readonly channels: readonly [Float32Array, Float32Array]
  readonly sampleRate: number
}

interface WavFormat {
  readonly formatTag: number
  readonly channels: 1 | 2
  readonly sampleRate: number
  readonly blockAlign: number
  readonly bitsPerSample: 8 | 16 | 24 | 32
}

export class StreamingAudioDecodeError extends Error {
  constructor(readonly code: string, options?: ErrorOptions) {
    super(`streaming-audio-decoder.${code}`, options)
    this.name = 'StreamingAudioDecodeError'
  }
}

function ascii(bytes: Uint8Array, offset: number, expected: string): boolean {
  return expected.split('').every((character, index) => bytes[offset + index] === character.charCodeAt(0))
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
}

async function readBytes(blob: Blob, offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
  abortIfNeeded(signal)
  const bytes = new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer())
  if (bytes.byteLength !== length) throw new StreamingAudioDecodeError('truncated_wav')
  abortIfNeeded(signal)
  return bytes
}

async function readWavLayout(blob: Blob, signal?: AbortSignal): Promise<Readonly<{ format: WavFormat; dataOffset: number; dataBytes: number }>> {
  const header = await readBytes(blob, 0, 12, signal)
  if (!ascii(header, 0, 'RIFF') || !ascii(header, 8, 'WAVE')) throw new StreamingAudioDecodeError('unsupported_wav_container')
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
  const riffEnd = view.getUint32(4, true) + 8
  if (riffEnd > blob.size || riffEnd < 12) throw new StreamingAudioDecodeError('invalid_wav_size')

  let offset = 12
  let format: WavFormat | undefined
  let dataOffset: number | undefined
  let dataBytes: number | undefined
  while (offset + 8 <= riffEnd) {
    const chunkHeader = await readBytes(blob, offset, 8, signal)
    const chunkView = new DataView(chunkHeader.buffer, chunkHeader.byteOffset, chunkHeader.byteLength)
    const chunkLength = chunkView.getUint32(4, true)
    const payloadOffset = offset + 8
    if (payloadOffset + chunkLength > riffEnd) throw new StreamingAudioDecodeError('invalid_wav_chunk_size')
    if (ascii(chunkHeader, 0, 'fmt ')) {
      if (chunkLength < 16 || chunkLength > MAX_WAV_FORMAT_BYTES) throw new StreamingAudioDecodeError('unsupported_wav_format')
      const bytes = await readBytes(blob, payloadOffset, chunkLength, signal)
      const fmt = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const formatTag = fmt.getUint16(0, true)
      const channels = fmt.getUint16(2, true)
      const sampleRate = fmt.getUint32(4, true)
      const blockAlign = fmt.getUint16(12, true)
      const bitsPerSample = fmt.getUint16(14, true)
      if ((formatTag !== 1 && formatTag !== 3)
        || (channels !== 1 && channels !== 2)
        || !Number.isSafeInteger(sampleRate) || sampleRate <= 0
        || ![8, 16, 24, 32].includes(bitsPerSample)
        || (formatTag === 3 && bitsPerSample !== 32)
        || blockAlign !== channels * bitsPerSample / 8) {
        throw new StreamingAudioDecodeError('unsupported_wav_format')
      }
      format = { formatTag, channels, sampleRate, blockAlign, bitsPerSample: bitsPerSample as WavFormat['bitsPerSample'] }
    } else if (ascii(chunkHeader, 0, 'data')) {
      dataOffset = payloadOffset
      dataBytes = chunkLength
      if (format !== undefined) break
    }
    offset = payloadOffset + chunkLength + (chunkLength % 2)
  }
  if (format === undefined || dataOffset === undefined || dataBytes === undefined
    || dataBytes === 0 || dataBytes % format.blockAlign !== 0) {
    throw new StreamingAudioDecodeError('invalid_wav_layout')
  }
  return Object.freeze({ format, dataOffset, dataBytes })
}

function decodeWavChunk(bytes: Uint8Array, format: WavFormat): readonly [Float32Array, Float32Array] {
  const frameCount = Math.floor(bytes.length / format.blockAlign)
  const left = new Float32Array(frameCount)
  const right = new Float32Array(frameCount)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const bytesPerSample = format.bitsPerSample / 8
  const sampleAt = (offset: number): number => {
    if (format.formatTag === 3) return view.getFloat32(offset, true)
    switch (format.bitsPerSample) {
      case 8: return (view.getUint8(offset) - 128) / 128
      case 16: return view.getInt16(offset, true) / 32_768
      case 24: {
        let value = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16)
        if (value & 0x800000) value |= 0xff000000
        return value / 8_388_608
      }
      case 32: return view.getInt32(offset, true) / 2_147_483_648
    }
  }
  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameOffset = frame * format.blockAlign
    left[frame] = sampleAt(frameOffset)
    right[frame] = format.channels === 1 ? left[frame] : sampleAt(frameOffset + bytesPerSample)
  }
  return [left, right]
}

async function* wavChunks(
  blob: Blob,
  chunkBytes: number,
  signal?: AbortSignal,
): AsyncGenerator<DecodedInputChunk> {
  const layout = await readWavLayout(blob, signal)
  const alignedChunkBytes = Math.max(layout.format.blockAlign, chunkBytes - (chunkBytes % layout.format.blockAlign))
  let offset = 0
  while (offset < layout.dataBytes) {
    abortIfNeeded(signal)
    const length = Math.min(alignedChunkBytes, layout.dataBytes - offset)
    const bytes = await readBytes(blob, layout.dataOffset + offset, length, signal)
    const channels = decodeWavChunk(bytes, layout.format)
    if (channels[0].some((sample) => !Number.isFinite(sample)) || channels[1].some((sample) => !Number.isFinite(sample))) {
      throw new StreamingAudioDecodeError('non_finite_wav_sample')
    }
    yield { channels, sampleRate: layout.format.sampleRate }
    offset += length
  }
}

async function* resampleToTarget(
  input: AsyncIterable<DecodedInputChunk>,
  signal?: AbortSignal,
): AsyncGenerator<readonly [Float32Array, Float32Array]> {
  interface ResampleChunk {
    readonly start: number
    readonly channels: readonly [Float32Array, Float32Array]
  }
  const chunks: ResampleChunk[] = []
  let sourceFrames = 0
  let nextOutputFrame = 0
  let sourceRate: number | undefined
  let ended = false
  const iterator = input[Symbol.asyncIterator]()
  let outputLeft = new Float32Array(PCM_OUTPUT_CHUNK_FRAMES)
  let outputRight = new Float32Array(PCM_OUTPUT_CHUNK_FRAMES)
  let outputLength = 0

  const readSourceUntil = async (needed: number): Promise<void> => {
    while (!ended && sourceFrames <= needed) {
      abortIfNeeded(signal)
      const next = await iterator.next()
      if (next.done) {
        ended = true
        break
      }
      if (sourceRate !== undefined && sourceRate !== next.value.sampleRate) {
        throw new StreamingAudioDecodeError('sample_rate_changed')
      }
      sourceRate = next.value.sampleRate
      chunks.push({ start: sourceFrames, channels: next.value.channels })
      sourceFrames += next.value.channels[0].length
    }
  }
  const sampleAt = (frame: number, channelIndex: 0 | 1): number => {
    const chunk = chunks.find(({ start, channels }) => frame >= start && frame < start + channels[0].length)
    if (chunk === undefined) throw new StreamingAudioDecodeError('resample_frame_missing')
    return chunk.channels[channelIndex][frame - chunk.start]
  }
  const emitOutput = function* (): Generator<readonly [Float32Array, Float32Array]> {
    if (outputLength === 0) return
    yield [outputLeft.subarray(0, outputLength), outputRight.subarray(0, outputLength)]
    outputLeft = new Float32Array(PCM_OUTPUT_CHUNK_FRAMES)
    outputRight = new Float32Array(PCM_OUTPUT_CHUNK_FRAMES)
    outputLength = 0
  }

  try {
    while (true) {
      abortIfNeeded(signal)
      const position = nextOutputFrame * (sourceRate ?? TARGET_SAMPLE_RATE) / TARGET_SAMPLE_RATE
      await readSourceUntil(Math.floor(position) + 1)
      if (sourceFrames === 0) throw new StreamingAudioDecodeError('empty_audio')
      const totalOutputFrames = ended
        ? Math.round(sourceFrames * TARGET_SAMPLE_RATE / (sourceRate ?? TARGET_SAMPLE_RATE))
        : Number.POSITIVE_INFINITY
      if (nextOutputFrame >= totalOutputFrames) break
      if (!ended && Math.floor(position) + 1 >= sourceFrames) continue
      const safePosition = Math.min(position, sourceFrames - 1)
      const leftIndex = Math.floor(safePosition)
      const rightIndex = Math.min(leftIndex + 1, sourceFrames - 1)
      const fraction = safePosition - leftIndex
      outputLeft[outputLength] = sampleAt(leftIndex, 0) * (1 - fraction) + sampleAt(rightIndex, 0) * fraction
      outputRight[outputLength] = sampleAt(leftIndex, 1) * (1 - fraction) + sampleAt(rightIndex, 1) * fraction
      outputLength += 1
      nextOutputFrame += 1
      if (outputLength === PCM_OUTPUT_CHUNK_FRAMES) yield* emitOutput()
      const discardBefore = Math.floor(nextOutputFrame * (sourceRate ?? TARGET_SAMPLE_RATE) / TARGET_SAMPLE_RATE)
      while (chunks.length > 1 && chunks[0].start + chunks[0].channels[0].length <= discardBefore) chunks.shift()
    }
    yield* emitOutput()
  } finally {
    if (!ended) await iterator.return?.()
  }
}

/** Bounded Blob slicing, decoder output, resampling and PCM frame emission for MP3/WAV sources. */
export class StreamingAudioDecoder {
  private readonly sourceChunkBytes: number

  constructor(options: StreamingAudioDecoderOptions = {}) {
    this.sourceChunkBytes = options.sourceChunkBytes ?? DEFAULT_SOURCE_CHUNK_BYTES
    if (!Number.isSafeInteger(this.sourceChunkBytes) || this.sourceChunkBytes <= 0) {
      throw new Error('streaming-audio-decoder.invalid_chunk_size')
    }
  }

  decode(
    source: Blob,
    signal?: AbortSignal,
  ): AsyncIterable<readonly [Float32Array, Float32Array]> {
    if (source.size === 0) throw new StreamingAudioDecodeError('empty_audio')
    return resampleToTarget(wavChunks(source, this.sourceChunkBytes, signal), signal)
  }
}
