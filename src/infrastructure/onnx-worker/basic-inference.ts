import type * as ort from 'onnxruntime-web/webgpu'
import { Tensor } from 'onnxruntime-web/webgpu'

import { STFT_FREQ_BINS, buildCacInput, combineFrequencyAndTimeBranches, decodeCacOutputToWaveforms } from './stft'
import { MODEL_SEGMENT_SAMPLES, processPlanarWindows, type PlanarWindowProcessor, type WindowProgress } from './windowing'

/** Basic's own ONNX input/output tensor names (`docs/decisions/weight-mirrors.md`). */
const MIX_INPUT_NAME = 'mix'
const MAG_INPUT_NAME = 'mag'
const FREQ_OUTPUT_NAME = 'freq'
const TIME_OUTPUT_NAME = 'time'

/** CAC channel count per `stft.ts`'s fixed layout: `[L.real, L.imag, R.real, R.imag]`. */
const CAC_CHANNELS = 4

/** Basic's sources, `docs/decisions/weight-mirrors.md` order. Exposed only as a documentation aid, mirroring `rock-inference.ts`'s `ROCK_STEM_LANES`: never read for the count itself. */
export const BASIC_STEM_LANES = ['drums', 'bass', 'other', 'vocals'] as const

/** One fully reconstructed stem: `channelsPerStem` planar `Float32Array`s, each `frameCount` samples long. */
export type BasicStemWaveform = readonly Float32Array[]

export interface BasicInferenceResult {
  readonly stemCount: number
  readonly channelsPerStem: number
  /** `stemCount` entries, `BASIC_STEM_LANES` order when `stemCount` matches that array's length. */
  readonly stems: readonly BasicStemWaveform[]
}

/**
 * Builds the `[1, channelCount, MODEL_SEGMENT_SAMPLES]` raw `mix` input
 * tensor, channel-major layout -- identical in shape and layout to
 * `rock-inference.ts`'s own private `buildMixTensor`. Duplicated rather than
 * imported: that function is not exported, and this task must not modify
 * `rock-inference.ts` to export it, for what amounts to a ~10-line helper
 * shared by two otherwise-independent processors.
 */
function buildMixTensor(window: readonly Float32Array[]): ort.Tensor {
  const channelCount = window.length
  const data = new Float32Array(channelCount * MODEL_SEGMENT_SAMPLES)

  window.forEach((channel, index) => {
    if (channel.length !== MODEL_SEGMENT_SAMPLES) {
      throw new Error(
        `basic-inference.invalid_window_shape Expected ${MODEL_SEGMENT_SAMPLES} samples per channel, got ${channel.length}.`,
      )
    }
    data.set(channel, index * MODEL_SEGMENT_SAMPLES)
  })

  return new Tensor('float32', data, [1, channelCount, MODEL_SEGMENT_SAMPLES])
}

/**
 * Basic's real outputs are `freq [1, stemCount, 4, STFT_FREQ_BINS,
 * frameCount]` and `time [1, stemCount, channelsPerStem, MODEL_SEGMENT_SAMPLES]`
 * -- two tensors covering every stem at once, which does not fit
 * `PlanarWindowProcessor`'s flat `readonly Float32Array[]` return shape for a
 * single signal's overlap-add.
 *
 * Design choice, mirroring `rock-inference.ts`'s own flattening precedent
 * (P7B-03) rather than exposing `stemCount` independent processors: this
 * function flattens the combined (frequency-branch + time-branch) per-stem,
 * per-channel result into `stemCount * channelsPerStem` flat channels and
 * drives `processPlanarWindows` exactly **once**. Overlap-add is linear and
 * per-channel-independent, so this is mathematically identical to
 * `stemCount` separate per-stem overlap-add reconstructions, while
 * guaranteeing by construction that the session runs exactly once per
 * window. The flat result is de-interleaved back into per-stem waveforms
 * after the call resolves, in `runBasicInference`.
 *
 * The stem/channel count is never hardcoded -- it is read off the live
 * session's own `time` output shape on the first window (the same
 * unambiguous `[1, stemCount, channelsPerStem, samples]` 4-D shape Rock's
 * `stems` output uses), and cross-checked against `freq`'s stem count.
 */
export function createBasicWindowProcessor(
  session: ort.InferenceSession,
  captureShape: (stemCount: number, channelsPerStem: number) => void = () => undefined,
): PlanarWindowProcessor {
  return async (window) => {
    if (
      window.length !== 2 ||
      window.some((channel) => !(channel instanceof Float32Array) || channel.length !== MODEL_SEGMENT_SAMPLES)
    ) {
      throw new Error(
        `basic-inference.invalid_window_shape Expected a stereo window containing two ${MODEL_SEGMENT_SAMPLES}-sample Float32Arrays.`,
      )
    }

    const cac = buildCacInput(Float64Array.from(window[0]), Float64Array.from(window[1]))

    const feeds: Record<string, ort.Tensor> = {
      [MIX_INPUT_NAME]: buildMixTensor(window),
      [MAG_INPUT_NAME]: new Tensor('float32', cac.data, [1, CAC_CHANNELS, STFT_FREQ_BINS, cac.frameCount]),
    }
    const results = await session.run(feeds)
    const freqOutput = results[FREQ_OUTPUT_NAME]
    const timeOutput = results[TIME_OUTPUT_NAME]

    if (!freqOutput) {
      throw new Error(`basic-inference.missing_output Session did not return the required "${FREQ_OUTPUT_NAME}" output.`)
    }
    if (!timeOutput) {
      throw new Error(`basic-inference.missing_output Session did not return the required "${TIME_OUTPUT_NAME}" output.`)
    }

    if (freqOutput.dims.length !== 5) {
      throw new Error(
        `basic-inference.invalid_output_shape Expected a 5-D "${FREQ_OUTPUT_NAME}" output, got dims ${JSON.stringify(freqOutput.dims)}.`,
      )
    }
    if (timeOutput.dims.length !== 4) {
      throw new Error(
        `basic-inference.invalid_output_shape Expected a 4-D "${TIME_OUTPUT_NAME}" output, got dims ${JSON.stringify(timeOutput.dims)}.`,
      )
    }

    const [freqBatch, freqStemCount, cacChannels, freqBins, frameCount] = freqOutput.dims
    const [timeBatch, timeStemCount, channelsPerStem, segmentLength] = timeOutput.dims

    if (
      freqBatch !== 1 ||
      !Number.isSafeInteger(freqStemCount) ||
      freqStemCount <= 0 ||
      cacChannels !== CAC_CHANNELS ||
      freqBins !== STFT_FREQ_BINS ||
      frameCount !== cac.frameCount
    ) {
      throw new Error(
        `basic-inference.invalid_output_shape Expected "${FREQ_OUTPUT_NAME}" dims [1, stems, ${CAC_CHANNELS}, ${STFT_FREQ_BINS}, ${cac.frameCount}], got ${JSON.stringify(freqOutput.dims)}.`,
      )
    }
    if (freqStemCount !== timeStemCount) {
      throw new Error(
        `basic-inference.stem_count_mismatch "${FREQ_OUTPUT_NAME}" reports ${freqStemCount} stems but "${TIME_OUTPUT_NAME}" reports ${timeStemCount}.`,
      )
    }
    if (timeBatch !== 1 || channelsPerStem !== 2 || segmentLength !== MODEL_SEGMENT_SAMPLES) {
      throw new Error(
        `basic-inference.invalid_output_shape Expected "${TIME_OUTPUT_NAME}" dims [1, stems, 2, ${MODEL_SEGMENT_SAMPLES}], got ${JSON.stringify(timeOutput.dims)}.`,
      )
    }

    const expectedFreqLength = freqStemCount * CAC_CHANNELS * STFT_FREQ_BINS * frameCount
    const expectedTimeLength = timeStemCount * channelsPerStem * segmentLength
    if (!(freqOutput.data instanceof Float32Array) || freqOutput.data.length !== expectedFreqLength) {
      throw new Error(
        `basic-inference.invalid_output_shape Expected "${FREQ_OUTPUT_NAME}" float32 data length ${expectedFreqLength}, got ${freqOutput.data.length}.`,
      )
    }
    if (!(timeOutput.data instanceof Float32Array) || timeOutput.data.length !== expectedTimeLength) {
      throw new Error(
        `basic-inference.invalid_output_shape Expected "${TIME_OUTPUT_NAME}" float32 data length ${expectedTimeLength}, got ${timeOutput.data.length}.`,
      )
    }
    captureShape(freqStemCount, channelsPerStem)

    const decoded = decodeCacOutputToWaveforms(
      freqOutput.data,
      freqStemCount,
      frameCount,
      MODEL_SEGMENT_SAMPLES,
    )
    const timeData = timeOutput.data

    const flatChannels: Float32Array[] = []
    for (let stem = 0; stem < freqStemCount; stem += 1) {
      const decodedChannels = decoded[stem]
      for (let channel = 0; channel < channelsPerStem; channel += 1) {
        const frequencyBranch = decodedChannels[channel]
        const timeStart = (stem * channelsPerStem + channel) * segmentLength
        const timeBranch = timeData.subarray(timeStart, timeStart + segmentLength)
        const combined = combineFrequencyAndTimeBranches(frequencyBranch, timeBranch)
        flatChannels.push(Float32Array.from(combined))
      }
    }
    return flatChannels
  }
}

/**
 * Runs Basic's ONNX-shaped inference end to end over one whole-track planar
 * `mix` signal: windows it and runs the given already-created session
 * exactly once per window (via `processPlanarWindows`) -- building the `mag`
 * CAC input with `buildCacInput`, decoding the `freq` output back to
 * waveforms with `decodeCacOutputToWaveforms`, and summing with the `time`
 * output via `combineFrequencyAndTimeBranches` -- then de-interleaves the
 * flattened per-window output back into `stemCount` full-length stereo
 * waveforms, one per lane (see `BASIC_STEM_LANES`).
 *
 * `session` must already be open (created via `OnnxSessionManager`); this
 * function only runs windows through it.
 */
export async function runBasicInference(
  session: ort.InferenceSession,
  planarMix: readonly Float32Array[],
  onProgress?: (progress: WindowProgress) => void,
): Promise<BasicInferenceResult> {
  let stemCount: number | undefined
  let channelsPerStem: number | undefined

  const processor = createBasicWindowProcessor(session, (capturedStemCount, capturedChannelsPerStem) => {
    stemCount = capturedStemCount
    channelsPerStem = capturedChannelsPerStem
  })

  const flatChannels = await processPlanarWindows(planarMix, processor, onProgress)

  if (stemCount === undefined || channelsPerStem === undefined) {
    throw new Error('basic-inference.no_windows_processed No window was run through the session.')
  }

  const stems: BasicStemWaveform[] = []
  for (let stem = 0; stem < stemCount; stem += 1) {
    const channels: Float32Array[] = []
    for (let channel = 0; channel < channelsPerStem; channel += 1) {
      channels.push(flatChannels[stem * channelsPerStem + channel])
    }
    stems.push(Object.freeze(channels))
  }

  return Object.freeze({ stemCount, channelsPerStem, stems: Object.freeze(stems) })
}
