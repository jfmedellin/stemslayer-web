import type { Track } from '../../domain/track'
import { formatDuration } from '../format/format-duration'
import { formatRelativeTime } from '../format/format-relative-time'

export interface TrackHeaderProps {
  readonly track: Track
  readonly profileDisplayName: string
  readonly laneCount: number
  readonly onBackToLibrary: () => void
  readonly onExport: () => void
}

/**
 * Mixer track header: title/artist/duration/profile/lane-count/"separated …
 * ago" (from `track.createdAtUtc`, the only timestamp `Track` carries),
 * "Back to library", and "Export stems" (navigates to the Export
 * destination only — Export itself is P10, out of scope here).
 */
export function TrackHeader({ track, profileDisplayName, laneCount, onBackToLibrary, onExport }: TrackHeaderProps) {
  return (
    <header className="mixer-track-header">
      <button type="button" className="mixer-back-to-library" onClick={onBackToLibrary}>
        ← Back to library
      </button>

      <div className="mixer-track-header-info">
        <h1 id="mixer-page-title" className="mixer-track-title">{track.title}</h1>
        <p className="mixer-track-artist">{track.artist}</p>
        <p className="mixer-track-meta">
          {formatDuration(track.durationSeconds)} · {profileDisplayName} · {laneCount} lanes
          {' · '}separated {formatRelativeTime(track.createdAtUtc)}
        </p>
      </div>

      <button type="button" className="mixer-export-stems" onClick={onExport}>
        Export stems
      </button>
    </header>
  )
}
