import {
  REMOVE_CONFIRM_BODY,
  REMOVE_CONFIRM_KEEP,
  REMOVE_CONFIRM_REMOVE,
  REMOVE_CONFIRM_TITLE,
} from './library-copy'

export interface RemoveConfirmDialogProps {
  readonly onKeepTrack: () => void
  readonly onRemoveTrack: () => void
}

/** Destructive-action confirm for a Library row's "Remove", following the cancel dialog's pattern. */
export function RemoveConfirmDialog({ onKeepTrack, onRemoveTrack }: RemoveConfirmDialogProps) {
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog remove-confirm-dialog"
        role="alertdialog"
        aria-labelledby="remove-confirm-title"
        aria-describedby="remove-confirm-body"
      >
        <h2 id="remove-confirm-title">{REMOVE_CONFIRM_TITLE}</h2>
        <p id="remove-confirm-body">{REMOVE_CONFIRM_BODY}</p>
        <div className="dialog-actions">
          <button type="button" className="dialog-secondary" onClick={onKeepTrack}>
            {REMOVE_CONFIRM_KEEP}
          </button>
          <button type="button" className="dialog-primary" onClick={onRemoveTrack}>
            {REMOVE_CONFIRM_REMOVE}
          </button>
        </div>
      </div>
    </div>
  )
}
