import { describe, expect, test } from 'vitest'

import {
  forwardFft,
  inverseFft,
  realForwardFft,
  realInverseFft,
  transformInPlace,
} from '../../../src/infrastructure/onnx-worker/fft'

/**
 * Independent O(n^2) DFT oracle. Deliberately not the fast algorithm under
 * test, so golden comparisons never validate the FFT against itself.
 */
function directDft(real: Float64Array, imaginary: Float64Array, inverse: boolean): { re: Float64Array; im: Float64Array } {
  const n = real.length
  const sign = inverse ? 1 : -1
  const outRe = new Float64Array(n)
  const outIm = new Float64Array(n)

  for (let k = 0; k < n; k += 1) {
    let sumRe = 0
    let sumIm = 0
    for (let t = 0; t < n; t += 1) {
      const angle = (sign * 2 * Math.PI * k * t) / n
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      sumRe += real[t] * cos - imaginary[t] * sin
      sumIm += real[t] * sin + imaginary[t] * cos
    }
    outRe[k] = inverse ? sumRe / n : sumRe
    outIm[k] = inverse ? sumIm / n : sumIm
  }
  return { re: outRe, im: outIm }
}

function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let maximum = 0
  for (let index = 0; index < a.length; index += 1) {
    maximum = Math.max(maximum, Math.abs(a[index] - b[index]))
  }
  return maximum
}

function fixtureSignal(length: number, phase = 0): Float64Array {
  return Float64Array.from({ length }, (_, index) => Math.sin((index + phase) * 0.37) + 0.25 * Math.cos(index * 1.1))
}

describe('transformInPlace', () => {
  test.each([
    ['zero length', 0, 0],
    ['non power of two', 6, 6],
    ['mismatched buffers', 8, 4],
  ])('rejects invalid buffers: %s', (_name, realLength, imaginaryLength) => {
    const real = new Float64Array(realLength)
    const imaginary = new Float64Array(imaginaryLength)
    expect(() => transformInPlace(real, imaginary, false)).toThrow('fft.invalid_length')
  })

  test('matches an independent direct DFT on a deterministic complex fixture', () => {
    const length = 8
    const real = fixtureSignal(length)
    const imaginary = fixtureSignal(length, 5)

    const expected = directDft(real, imaginary, false)

    const actualReal = real.slice()
    const actualImaginary = imaginary.slice()
    forwardFft(actualReal, actualImaginary)

    expect(maxAbsDiff(actualReal, expected.re)).toBeLessThanOrEqual(1e-6)
    expect(maxAbsDiff(actualImaginary, expected.im)).toBeLessThanOrEqual(1e-6)
  })

  test('matches an independent direct inverse DFT on a deterministic complex fixture', () => {
    const length = 16
    const real = fixtureSignal(length, 2)
    const imaginary = fixtureSignal(length, 9)

    const expected = directDft(real, imaginary, true)

    const actualReal = real.slice()
    const actualImaginary = imaginary.slice()
    inverseFft(actualReal, actualImaginary)

    expect(maxAbsDiff(actualReal, expected.re)).toBeLessThanOrEqual(1e-6)
    expect(maxAbsDiff(actualImaginary, expected.im)).toBeLessThanOrEqual(1e-6)
  })

  test.each([1, 2, 4, 8, 32, 256])('round-trips a complex fixture of length %i within 1e-6', (length) => {
    const real = fixtureSignal(length)
    const imaginary = fixtureSignal(length, 3)
    const originalReal = real.slice()
    const originalImaginary = imaginary.slice()

    forwardFft(real, imaginary)
    inverseFft(real, imaginary)

    expect(maxAbsDiff(real, originalReal)).toBeLessThanOrEqual(1e-6)
    expect(maxAbsDiff(imaginary, originalImaginary)).toBeLessThanOrEqual(1e-6)
  })
})

describe('realForwardFft / realInverseFft', () => {
  test.each([
    ['zero length', 0],
    ['non power of two', 12],
    ['length one', 1],
  ])('rejects an invalid real FFT length: %s', (_name, length) => {
    expect(() => realForwardFft(fixtureSignal(Math.max(length, 1)), length)).toThrow('fft.invalid_length')
  })

  test('rejects a signal shorter than the requested length', () => {
    expect(() => realForwardFft(fixtureSignal(4), 8)).toThrow('fft.invalid_length')
  })

  test('rejects a spectrum with the wrong bin count on inverse', () => {
    expect(() =>
      realInverseFft({ real: new Float64Array(3), imaginary: new Float64Array(3) }, 8),
    ).toThrow('fft.invalid_bins')
  })

  test('matches an independent direct real DFT for the non-redundant bins', () => {
    const length = 32
    const signal = fixtureSignal(length)

    const expected = directDft(signal, new Float64Array(length), false)
    const binCount = length / 2 + 1

    const spectrum = realForwardFft(signal, length)

    expect(spectrum.real).toHaveLength(binCount)
    expect(spectrum.imaginary).toHaveLength(binCount)
    expect(maxAbsDiff(spectrum.real, expected.re.slice(0, binCount))).toBeLessThanOrEqual(1e-6)
    expect(maxAbsDiff(spectrum.imaginary, expected.im.slice(0, binCount))).toBeLessThanOrEqual(1e-6)
  })

  test('produces a real (near-zero imaginary) DC and Nyquist bin for a real input', () => {
    const length = 64
    const spectrum = realForwardFft(fixtureSignal(length), length)

    expect(Math.abs(spectrum.imaginary[0])).toBeLessThanOrEqual(1e-9)
    expect(Math.abs(spectrum.imaginary.at(-1) ?? Infinity)).toBeLessThanOrEqual(1e-9)
  })

  test.each([2, 4, 16, 64, 4096])('round-trips a real signal of length %i within 1e-6', (length) => {
    const signal = fixtureSignal(length, 11)

    const spectrum = realForwardFft(signal, length)
    const reconstructed = realInverseFft(spectrum, length)

    expect(maxAbsDiff(reconstructed, signal)).toBeLessThanOrEqual(1e-6)
  })
})
