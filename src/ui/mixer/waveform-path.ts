/**
 * Builds an SVG `<path>` `d` attribute drawing a mirrored (top/bottom)
 * waveform from a precomputed peak envelope (`domain/mixer/mixer.ts`'s
 * `computePeakEnvelope`), scaled to a `width`x`height` viewBox. Pure
 * geometry, no DOM access — a rendering concern of the Mixer UI, not the
 * audio domain.
 */
export function buildWaveformPath(peaks: Float32Array, width: number, height: number): string {
  const binCount = peaks.length
  if (binCount === 0) return ''

  const midY = height / 2
  const binWidth = width / binCount
  const top: string[] = []
  const bottom: string[] = []

  for (let bin = 0; bin < binCount; bin += 1) {
    const amplitude = Math.min(1, Math.max(0, peaks[bin])) * midY
    const x = (bin + 0.5) * binWidth
    top.push(`${x.toFixed(2)},${(midY - amplitude).toFixed(2)}`)
    bottom.push(`${x.toFixed(2)},${(midY + amplitude).toFixed(2)}`)
  }

  return `M${top.join(' L')} L${bottom.reverse().join(' L')} Z`
}
