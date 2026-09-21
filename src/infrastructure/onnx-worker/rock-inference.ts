import type * as ort from 'onnxruntime-web/webgpu'
import { Tensor } from 'onnxruntime-web/webgpu'

import { MODEL_SEGMENT_SAMPLES, processPlanarWindows, type PlanarWindowProcessor, type WindowProgress } from './windowing'

/** Rock's own ONNX input/output tensor names (`docs/decisions/weight-mirrors.md`). */
const MIX_INPUT_NAME = 'mix'
const STEMS_OUTPUT_NAME = 'stems'

/**
 * Rock's lanes, in `docs/decisions/weight-mirrors.md` order. Exposed only as
 * a documentation aid: this module never hardcodes the stem count from this
 * array's length — it reads the real count off the session's own `stems`
 * output shape on the first window, per this task's own scoping note ("read
 * it from the tracker/fixture rather than hardcoding blindly").
 */
export const ROCK_STEM_LANES = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'] as const

/** One fully reconstructed stem: `channelsPerStem` planar `Float32Array`s, each `frameCount` samples long. */
export type RockStemWaveform = readonly Float32Array[]

export interface RockInferenceResult {
  readonly stemCount: number
  readonly channelsPerStem: number
  /** `stemCount` entries, `ROCK_STEM_LANES` order when `stemCount` matches that array's length. */
  readonly stems: readonly RockStemWaveform[]
}

/**
 * Builds the `[1, channelCount, MODEL_SEGMENT_SAMPLES]` input tensor Rock's
 * ONNX graph expects from one already-windowed planar chunk. Channel-major
 * layout (whole left channel, then whole right channel), matching the
 * synthetic fixture's own shape and `generate_synthetic_models.py`'s Reshape
 * step.
 */
function buildMixTensor(window: readonly Float32Array[]): ort.Tensor {
  const channelCount = window.length
  const data = new Float32Array(channelCount * MODEL_SEGMENT_SAMPLES)

  window.forEach((channel, index) => {
    if (channel.length !== MODEL_SEGMENT_SAMPLES) {
      throw new Error(
        `rock-inference.invalid_window_length Expected ${MODEL_SEGMENT_SAMPLES} samples per channel, got ${channel.length}.`,
      )
    }
    data.set(channel, index * MODEL_SEGMENT_SAMPLES)
  })

  return new Tensor('float32', data, [1, channelCount, MODEL_SEGMENT_SAMPLES])
}

/**
 * Rock's real output is `[1, stemCount, channelsPerStem, MODEL_SEGMENT_SAMPLES]`
 * — one 4-D tensor covering every stem at once, which does not fit
 * `PlanarWindowProcessor`'s flat `readonly Float32Array[]` return shape for a
 * single signal's overlap-add.
 *
 * Design choice (documented per this task's scoping note): rather than
 * exposing 6 separate `PlanarWindowProcessor`s that would need an external
 * cache to share one session run per window across independent
 * `processPlanarWindows` calls, this module flattens the 4-D output into
 * `stemCount * channelsPerStem` flat channels (`[stem0ch0, stem0ch1, ...,
 * stem5ch0, stem5ch1]`) and drives `processPlanarWindows` exactly **once**.
 * Overlap-add is a linear, per-channel-independent operation — each output
 * channel is weighted and normalized only by its own sample position, never
 * by other channels' content — so accumulating all `stemCount *
 * channelsPerStem` channels through a single `processPlanarWindows` call is
 * mathematically identical to running one call per stem, while guaranteeing
 * by construction that the session runs exactly once per window (no
 * coordination cache, no reliance on concurrent-call ordering). The flat
 * result is de-interleaved back into per-stem waveforms after the call
 * resolves, in `runRockInference`.
 */
function createFlattenedRockProcessor(
  session: ort.InferenceSession,
  captureShape: (stemCount: number, channelsPerStem: number) => void,
): PlanarWindowProcessor {
  return async (window) => {
    const feeds: Record<string, ort.Tensor> = { [MIX_INPUT_NAME]: buildMixTensor(window) }
    const results = await session.run(feeds)
    const output = results[STEMS_OUTPUT_NAME]

    if (!output || output.dims.length !== 4) {
      throw new Error(
        `rock-inference.invalid_output_shape Expected a 4-D "${STEMS_OUTPUT_NAME}" output, got dims ${JSON.stringify(output?.dims)}.`,
      )
    }

    const [, stemCount, channelsPerStem, segmentLength] = output.dims
    if (segmentLength !== MODEL_SEGMENT_SAMPLES) {
      throw new Error(
        `rock-inference.invalid_output_shape Expected a ${MODEL_SEGMENT_SAMPLES}-sample segment, got ${segmentLength}.`,
      )
    }
    captureShape(stemCount, channelsPerStem)

    const data = output.data as Float32Array
    const flatChannels: Float32Array[] = []
    for (let stem = 0; stem < stemCount; stem += 1) {
      for (let channel = 0; channel < channelsPerStem; channel += 1) {
        const start = (stem * channelsPerStem + channel) * segmentLength
        flatChannels.push(data.subarray(start, start + segmentLength))
      }
    }
    return flatChannels
  }
}

/**
 * Runs Rock's ONNX-shaped inference end to end over one whole-track planar
 * `mix` signal: windows it and runs the given already-created session
 * exactly once per window (via `processPlanarWindows`), then de-interleaves
 * the flattened per-window output back into `stemCount` full-length stereo
 * waveforms, one per lane (see `ROCK_STEM_LANES`).
 *
 * `session` must already be open (created via `OnnxSessionManager`); this
 * function only runs windows through it, matching this task's scope: "this
 * module is only responsible for running ONE window through an
 * already-open Rock-shaped session".
 */
export async function runRockInference(
  session: ort.InferenceSession,
  planarMix: readonly Float32Array[],
  onProgress?: (progress: WindowProgress) => void,
): Promise<RockInferenceResult> {
  let stemCount: number | undefined
  let channelsPerStem: number | undefined

  const processor = createFlattenedRockProcessor(session, (capturedStemCount, capturedChannelsPerStem) => {
    stemCount = capturedStemCount
    channelsPerStem = capturedChannelsPerStem
  })

  const flatChannels = await processPlanarWindows(planarMix, processor, onProgress)

  if (stemCount === undefined || channelsPerStem === undefined) {
    throw new Error('rock-inference.no_windows_processed No window was run through the session.')
  }

  const stems: RockStemWaveform[] = []
  for (let stem = 0; stem < stemCount; stem += 1) {
    const channels: Float32Array[] = []
    for (let channel = 0; channel < channelsPerStem; channel += 1) {
      channels.push(flatChannels[stem * channelsPerStem + channel])
    }
    stems.push(Object.freeze(channels))
  }

  return Object.freeze({ stemCount, channelsPerStem, stems: Object.freeze(stems) })
}
