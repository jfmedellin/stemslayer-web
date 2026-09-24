/**
 * A from-scratch ZIP reader used only by tests, deliberately independent of
 * `src/domain/zip/zip-writer.ts`'s own layout constants and its own
 * `crc32` — it re-derives every offset itself from the PKZIP APPNOTE
 * (https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT). A
 * "decode with the writer's own inverse" test would still pass if both
 * sides shared the same bug (e.g. an off-by-one in a header field); this
 * reader only accepts `writeZip`'s output if it is actually spec-valid.
 * Shared by `tests/domain/zip-writer.test.ts` (the codec's own unit tests)
 * and `src/ui/export/ExportPage.browser.test.tsx` (verifying the real
 * "Download ZIP" button's Blob byte-for-byte against the stem store).
 */

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const STORED_METHOD = 0

export interface ReadZipEntry {
  readonly fileName: string
  readonly bytes: Uint8Array
  readonly crc: number
}

/** A from-scratch CRC-32 (IEEE 802.3 / ISO-HDLC, reflected polynomial `0xEDB88320`). */
export function independentCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Parses a STORED-only ZIP archive, asserting STORED-method framing along the way. */
export function readZip(zip: Uint8Array): readonly ReadZipEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)

  let eocdOffset = -1
  for (let index = zip.length - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === EOCD_SIGNATURE) {
      eocdOffset = index
      break
    }
  }
  if (eocdOffset === -1) throw new Error('EOCD not found')

  const totalEntries = view.getUint16(eocdOffset + 10, true)
  const centralDirOffset = view.getUint32(eocdOffset + 16, true)

  const entries: ReadZipEntry[] = []
  let cursor = centralDirOffset
  for (let index = 0; index < totalEntries; index += 1) {
    if (view.getUint32(cursor, true) !== CENTRAL_FILE_HEADER_SIGNATURE) {
      throw new Error(`bad central directory header at ${cursor}`)
    }
    const compressionMethod = view.getUint16(cursor + 10, true)
    if (compressionMethod !== STORED_METHOD) {
      throw new Error(`unexpected compression method ${compressionMethod} (STORED-only reader)`)
    }
    const crc = view.getUint32(cursor + 16, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const uncompressedSize = view.getUint32(cursor + 24, true)
    if (compressedSize !== uncompressedSize) {
      throw new Error('compressed size must equal uncompressed size for a STORED entry')
    }
    const fileNameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localHeaderOffset = view.getUint32(cursor + 42, true)
    const fileName = new TextDecoder().decode(zip.slice(cursor + 46, cursor + 46 + fileNameLength))

    // Independently parse the local file header too, rather than trusting
    // the central directory's offset field alone, to locate the real data.
    if (view.getUint32(localHeaderOffset, true) !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw new Error(`bad local file header at ${localHeaderOffset}`)
    }
    const localFileNameLength = view.getUint16(localHeaderOffset + 26, true)
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true)
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength
    const bytes = zip.slice(dataStart, dataStart + uncompressedSize)

    entries.push({ fileName, bytes, crc })
    cursor += 46 + fileNameLength + extraLength + commentLength
  }

  return entries
}
