/** Fixed input length baked into both S2 ONNX exports (7.8 s at 44.1 kHz). */
export const MODEL_SEGMENT_SAMPLES = 343_980

/** 75% of the model segment: adjacent windows overlap by 25%. */
export const MODEL_WINDOW_STRIDE = 257_985

export interface WindowProgress {
  readonly window: number
  readonly totalWindows: number
}

export type PlanarWindowProcessor = (
  window: readonly Float32Array[],
) => readonly Float32Array[] | Promise<readonly Float32Array[]>

export interface FinalizedWindowChunk {
  readonly offset: number
  readonly channels: readonly Float32Array[]
}

/**
 * Returns the deterministic S2 offsets. A non-empty signal always starts at
 * zero and every subsequent stride starts another window, including a final
 * partial window.
 */
export function createWindowOffsets(frameCount: number): readonly number[] {
  if (!Number.isSafeInteger(frameCount) || frameCount <= 0) {
    throw new Error('windowing.invalid_input_shape Frame count must be a positive safe integer.')
  }

  const offsets: number[] = []
  for (let offset = 0; offset < frameCount; offset += MODEL_WINDOW_STRIDE) {
    offsets.push(offset)
  }
  return Object.freeze(offsets)
}

/**
 * Full Demucs triangular segment weight: two equal peaks for this even-sized
 * segment and non-zero endpoints. Accumulated weights are normalized after
 * overlap-add, so boundary and partial windows preserve their exact scale.
 */
export function createTriangularWeight(): Float32Array {
  const weight = new Float32Array(MODEL_SEGMENT_SAMPLES)
  const half = MODEL_SEGMENT_SAMPLES / 2

  for (let index = 0; index < half; index += 1) {
    const value = (index + 1) / half
    weight[index] = value
    weight[MODEL_SEGMENT_SAMPLES - index - 1] = value
  }
  return weight
}

function validateInput(planar: readonly Float32Array[]): number {
  if (planar.length === 0 || !(planar[0] instanceof Float32Array) || planar[0].length === 0) {
    throw new Error('windowing.invalid_input_shape Planar input must contain at least one non-empty Float32Array.')
  }

  const frameCount = planar[0].length
  if (planar.some((channel) => !(channel instanceof Float32Array) || channel.length !== frameCount)) {
    throw new Error('windowing.invalid_input_shape Every input channel must be a Float32Array of equal length.')
  }
  return frameCount
}

function createCenteredWindow(
  planar: readonly Float32Array[],
  frameCount: number,
  offset: number,
  naturalLength: number,
): { readonly planar: readonly Float32Array[]; readonly trimStart: number } {
  const trimStart = Math.floor((MODEL_SEGMENT_SAMPLES - naturalLength) / 2)
  const sourceStart = offset - trimStart
  const copyStart = Math.max(0, sourceStart)
  const copyEnd = Math.min(frameCount, sourceStart + MODEL_SEGMENT_SAMPLES)
  const targetStart = copyStart - sourceStart

  const centered = planar.map((channel) => {
    const result = new Float32Array(MODEL_SEGMENT_SAMPLES)
    result.set(channel.subarray(copyStart, copyEnd), targetStart)
    return result
  })

  return { planar: Object.freeze(centered), trimStart }
}

function validateOutput(output: readonly Float32Array[], expectedChannels: number | undefined): number {
  if (!Array.isArray(output) || output.length === 0 || (expectedChannels !== undefined && output.length !== expectedChannels)) {
    throw new Error('windowing.invalid_output_shape Every window must return the same non-zero channel count.')
  }

  if (output.some((channel) => !(channel instanceof Float32Array) || channel.length !== MODEL_SEGMENT_SAMPLES)) {
    throw new Error(
      `windowing.invalid_output_shape Every output channel must be a ${MODEL_SEGMENT_SAMPLES}-sample Float32Array.`,
    )
  }
  return output.length
}

/**
 * Processes fixed model windows and reconstructs arbitrary output channels by
 * normalized overlap-add. Partial windows receive equal left/right context
 * where possible (zero-filled beyond the signal), then their natural center is
 * trimmed before accumulation. Neither caller-owned input nor processor output
 * arrays are mutated.
 */
export async function processPlanarWindows(
  input: readonly Float32Array[],
  processWindow: PlanarWindowProcessor,
  onProgress?: (progress: WindowProgress) => void,
): Promise<readonly Float32Array[]> {
  const frameCount = validateInput(input)
  let channels: Float32Array[] | undefined
  await processPlanarWindowsStreaming(input, processWindow, ({ offset, channels: chunk }) => {
    channels ??= Array.from({ length: chunk.length }, () => new Float32Array(frameCount))
    chunk.forEach((channel, index) => channels![index].set(channel, offset))
  }, onProgress)
  if (channels === undefined) throw new Error('windowing.invalid_output_shape No output windows were produced.')
  return Object.freeze(channels)
}

/** Emits normalized samples as soon as no later 25%-overlap window can affect them. */
export async function processPlanarWindowsStreaming(
  input: readonly Float32Array[],
  processWindow: PlanarWindowProcessor,
  onChunk: (chunk: FinalizedWindowChunk) => void | Promise<void>,
  onProgress?: (progress: WindowProgress) => void,
  onBufferCapacity?: (samplesPerChannel: number) => void,
): Promise<void> {
  const frameCount = validateInput(input)
  const offsets = createWindowOffsets(frameCount)
  const weight = createTriangularWeight()
  let base = 0
  const accumulatedWeight = new Float64Array(MODEL_SEGMENT_SAMPLES)
  let accumulatedChannels: Float64Array[] | undefined

  for (let windowIndex = 0; windowIndex < offsets.length; windowIndex += 1) {
    const offset = offsets[windowIndex]
    const naturalLength = Math.min(MODEL_SEGMENT_SAMPLES, frameCount - offset)
    const centered = createCenteredWindow(input, frameCount, offset, naturalLength)
    const output = await processWindow(centered.planar)
    const outputChannelCount = validateOutput(output, accumulatedChannels?.length)
    accumulatedChannels ??= Array.from({ length: outputChannelCount }, () => new Float64Array(MODEL_SEGMENT_SAMPLES))

    for (let sample = 0; sample < naturalLength; sample += 1) {
      const local = offset + sample - base
      const modelCoordinate = centered.trimStart + sample
      const segmentWeight = weight[modelCoordinate]
      accumulatedWeight[local] += segmentWeight
      for (let channel = 0; channel < outputChannelCount; channel += 1) {
        accumulatedChannels[channel][local] += output[channel][modelCoordinate] * segmentWeight
      }
    }

    const flushLength = windowIndex + 1 < offsets.length ? offsets[windowIndex + 1] - base : frameCount - base
    const finalized = Object.freeze(accumulatedChannels.map((channel) => {
      const chunk = new Float32Array(flushLength)
      for (let sample = 0; sample < flushLength; sample += 1) {
        chunk[sample] = channel[sample] / accumulatedWeight[sample]
      }
      return chunk
    }))
    await onChunk({ offset: base, channels: finalized })
    const remaining = MODEL_SEGMENT_SAMPLES - flushLength
    for (const channel of accumulatedChannels) {
      channel.copyWithin(0, flushLength, flushLength + remaining)
      channel.fill(0, remaining)
    }
    accumulatedWeight.copyWithin(0, flushLength, flushLength + remaining)
    accumulatedWeight.fill(0, remaining)
    base += flushLength
    onBufferCapacity?.(MODEL_SEGMENT_SAMPLES)
    onProgress?.({ window: windowIndex + 1, totalWindows: offsets.length })
  }
}
