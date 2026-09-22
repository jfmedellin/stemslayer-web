/**
 * Maps a 0-100% domain gain value to a display-only dB string
 * (`docs/decisions/feature-parity.md`'s Mixer section: the domain itself
 * stays percent/linear per `gainFromPercent`'s contract — only the rendered
 * readout converts to dB, matching the fetched Mixer mockup's "−1.5 dB"
 * style gain readouts).
 */
export function formatGainDb(percent: number): string {
  if (!Number.isFinite(percent) || percent <= 0) return '−∞ dB'

  const linear = percent / 100
  const decibels = 20 * Math.log10(linear)
  const rounded = Math.round(decibels * 10) / 10
  const sign = rounded < 0 ? '−' : ''
  return `${sign}${Math.abs(rounded).toFixed(1)} dB`
}
