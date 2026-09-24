import { formatBytes } from '../format/format-bytes'

export interface StemChecklistRowProps {
  readonly laneId: string
  readonly displayName: string
  readonly sizeBytes: number
  readonly sampleRateHz: number
  readonly checked: boolean
  readonly onToggle: () => void
}

/**
 * One stem checklist row: a checkbox plus `"{name}"` and
 * `"{size} · WAV 32-bit float · {sampleRate} kHz"`, matching the fetched
 * Stitch screen's exact per-row copy format (its own example:
 * `"101.7 MB · WAV 32-bit float · 44.1 kHz"`).
 */
export function StemChecklistRow({
  laneId,
  displayName,
  sizeBytes,
  sampleRateHz,
  checked,
  onToggle,
}: StemChecklistRowProps) {
  const sampleRateKhz = (sampleRateHz / 1000).toFixed(1)
  return (
    <li className="export-stem-row" data-lane-id={laneId}>
      <label>
        <input type="checkbox" className="export-stem-checkbox" checked={checked} onChange={onToggle} />
        <span className="export-stem-name">{displayName}</span>
        <span className="export-stem-spec">{formatBytes(sizeBytes)} · WAV 32-bit float · {sampleRateKhz} kHz</span>
      </label>
    </li>
  )
}
