/**
 * Minimal ZIP writer, STORED (uncompressed) entries only, matching
 * `domain/audio/float32-wav.ts`'s precedent: a pure, from-scratch,
 * exactly-documented binary codec with no browser API and no dependency.
 * Produces the exact byte layout the PKZIP APPNOTE
 * (https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT) defines for
 * a STORED-only archive: one local file header + raw data per entry
 * (section 4.3.7), the central directory (section 4.3.12), and the end of
 * central directory record (section 4.3.16). No compression is used — the
 * stems this packages are already float32 PCM WAV, already high-entropy and
 * gaining nothing from DEFLATE (`phase-2-plan.md`'s own "client-side zip,
 * store-only").
 */

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50

const LOCAL_FILE_HEADER_SIZE = 30
const CENTRAL_FILE_HEADER_SIZE = 46
const END_OF_CENTRAL_DIRECTORY_SIZE = 22

// Version 2.0 (encoded as 20): the minimum "version needed to extract" that
// covers a STORED entry described through the standard (non-Zip64) central
// directory record — no APPNOTE feature above that baseline is used here.
const ZIP_SPEC_VERSION = 20
const COMPRESSION_METHOD_STORED = 0
// Bit 11 (0x0800): file names/comments below are UTF-8
// (APPNOTE section 4.4.4, "Language encoding flag (EFS)") — the exported
// file names embed the track title, which is not guaranteed to be ASCII.
const GENERAL_PURPOSE_FLAG_UTF8 = 0x0800
// A fixed constant DOS date/time (1980-01-01 00:00:00, the DOS epoch) —
// there is nothing meaningful to encode here (no per-entry modification
// time exists for a stem that was never written to a real filesystem path).
const FIXED_DOS_TIME = 0
const FIXED_DOS_DATE = 0x0021

const CRC32_POLYNOMIAL = 0xedb88320

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? (value >>> 1) ^ CRC32_POLYNOMIAL : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
}

const CRC32_TABLE = buildCrc32Table()

/**
 * Standard CRC-32 (IEEE 802.3 / ISO-HDLC polynomial, reflected
 * `0xEDB88320`) — the same checksum every ZIP reader expects for each
 * entry's local and central-directory records (APPNOTE section 4.4.7).
 * Small 256-entry lookup-table implementation.
 */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export interface ZipEntryInput {
  readonly fileName: string
  readonly bytes: Uint8Array
}

interface PlacedEntry {
  readonly fileNameBytes: Uint8Array
  readonly crc: number
  readonly size: number
  readonly localHeaderOffset: number
}

function encodeLocalFileHeader(fileNameBytes: Uint8Array, crc: number, size: number): Uint8Array {
  const header = new Uint8Array(LOCAL_FILE_HEADER_SIZE + fileNameBytes.length)
  const view = new DataView(header.buffer)
  view.setUint32(0, LOCAL_FILE_HEADER_SIGNATURE, true)
  view.setUint16(4, ZIP_SPEC_VERSION, true)
  view.setUint16(6, GENERAL_PURPOSE_FLAG_UTF8, true)
  view.setUint16(8, COMPRESSION_METHOD_STORED, true)
  view.setUint16(10, FIXED_DOS_TIME, true)
  view.setUint16(12, FIXED_DOS_DATE, true)
  view.setUint32(14, crc, true)
  view.setUint32(18, size, true) // compressed size == uncompressed size (STORED)
  view.setUint32(22, size, true)
  view.setUint16(26, fileNameBytes.length, true)
  view.setUint16(28, 0, true) // extra field length
  header.set(fileNameBytes, LOCAL_FILE_HEADER_SIZE)
  return header
}

function encodeCentralFileHeader(entry: PlacedEntry): Uint8Array {
  const record = new Uint8Array(CENTRAL_FILE_HEADER_SIZE + entry.fileNameBytes.length)
  const view = new DataView(record.buffer)
  view.setUint32(0, CENTRAL_FILE_HEADER_SIGNATURE, true)
  view.setUint16(4, ZIP_SPEC_VERSION, true) // version made by (upper byte 0 = MS-DOS/FAT host)
  view.setUint16(6, ZIP_SPEC_VERSION, true) // version needed to extract
  view.setUint16(8, GENERAL_PURPOSE_FLAG_UTF8, true)
  view.setUint16(10, COMPRESSION_METHOD_STORED, true)
  view.setUint16(12, FIXED_DOS_TIME, true)
  view.setUint16(14, FIXED_DOS_DATE, true)
  view.setUint32(16, entry.crc, true)
  view.setUint32(20, entry.size, true)
  view.setUint32(24, entry.size, true)
  view.setUint16(28, entry.fileNameBytes.length, true)
  view.setUint16(30, 0, true) // extra field length
  view.setUint16(32, 0, true) // file comment length
  view.setUint16(34, 0, true) // disk number start
  view.setUint16(36, 0, true) // internal file attributes
  view.setUint32(38, 0, true) // external file attributes
  view.setUint32(42, entry.localHeaderOffset, true)
  record.set(entry.fileNameBytes, CENTRAL_FILE_HEADER_SIZE)
  return record
}

function encodeEndOfCentralDirectory(
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
): Uint8Array {
  const eocd = new Uint8Array(END_OF_CENTRAL_DIRECTORY_SIZE)
  const view = new DataView(eocd.buffer)
  view.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true)
  view.setUint16(4, 0, true) // number of this disk
  view.setUint16(6, 0, true) // disk with the start of the central directory
  view.setUint16(8, entryCount, true) // entries on this disk
  view.setUint16(10, entryCount, true) // total entries
  view.setUint32(12, centralDirectorySize, true)
  view.setUint32(16, centralDirectoryOffset, true)
  view.setUint16(20, 0, true) // .ZIP file comment length
  return eocd
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

/**
 * Builds a minimal STORED-only ZIP archive from in-memory entries. Pure
 * function, no browser API dependency. Entry order in the output matches
 * input order; duplicate file names are written as-is (the caller's
 * responsibility to dedupe — `export-track.ts` never produces duplicates
 * within one track's lane set).
 */
export function writeZip(entries: readonly ZipEntryInput[]): Uint8Array {
  const chunks: Uint8Array[] = []
  const placed: PlacedEntry[] = []
  let offset = 0

  for (const entry of entries) {
    const fileNameBytes = new TextEncoder().encode(entry.fileName)
    const crc = crc32(entry.bytes)
    const size = entry.bytes.length

    const header = encodeLocalFileHeader(fileNameBytes, crc, size)
    chunks.push(header, entry.bytes)
    placed.push({ fileNameBytes, crc, size, localHeaderOffset: offset })
    offset += header.length + entry.bytes.length
  }

  const centralDirectoryOffset = offset
  for (const entry of placed) {
    const record = encodeCentralFileHeader(entry)
    chunks.push(record)
    offset += record.length
  }
  const centralDirectorySize = offset - centralDirectoryOffset

  chunks.push(encodeEndOfCentralDirectory(placed.length, centralDirectorySize, centralDirectoryOffset))

  return concat(chunks)
}
