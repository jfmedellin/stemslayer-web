import type { Track } from '../../domain/track'
import { formatDuration } from '../format/format-duration'

export interface ExportTrackHeaderProps {
  readonly track: Track
  readonly profileDisplayName: string
  readonly stemCount: number
}

/** Export heading with a separate line for the real track/profile metadata. */
export function ExportTrackHeader({ track, profileDisplayName, stemCount }: ExportTrackHeaderProps) {
  return (
    <header className="export-track-header">
      <h1 id="export-page-title" className="export-track-title">Export stems</h1>
      <p className="export-track-meta">
        {track.title} · {track.artist} · {formatDuration(track.durationSeconds)} · {profileDisplayName.toUpperCase()} · {stemCount} STEMS
      </p>
    </header>
  )
}
