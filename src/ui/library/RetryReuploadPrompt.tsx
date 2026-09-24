import { useRef } from 'react'

export interface RetryReuploadPromptProps {
  readonly onFileChosen: (file: File) => void
  readonly onCancel: () => void
}

const ACCEPTED_EXTENSIONS = '.wav,.mp3,.flac,.ogg,.m4a'

/**
 * The app never keeps a standing handle back to the original file
 * (`docs/decisions/browser-storage.md` section 7), so a `failed`/
 * `interrupted`/`unavailable` row's "Retry" must re-prompt for it before
 * `retryTrack` can be given real bytes to re-run inference on.
 */
export function RetryReuploadPrompt({ onFileChosen, onCancel }: RetryReuploadPromptProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  function handleChange(): void {
    const file = inputRef.current?.files?.[0]
    if (file !== undefined) onFileChosen(file)
    if (inputRef.current !== null) inputRef.current.value = ''
  }

  return (
    <div className="retry-reupload-prompt" role="group" aria-label="Choose the original file to retry">
      <p className="retry-reupload-instructions">Choose the original audio file to retry this track.</p>
      <input
        ref={inputRef}
        type="file"
        className="retry-reupload-input"
        accept={ACCEPTED_EXTENSIONS}
        onChange={handleChange}
      />
      <button type="button" className="retry-reupload-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}
