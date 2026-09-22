export type AudioFileFormat = 'WAV' | 'MP3' | 'FLAC' | 'OGG' | 'M4A' | 'UNKNOWN'

const KNOWN_EXTENSIONS: ReadonlySet<string> = new Set(['wav', 'mp3', 'flac', 'ogg', 'm4a'])

/** Reads the format off the file name's extension (the accepted formats listed on the drop zone). */
export function parseAudioFileFormat(fileName: string): AudioFileFormat {
  const match = /\.([a-z0-9]+)$/i.exec(fileName)
  const extension = match?.[1]?.toLowerCase()
  if (extension !== undefined && KNOWN_EXTENSIONS.has(extension)) {
    return extension.toUpperCase() as AudioFileFormat
  }
  return 'UNKNOWN'
}
