/**
 * Reads `bitsPerSample` from a WAV file's `fmt ` chunk. Returns `null` for
 * anything that isn't a well-formed RIFF/WAVE container (including every
 * compressed format, which has no fixed PCM bit depth to report).
 */
export function parseWavBitDepth(bytes: Uint8Array): number | null {
  if (bytes.length < 12) return null

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const riff = readAscii(bytes, 0, 4)
  const wave = readAscii(bytes, 8, 4)
  if (riff !== 'RIFF' || wave !== 'WAVE') return null

  let offset = 12
  while (offset + 8 <= bytes.length) {
    const chunkId = readAscii(bytes, offset, 4)
    const chunkSize = view.getUint32(offset + 4, true)
    if (chunkId === 'fmt ') {
      if (offset + 8 + 16 > bytes.length) return null
      return view.getUint16(offset + 8 + 14, true)
    }
    offset += 8 + chunkSize + (chunkSize % 2)
  }
  return null
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let result = ''
  for (let i = 0; i < length; i += 1) result += String.fromCharCode(bytes[offset + i] ?? 0)
  return result
}
