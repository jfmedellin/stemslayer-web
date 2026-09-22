import type { Track } from '../../domain/track'
import { formatDuration } from '../format/format-duration'

export interface ExportTrackHeaderProps {
  readonly track: Track
  readonly profileDisplayName: string
  readonly stemCount: number
  readonly onBackToMixer: () => void
}

/**
 * Export track header: matches the fetched Stitch screen's exact format
 * `"{title} · {artist} · {duration} · {PROFILE} · {N} STEMS"`, plus "Back
 * to mixer" navigation (mirroring `TrackHeader.tsx`'s "Back to library").
 */
export function ExportTrackHeader({ track, profileDisplayName, stemCount, onBackToMixer }: ExportTrackHeaderProps) {
  return (
    <header className="export-track-header">
      <button type="button" className="export-back-to-mixer" onClick={onBackToMixer}>
        ← Back to mixer
      </button>

      <h1 id="export-page-title" className="export-track-title">
        {track.title} · {track.artist} · {formatDuration(track.durationSeconds)} · {profileDisplayName.toUpperCase()} · {stemCount} STEMS
      </h1>
    </header>
  )
}
