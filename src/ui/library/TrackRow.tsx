import type { SeparateProgressEvent } from '../../application/separate'
import type { Track } from '../../domain/track'
import { RetryReuploadPrompt } from './RetryReuploadPrompt'
import {
  FAILED_FALLBACK_DETAIL,
  INTERRUPTED_DETAIL,
  UNAVAILABLE_DETAIL,
  preparingLabel,
  processingLabel,
} from './track-row-copy'

export interface TrackRowProps {
  readonly track: Track
  readonly progress: SeparateProgressEvent | undefined
  readonly errorMessage: string | null
  readonly showRetryPrompt: boolean
  readonly onCancelRequested: () => void
  readonly onRemoveRequested: () => void
  readonly onRetryRequested: () => void
  readonly onRetryFileChosen: (file: File) => void
  readonly onRetryCancelled: () => void
  readonly onOpenInMixer: (trackId: string) => void
}

function statusLabel(track: Track, progress: SeparateProgressEvent | undefined): string {
  switch (track.status) {
    case 'ready':
      return 'Ready'
    case 'preparing':
      return preparingLabel(progress?.phase === 'preparing' ? progress : undefined)
    case 'processing':
      return processingLabel(progress?.phase === 'processing' ? progress : undefined)
    case 'failed':
      return track.errorDetail ?? FAILED_FALLBACK_DETAIL
    case 'interrupted':
      return INTERRUPTED_DETAIL
    case 'unavailable':
      return UNAVAILABLE_DETAIL
  }
}

/** One Library row: copy and actions matching the fetched Stitch screen exactly, per status. */
export function TrackRow({
  track,
  progress,
  errorMessage,
  showRetryPrompt,
  onCancelRequested,
  onRemoveRequested,
  onRetryRequested,
  onRetryFileChosen,
  onRetryCancelled,
  onOpenInMixer,
}: TrackRowProps) {
  const retryable = track.status === 'failed' || track.status === 'interrupted' || track.status === 'unavailable'
  const cancellable = track.status === 'preparing' || track.status === 'processing'

  return (
    <li className="track-row" data-status={track.status} data-track-id={track.trackId}>
      <div className="track-row-info">
        <p className="track-row-title">{track.title}</p>
        <p className="track-row-artist">{track.artist}</p>
      </div>

      <p className="track-row-status">{statusLabel(track, progress)}</p>

      <div className="track-row-actions">
        {track.status === 'ready' && (
          <button type="button" className="track-row-open-mixer" onClick={() => onOpenInMixer(track.trackId)}>
            Open in mixer
          </button>
        )}
        {cancellable && (
          <button type="button" className="track-row-cancel" onClick={onCancelRequested}>
            Cancel
          </button>
        )}
        {retryable && (
          <>
            <button type="button" className="track-row-retry" onClick={onRetryRequested}>
              Retry
            </button>
            <button type="button" className="track-row-remove" onClick={onRemoveRequested}>
              Remove
            </button>
          </>
        )}
      </div>

      {errorMessage !== null && (
        <p className="track-row-error" role="alert">{errorMessage}</p>
      )}

      {showRetryPrompt && (
        <RetryReuploadPrompt onFileChosen={onRetryFileChosen} onCancel={onRetryCancelled} />
      )}
    </li>
  )
}
