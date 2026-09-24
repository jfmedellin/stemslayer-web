import { formatBytes } from '../format/format-bytes'
import { formatDuration } from '../format/format-duration'
import type { AudioFileMetadata } from './read-audio-file-metadata'

export interface FileCardProps {
  readonly metadata: AudioFileMetadata
  readonly onChangeFile: () => void
}

/** Shows the loaded file's name/format/bit-depth/duration/size, plus a "Change file" action. */
export function FileCard({ metadata, onChangeFile }: FileCardProps) {
  const details = [
    metadata.format,
    metadata.bitDepth !== null ? `${metadata.bitDepth}-bit` : null,
    metadata.durationSeconds !== null ? formatDuration(metadata.durationSeconds) : null,
    formatBytes(metadata.sizeBytes),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')

  return (
    <div className="file-card">
      <div>
        <p className="file-card-name">{metadata.fileName}</p>
        <p className="file-card-details">{details}</p>
      </div>
      <button type="button" className="file-card-change" onClick={onChangeFile}>
        Change file
      </button>
    </div>
  )
}
