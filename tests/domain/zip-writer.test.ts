import { describe, expect, test } from 'vitest'

import { crc32, writeZip, writeZipStream } from '../../src/domain/zip/zip-writer'
import { independentCrc32, readZip } from '../support/independent-zip-reader'

describe('crc32', () => {
  test('matches the standard IEEE 802.3 check value for the ASCII test vector "123456789"', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  test('the empty input has CRC 0', () => {
    expect(crc32(new Uint8Array(0))).toBe(0)
  })
})

describe('writeZip', () => {
  test('produces a spec-valid STORED archive an independent reader can open, with byte-identical content and matching CRC-32', () => {
    const inputs = [
      { fileName: 'song-vocals.wav', bytes: Uint8Array.from({ length: 37 }, (_unused, index) => index % 256) },
      { fileName: 'song-drums.wav', bytes: new Uint8Array([0, 0, 0, 0]) },
      { fileName: 'unicode-é-ñ.wav', bytes: Uint8Array.from([1, 2, 3, 255, 254]) },
    ]

    const zip = writeZip(inputs)
    const read = readZip(zip)

    expect(read).toHaveLength(inputs.length)
    read.forEach((entry, index) => {
      expect(entry.fileName).toBe(inputs[index].fileName)
      expect(Array.from(entry.bytes)).toEqual(Array.from(inputs[index].bytes))
      expect(entry.crc).toBe(independentCrc32(inputs[index].bytes))
    })
  })

  test('an empty entry list still produces a valid (empty) archive', () => {
    const zip = writeZip([])
    const read = readZip(zip)
    expect(read).toHaveLength(0)
  })

  test('a zero-byte entry round trips with CRC 0 and an empty data span', () => {
    const zip = writeZip([{ fileName: 'silence.wav', bytes: new Uint8Array(0) }])
    const read = readZip(zip)

    expect(read).toHaveLength(1)
    expect(read[0].bytes).toHaveLength(0)
    expect(read[0].crc).toBe(0)
  })
})

describe('writeZipStream', () => {
  test('writes valid byte-identical entries incrementally without retaining the archive', async () => {
    const first = Uint8Array.from({ length: 100_003 }, (_unused, index) => index % 251)
    const second = Uint8Array.from({ length: 70_019 }, (_unused, index) => (index * 7) % 253)
    const chunks: Uint8Array[] = []
    let largestWrite = 0
    const source = (bytes: Uint8Array): (() => ReadableStream<Uint8Array>) => () => new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 4096) {
          controller.enqueue(bytes.subarray(offset, Math.min(bytes.length, offset + 4096)))
        }
        controller.close()
      },
    })

    await writeZipStream([
      { fileName: 'first.wav', size: first.length, openStream: source(first) },
      { fileName: 'second-é.wav', size: second.length, openStream: source(second) },
    ], {
      write(chunk) {
        largestWrite = Math.max(largestWrite, chunk.length)
        chunks.push(chunk.slice())
      },
    })

    const archive = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
    let offset = 0
    for (const chunk of chunks) { archive.set(chunk, offset); offset += chunk.length }
    const entries = readZip(archive)
    expect(entries.map((entry) => entry.fileName)).toEqual(['first.wav', 'second-é.wav'])
    expect(entries[0].bytes).toEqual(first)
    expect(entries[1].bytes).toEqual(second)
    expect(largestWrite).toBeLessThanOrEqual(4096)
  })

  test('rejects ZIP32 entries above the representable size before reading their streams', async () => {
    let opened = false
    await expect(writeZipStream([{
      fileName: 'too-large.wav',
      size: 0x1_0000_0000,
      openStream: () => { opened = true; return new ReadableStream() },
    }], { write: () => undefined })).rejects.toThrow('zip-writer.size_limit')
    expect(opened).toBe(false)
  })
})
