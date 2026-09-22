import {
  CANCEL_CONFIRM_BODY,
  CANCEL_CONFIRM_CANCEL,
  CANCEL_CONFIRM_KEEP,
  CANCEL_CONFIRM_TITLE,
} from './library-copy'

export interface CancelConfirmDialogProps {
  readonly onKeepRunning: () => void
  readonly onCancelJob: () => void
}

/** Confirms a Library row's "Cancel", exact copy from the fetched Stitch screen. */
export function CancelConfirmDialog({ onKeepRunning, onCancelJob }: CancelConfirmDialogProps) {
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog cancel-confirm-dialog"
        role="alertdialog"
        aria-labelledby="cancel-confirm-title"
        aria-describedby="cancel-confirm-body"
      >
        <h2 id="cancel-confirm-title">{CANCEL_CONFIRM_TITLE}</h2>
        <p id="cancel-confirm-body">{CANCEL_CONFIRM_BODY}</p>
        <div className="dialog-actions">
          <button type="button" className="dialog-secondary" onClick={onKeepRunning}>
            {CANCEL_CONFIRM_KEEP}
          </button>
          <button type="button" className="dialog-primary" onClick={onCancelJob}>
            {CANCEL_CONFIRM_CANCEL}
          </button>
        </div>
      </div>
    </div>
  )
}
