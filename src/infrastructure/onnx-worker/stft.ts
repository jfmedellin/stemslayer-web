/**
 * Basic-only spectral adapters over `fft.ts`: forward/inverse STFT matching
 * `torch.stft`/`torch.istft` with `center=True`, `normalized=True`, a
 * periodic Hann window, and reflect padding; the Demucs-specific
 * `_spec`/`_ispec` wrapper that drops the Nyquist bin and applies the
 * `hop//2*3` context padding used by `htdemucs.onnx`'s `mag` input and
 * `freq` output; the complex-as-channels (CAC) layout builder/decoder; and a
 * pure elementwise helper for summing the frequency- and time-branch
 * outputs. All internal math runs in `Float64Array` precision, matching the
 * S2 numpy/torch reference (see `spikes/s2/dsp/stft.js` and
 * `spikes/s2/README.md`, "Derived pre/post-processing").
 *
 * This module contains no Worker/ONNX Runtime code: it is called by P7b with
 * real graph outputs, never by this task.
 */

import { type ComplexSpectrum, realForwardFft, realInverseFft } from './fft'

/** Demucs/S2 spectral transform size. */
export const STFT_N_FFT = 4096

/** Demucs/S2 hop length. */
export const STFT_HOP = 1024

/** Non-redundant bins including the Nyquist bin: `n_fft / 2 + 1`. */
const STFT_FREQ_BINS_WITH_NYQUIST = STFT_N_FFT / 2 + 1

/** Basic CAC layout bin count after dropping the Nyquist bin: `n_fft / 2`. */
export const STFT_FREQ_BINS = STFT_N_FFT / 2

/** `HTDemucs._spec`/`_ispec` context padding: `hop // 2 * 3`. */
export const DEMUCS_SPEC_PAD = (STFT_HOP / 2) * 3

const HANN_WINDOW = createPeriodicHannWindow(STFT_N_FFT)

/** Periodic Hann window (`torch.hann_window(length, periodic=True)`). */
function createPeriodicHannWindow(length: number): Float64Array {
  const window = new Float64Array(length)
  for (let index = 0; index < length; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / length)
  }
  return window
}

/**
 * numpy-style 'reflect' padding: mirrors the signal without repeating the
 * edge sample (`np.pad(x, (padLeft, padRight), mode='reflect')`).
 */
function reflectPad(signal: Float64Array, padLeft: number, padRight: number): Float64Array {
  const length = signal.length
  if (padLeft < 0 || padRight < 0 || padLeft >= length || padRight >= length) {
    throw new Error(
      `stft.invalid_pad reflect padding (${padLeft}, ${padRight}) must be non-negative and smaller than signal length ${length}.`,
    )
  }

  const output = new Float64Array(length + padLeft + padRight)
  for (let index = 0; index < padLeft; index += 1) {
    output[index] = signal[padLeft - index]
  }
  output.set(signal, padLeft)
  for (let index = 0; index < padRight; index += 1) {
    output[padLeft + length + index] = signal[length - 2 - index]
  }
  return output
}

function assertFrameBins(frame: ComplexSpectrum, expectedBins: number, label: string): void {
  if (frame.real.length !== expectedBins || frame.imaginary.length !== expectedBins) {
    throw new Error(
      `stft.invalid_bins ${label} expects ${expectedBins} bins per frame, got real=${frame.real.length} and imaginary=${frame.imaginary.length}.`,
    )
  }
}

/**
 * `torch.stft(x, n_fft=4096, hop_length=1024, window=hann(periodic),
 * center=True, pad_mode='reflect', normalized=True)` equivalent: reflect-pads
 * by `n_fft / 2` on each side, then returns one non-redundant `[0, n_fft/2]`
 * complex frame per hop, scaled by `1 / sqrt(n_fft)`.
 */
export function centeredNormalizedStft(signal: Float64Array): readonly ComplexSpectrum[] {
  const centerPad = STFT_N_FFT / 2
  const padded = reflectPad(signal, centerPad, centerPad)
  const frameCount = 1 + Math.floor((padded.length - STFT_N_FFT) / STFT_HOP)
  const scale = 1 / Math.sqrt(STFT_N_FFT)

  const frameBuffer = new Float64Array(STFT_N_FFT)
  const frames: ComplexSpectrum[] = []
  for (let frame = 0; frame < frameCount; frame += 1) {
    const base = frame * STFT_HOP
    for (let index = 0; index < STFT_N_FFT; index += 1) {
      frameBuffer[index] = padded[base + index] * HANN_WINDOW[index]
    }
    const spectrum = realForwardFft(frameBuffer, STFT_N_FFT)
    frames.push(
      Object.freeze({
        real: Float64Array.from(spectrum.real, (value) => value * scale),
        imaginary: Float64Array.from(spectrum.imaginary, (value) => value * scale),
      }),
    )
  }
  return Object.freeze(frames)
}

/**
 * Inverse of `centeredNormalizedStft` (same parameters), matching
 * `torch.istft` with `normalized=True`, `center=True`, `length=outputLength`.
 */
export function centeredNormalizedIstft(frames: readonly ComplexSpectrum[], outputLength: number): Float64Array {
  if (frames.length === 0) {
    throw new Error('stft.invalid_frames centeredNormalizedIstft requires at least one frame.')
  }

  const frameCount = frames.length
  const totalLength = (frameCount - 1) * STFT_HOP + STFT_N_FFT
  const accumulated = new Float64Array(totalLength)
  const weightSum = new Float64Array(totalLength)
  const scale = Math.sqrt(STFT_N_FFT)

  for (let frame = 0; frame < frameCount; frame += 1) {
    const spectrum = frames[frame]
    assertFrameBins(spectrum, STFT_FREQ_BINS_WITH_NYQUIST, 'centeredNormalizedIstft')

    const timeFrame = realInverseFft(
      {
        real: Float64Array.from(spectrum.real, (value) => value * scale),
        imaginary: Float64Array.from(spectrum.imaginary, (value) => value * scale),
      },
      STFT_N_FFT,
    )

    const base = frame * STFT_HOP
    for (let index = 0; index < STFT_N_FFT; index += 1) {
      const windowValue = HANN_WINDOW[index]
      accumulated[base + index] += timeFrame[index] * windowValue
      weightSum[base + index] += windowValue * windowValue
    }
  }

  for (let index = 0; index < totalLength; index += 1) {
    if (weightSum[index] > 1e-11) {
      accumulated[index] /= weightSum[index]
    }
  }

  const centerPad = STFT_N_FFT / 2
  const output = new Float64Array(outputLength)
  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = centerPad + index
    output[index] = sourceIndex < accumulated.length ? accumulated[sourceIndex] : 0
  }
  return output
}

export interface DemucsSpectrum {
  /** `STFT_FREQ_BINS` (2048) bins per frame; the Nyquist bin is dropped. */
  readonly frames: readonly ComplexSpectrum[]
  readonly frameCount: number
}

/**
 * `HTDemucs._spec` + `HTDemucs._magnitude(cac=True)` (single channel):
 * reflect-pads by `DEMUCS_SPEC_PAD` on the left and enough on the right to
 * cover `ceil(length / hop)` hops, runs `centeredNormalizedStft`, trims to
 * the middle `ceil(length / hop)` frames, and drops the Nyquist bin.
 */
export function demucsForwardSpec(signal: Float64Array): DemucsSpectrum {
  const length = signal.length
  const frameTarget = Math.ceil(length / STFT_HOP)
  const rightPad = DEMUCS_SPEC_PAD + frameTarget * STFT_HOP - length
  const padded = reflectPad(signal, DEMUCS_SPEC_PAD, rightPad)
  const allFrames = centeredNormalizedStft(padded)

  const start = 2
  if (allFrames.length < start + frameTarget) {
    throw new Error(
      `stft.invalid_frame_count demucsForwardSpec expected at least ${start + frameTarget} intermediate frames for length ${length}, got ${allFrames.length}.`,
    )
  }

  const frames = allFrames.slice(start, start + frameTarget).map((frame) =>
    Object.freeze({
      real: frame.real.slice(0, STFT_FREQ_BINS),
      imaginary: frame.imaginary.slice(0, STFT_FREQ_BINS),
    }),
  )
  return Object.freeze({ frames: Object.freeze(frames), frameCount: frameTarget })
}

/**
 * `HTDemucs._ispec` (single channel): zero-pads the frequency axis back to
 * `STFT_FREQ_BINS_WITH_NYQUIST` bins, zero-pads the frame axis by 2 frames on
 * each side, runs `centeredNormalizedIstft`, then trims `DEMUCS_SPEC_PAD`
 * samples of context from each end to recover the original-length waveform.
 */
export function demucsInverseSpec(frames: readonly ComplexSpectrum[], length: number): Float64Array {
  for (const frame of frames) {
    assertFrameBins(frame, STFT_FREQ_BINS, 'demucsInverseSpec')
  }

  const zeroFrame = (): ComplexSpectrum =>
    Object.freeze({
      real: new Float64Array(STFT_FREQ_BINS_WITH_NYQUIST),
      imaginary: new Float64Array(STFT_FREQ_BINS_WITH_NYQUIST),
    })

  const padded: ComplexSpectrum[] = [zeroFrame(), zeroFrame()]
  for (const frame of frames) {
    const real = new Float64Array(STFT_FREQ_BINS_WITH_NYQUIST)
    const imaginary = new Float64Array(STFT_FREQ_BINS_WITH_NYQUIST)
    real.set(frame.real)
    imaginary.set(frame.imaginary)
    padded.push(Object.freeze({ real, imaginary }))
  }
  padded.push(zeroFrame(), zeroFrame())

  const extendedLength = STFT_HOP * Math.ceil(length / STFT_HOP) + 2 * DEMUCS_SPEC_PAD
  const reconstructed = centeredNormalizedIstft(padded, extendedLength)
  return reconstructed.slice(DEMUCS_SPEC_PAD, DEMUCS_SPEC_PAD + length)
}

export interface CacInput {
  /** Flat, row-major `[4, STFT_FREQ_BINS, frameCount]`: `[L.real, L.imag, R.real, R.imag]`. */
  readonly data: Float32Array
  readonly frameCount: number
}

/**
 * `compute_mag`: builds the CAC `mag` model input from a stereo mix,
 * `[L.real, L.imag, R.real, R.imag]`, flat row-major `[4, STFT_FREQ_BINS,
 * frameCount]` (frame index fastest-varying), matching numpy's default C
 * order.
 */
export function buildCacInput(left: Float64Array, right: Float64Array): CacInput {
  const leftSpectrum = demucsForwardSpec(left)
  const rightSpectrum = demucsForwardSpec(right)
  if (leftSpectrum.frameCount !== rightSpectrum.frameCount) {
    throw new Error(
      `stft.channel_mismatch buildCacInput requires both channels to produce the same frame count, got left=${leftSpectrum.frameCount} and right=${rightSpectrum.frameCount}.`,
    )
  }

  const frameCount = leftSpectrum.frameCount
  const data = new Float32Array(4 * STFT_FREQ_BINS * frameCount)

  const fill = (channelIndex: number, spectrum: DemucsSpectrum, part: 'real' | 'imaginary') => {
    const base = channelIndex * STFT_FREQ_BINS * frameCount
    for (let frame = 0; frame < frameCount; frame += 1) {
      const bins = spectrum.frames[frame][part]
      for (let bin = 0; bin < STFT_FREQ_BINS; bin += 1) {
        data[base + bin * frameCount + frame] = bins[bin]
      }
    }
  }

  fill(0, leftSpectrum, 'real')
  fill(1, leftSpectrum, 'imaginary')
  fill(2, rightSpectrum, 'real')
  fill(3, rightSpectrum, 'imaginary')

  return Object.freeze({ data, frameCount })
}

/**
 * `freq_output_to_waveform`: reverses the CAC layout on the graph's `freq`
 * output, flat row-major `[sourceCount, 4, STFT_FREQ_BINS, frameCount]`, and
 * runs `demucsInverseSpec` per source and stereo channel.
 */
export function decodeCacOutputToWaveforms(
  freqOutput: ArrayLike<number>,
  sourceCount: number,
  frameCount: number,
  outputLength: number,
): readonly (readonly [Float64Array, Float64Array])[] {
  const results: [Float64Array, Float64Array][] = []

  for (let source = 0; source < sourceCount; source += 1) {
    const sourceBase = source * 4 * STFT_FREQ_BINS * frameCount
    const channelWaveforms: Float64Array[] = []

    for (let channel = 0; channel < 2; channel += 1) {
      const realBase = sourceBase + channel * 2 * STFT_FREQ_BINS * frameCount
      const imaginaryBase = sourceBase + (channel * 2 + 1) * STFT_FREQ_BINS * frameCount

      const frames: ComplexSpectrum[] = []
      for (let frame = 0; frame < frameCount; frame += 1) {
        const real = new Float64Array(STFT_FREQ_BINS)
        const imaginary = new Float64Array(STFT_FREQ_BINS)
        for (let bin = 0; bin < STFT_FREQ_BINS; bin += 1) {
          real[bin] = freqOutput[realBase + bin * frameCount + frame]
          imaginary[bin] = freqOutput[imaginaryBase + bin * frameCount + frame]
        }
        frames.push(Object.freeze({ real, imaginary }))
      }

      channelWaveforms.push(demucsInverseSpec(frames, outputLength))
    }

    results.push([channelWaveforms[0], channelWaveforms[1]])
  }

  return Object.freeze(results)
}

/**
 * Pure elementwise sum of the frequency-branch iSTFT result and the
 * time-branch model output for one source/channel, matching `forward()`'s
 * `x = xt + x`. Contains no Worker/ONNX/session behavior.
 */
export function combineFrequencyAndTimeBranches(
  frequencyBranch: ArrayLike<number>,
  timeBranch: ArrayLike<number>,
): Float64Array {
  if (frequencyBranch.length !== timeBranch.length) {
    throw new Error(
      `stft.branch_length_mismatch combineFrequencyAndTimeBranches requires equal-length branches, got frequency=${frequencyBranch.length} and time=${timeBranch.length}.`,
    )
  }

  const combined = new Float64Array(frequencyBranch.length)
  for (let index = 0; index < combined.length; index += 1) {
    combined[index] = frequencyBranch[index] + timeBranch[index]
  }
  return combined
}
