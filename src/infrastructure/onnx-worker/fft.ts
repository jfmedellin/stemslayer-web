/**
 * Radix-2 iterative Cooley-Tukey FFT/iFFT primitives, restricted to
 * power-of-two lengths, plus a real-input forward/inverse transform built on
 * top of the complex primitive. All computation here runs in Float64Array
 * precision for numerical parity with the S2 reference; public audio arrays
 * elsewhere in this module remain Float32Array (see windowing.ts).
 */

export interface ComplexSpectrum {
  readonly real: Float64Array
  readonly imaginary: Float64Array
}

function assertPowerOfTwoLength(length: number, label: string): void {
  if (!Number.isSafeInteger(length) || length <= 0 || (length & (length - 1)) !== 0) {
    throw new Error(`fft.invalid_length ${label} length must be a positive power of two, got ${length}.`)
  }
}

/**
 * In-place complex FFT (`inverse` false) or iFFT (`inverse` true) on parallel
 * real/imaginary buffers of equal power-of-two length. The inverse transform
 * is normalized by `1/length`, so `inverseFft(forwardFft(x))` reconstructs
 * `x` up to floating-point error.
 */
export function transformInPlace(real: Float64Array, imaginary: Float64Array, inverse: boolean): void {
  const length = real.length
  if (imaginary.length !== length) {
    throw new Error(
      `fft.invalid_length transformInPlace requires equal-length buffers, got real=${length} and imaginary=${imaginary.length}.`,
    )
  }
  assertPowerOfTwoLength(length, 'transformInPlace')

  bitReversalPermute(real, imaginary)

  const sign = inverse ? 1 : -1
  for (let size = 2; size <= length; size <<= 1) {
    const half = size >> 1
    const angle = (sign * 2 * Math.PI) / size
    const stepReal = Math.cos(angle)
    const stepImaginary = Math.sin(angle)

    for (let start = 0; start < length; start += size) {
      let factorReal = 1
      let factorImaginary = 0

      for (let offset = 0; offset < half; offset += 1) {
        const evenIndex = start + offset
        const oddIndex = evenIndex + half

        const evenReal = real[evenIndex]
        const evenImaginary = imaginary[evenIndex]
        const oddReal = real[oddIndex]
        const oddImaginary = imaginary[oddIndex]

        const twiddleReal = oddReal * factorReal - oddImaginary * factorImaginary
        const twiddleImaginary = oddReal * factorImaginary + oddImaginary * factorReal

        real[evenIndex] = evenReal + twiddleReal
        imaginary[evenIndex] = evenImaginary + twiddleImaginary
        real[oddIndex] = evenReal - twiddleReal
        imaginary[oddIndex] = evenImaginary - twiddleImaginary

        const nextFactorReal = factorReal * stepReal - factorImaginary * stepImaginary
        const nextFactorImaginary = factorReal * stepImaginary + factorImaginary * stepReal
        factorReal = nextFactorReal
        factorImaginary = nextFactorImaginary
      }
    }
  }

  if (inverse) {
    for (let index = 0; index < length; index += 1) {
      real[index] /= length
      imaginary[index] /= length
    }
  }
}

/** In-place bit-reversal permutation shared by the forward and inverse passes. */
function bitReversalPermute(real: Float64Array, imaginary: Float64Array): void {
  const length = real.length
  for (let i = 1, j = 0; i < length; i += 1) {
    let bit = length >> 1
    for (; (j & bit) !== 0; bit >>= 1) {
      j ^= bit
    }
    j ^= bit

    if (i < j) {
      const tempReal = real[i]
      real[i] = real[j]
      real[j] = tempReal
      const tempImaginary = imaginary[i]
      imaginary[i] = imaginary[j]
      imaginary[j] = tempImaginary
    }
  }
}

/** In-place complex forward FFT. Equivalent to `transformInPlace(real, imaginary, false)`. */
export function forwardFft(real: Float64Array, imaginary: Float64Array): void {
  transformInPlace(real, imaginary, false)
}

/** In-place complex inverse FFT. Equivalent to `transformInPlace(real, imaginary, true)`. */
export function inverseFft(real: Float64Array, imaginary: Float64Array): void {
  transformInPlace(real, imaginary, true)
}

function assertRealTransformLength(length: number): void {
  assertPowerOfTwoLength(length, 'real FFT')
  if (length < 2) {
    throw new Error(`fft.invalid_length real FFT length must be at least 2, got ${length}.`)
  }
}

/**
 * Real-input forward FFT: returns only the non-redundant bins `[0, length/2]`
 * for a real signal of the given power-of-two length (matching numpy's
 * `rfft`). Only the first `length` samples of `signal` are used.
 */
export function realForwardFft(signal: ArrayLike<number>, length: number): ComplexSpectrum {
  assertRealTransformLength(length)
  if (signal.length < length) {
    throw new Error(
      `fft.invalid_length realForwardFft requires at least ${length} input samples, got ${signal.length}.`,
    )
  }

  const real = new Float64Array(length)
  const imaginary = new Float64Array(length)
  for (let index = 0; index < length; index += 1) {
    real[index] = signal[index]
  }
  transformInPlace(real, imaginary, false)

  const binCount = length / 2 + 1
  return Object.freeze({ real: real.slice(0, binCount), imaginary: imaginary.slice(0, binCount) })
}

/**
 * Inverse of `realForwardFft`: reconstructs the conjugate-symmetric spectrum
 * from its non-redundant bins and returns the real-valued time signal.
 */
export function realInverseFft(spectrum: ComplexSpectrum, length: number): Float64Array {
  assertRealTransformLength(length)
  const binCount = length / 2 + 1
  if (spectrum.real.length !== binCount || spectrum.imaginary.length !== binCount) {
    throw new Error(
      `fft.invalid_bins realInverseFft expects ${binCount} bins, got real=${spectrum.real.length} and imaginary=${spectrum.imaginary.length}.`,
    )
  }

  const real = new Float64Array(length)
  const imaginary = new Float64Array(length)
  for (let bin = 0; bin < binCount; bin += 1) {
    real[bin] = spectrum.real[bin]
    imaginary[bin] = spectrum.imaginary[bin]
  }
  for (let bin = 1; bin < length / 2; bin += 1) {
    real[length - bin] = spectrum.real[bin]
    imaginary[length - bin] = -spectrum.imaginary[bin]
  }

  transformInPlace(real, imaginary, true)
  return real
}
