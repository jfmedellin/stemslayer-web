const INFERENCE_SAMPLE_RATE = 44_100
const INFERENCE_CHANNEL_COUNT = 2

/** Minimal decoded-buffer surface used by the inference decoder and its tests. */
export interface AudioBufferLike {
  readonly numberOfChannels: number
  readonly length: number
  readonly sampleRate: number
  getChannelData(channel: number): Float32Array
}

/** Minimal AudioContext surface used by the inference decoder and its tests. */
export interface AudioContextLike {
  decodeAudioData(audioData: ArrayBuffer): Promise<AudioBufferLike>
  close(): Promise<void>
}

export interface DecodedInferenceAudio {
  readonly sampleRate: number
  readonly planarChannels: readonly [Float32Array, Float32Array]
}

export class AudioDecodeError extends Error {
  constructor(cause: unknown) {
    super('audio-decoder.decode_failed', { cause })
    this.name = 'AudioDecodeError'
  }
}

export class DecodedAudioEmptyError extends Error {
  constructor() {
    super('audio-decoder.empty')
    this.name = 'DecodedAudioEmptyError'
  }
}

export class DecodedAudioChannelCountError extends Error {
  constructor(readonly actualChannels: number) {
    super(`audio-decoder.unsupported_channel_count:${actualChannels}`)
    this.name = 'DecodedAudioChannelCountError'
  }
}

export class DecodedAudioLengthMismatchError extends Error {
  constructor(readonly expectedFrames: number, readonly actualFrames: readonly number[]) {
    super(`audio-decoder.channel_length_mismatch:${expectedFrames}:${actualFrames.join(',')}`)
    this.name = 'DecodedAudioLengthMismatchError'
  }
}

type CreateAudioContext = () => AudioContextLike

function createInferenceAudioContext(): AudioContextLike {
  return new AudioContext({ sampleRate: INFERENCE_SAMPLE_RATE })
}

function ownedArrayBuffer(source: Uint8Array): ArrayBuffer {
  return Uint8Array.from(source).buffer
}

/**
 * Main-thread Web Audio boundary for inference input only.
 *
 * This is intentionally separate from P9 playback: it decodes one uploaded
 * file to the fixed stereo/44.1 kHz PCM contract consumed by the ONNX models,
 * then closes its short-lived AudioContext immediately.
 */
export class WebAudioInferenceDecoder {
  constructor(private readonly createAudioContext: CreateAudioContext = createInferenceAudioContext) {}

  async decode(source: Uint8Array): Promise<DecodedInferenceAudio> {
    const context = this.createAudioContext()
    try {
      if (source.byteLength === 0) throw new DecodedAudioEmptyError()

      let decoded: AudioBufferLike
      try {
        decoded = await context.decodeAudioData(ownedArrayBuffer(source))
      } catch (cause) {
        throw new AudioDecodeError(cause)
      }

      if (decoded.numberOfChannels !== INFERENCE_CHANNEL_COUNT) {
        throw new DecodedAudioChannelCountError(decoded.numberOfChannels)
      }
      if (decoded.length === 0) throw new DecodedAudioEmptyError()

      const left = decoded.getChannelData(0)
      const right = decoded.getChannelData(1)
      if (left.length !== decoded.length || right.length !== decoded.length) {
        throw new DecodedAudioLengthMismatchError(decoded.length, [left.length, right.length])
      }

      return Object.freeze({
        sampleRate: decoded.sampleRate,
        planarChannels: Object.freeze([left.slice(), right.slice()]) as readonly [Float32Array, Float32Array],
      })
    } finally {
      await context.close()
    }
  }
}
