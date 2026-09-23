import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'

export interface DropZoneProps {
  readonly onFilesChosen: (files: readonly File[]) => void
}

const ACCEPTED_EXTENSIONS = '.wav,.mp3,.flac,.ogg,.m4a'

/** Single-file drop zone with a native `<input type="file">` browse fallback. */
export function DropZone({ onFilesChosen }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)

  function openBrowseDialog(): void {
    inputRef.current?.click()
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    setDragActive(false)
    const files = Array.from(event.dataTransfer.files)
    if (files.length > 0) onFilesChosen(files)
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    setDragActive(true)
  }

  function handleDragLeave(): void {
    setDragActive(false)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openBrowseDialog()
    }
  }

  function handleInputChange(): void {
    const files = Array.from(inputRef.current?.files ?? [])
    if (files.length > 0) onFilesChosen(files)
    if (inputRef.current !== null) inputRef.current.value = ''
  }

  return (
    <>
      <div
        className="drop-zone"
        data-active={dragActive}
        role="button"
        tabIndex={0}
        onClick={openBrowseDialog}
        onKeyDown={handleKeyDown}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <span className="drop-zone-icon" aria-hidden="true">↑</span>
        <p className="drop-zone-title">Drop one audio file or browse</p>
        <p className="drop-zone-constraints">
          WAV, MP3, FLAC, OGG, M4A · one file at a time · up to about 15 minutes
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        aria-hidden="true"
        tabIndex={-1}
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        onClick={(event) => event.stopPropagation()}
        onChange={handleInputChange}
      />
    </>
  )
}
