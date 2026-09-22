import { expect, test } from 'vitest'
import { BASIC_PROFILE, ROCK_PROFILE } from '../../src/domain/stem-profile'
import { detectEngineProvider } from '../../src/ui/upload/detect-engine-provider'
import { estimateSeparationSeconds } from '../../src/ui/upload/estimate-seconds'
import { parseAudioFileFormat } from '../../src/ui/upload/parse-audio-file-format'
import { parseWavBitDepth } from '../../src/ui/upload/parse-wav-bit-depth'
import { primaryActionLabel } from '../../src/ui/upload/primary-action-label'
import { readAudioFileMetadata } from '../../src/ui/upload/read-audio-file-metadata'

test('estimateSeparationSeconds scales the spike-s2 4-minute baseline by actual duration', () => {
  // spike-s2.md: ~25s Rock / ~36s Basic for a 4:00 (240s) song.
  expect(estimateSeparationSeconds(ROCK_PROFILE.profileId, 240)).toBeCloseTo(25, 5)
  expect(estimateSeparationSeconds(BASIC_PROFILE.profileId, 240)).toBeCloseTo(36, 5)
  expect(estimateSeparationSeconds(ROCK_PROFILE.profileId, 120)).toBeCloseTo(12.5, 5)
  expect(estimateSeparationSeconds('unknown-profile', 240)).toBe(0)
})

test('primaryActionLabel formats "Separate · {Profile} · {N} stems"', () => {
  expect(primaryActionLabel(ROCK_PROFILE)).toBe('Separate · Rock · 6 stems')
  expect(primaryActionLabel(BASIC_PROFILE)).toBe('Separate · Basic · 4 stems')
})

test('detectEngineProvider mirrors OnnxSessionManager\'s navigator.gpu presence check', () => {
  expect(detectEngineProvider({ gpu: undefined })).toBe('wasm')
  expect(detectEngineProvider({ gpu: {} })).toBe('webgpu')
})

test('parseAudioFileFormat reads the accepted extensions and falls back to UNKNOWN', () => {
  expect(parseAudioFileFormat('song.wav')).toBe('WAV')
  expect(parseAudioFileFormat('Song.MP3')).toBe('MP3')
  expect(parseAudioFileFormat('track.flac')).toBe('FLAC')
  expect(parseAudioFileFormat('track.ogg')).toBe('OGG')
  expect(parseAudioFileFormat('track.m4a')).toBe('M4A')
  expect(parseAudioFileFormat('track.aiff')).toBe('UNKNOWN')
  expect(parseAudioFileFormat('no-extension')).toBe('UNKNOWN')
})

function buildMinimalWavHeader(bitsPerSample: number): Uint8Array {
  const bytes = new Uint8Array(44)
  const view = new DataView(bytes.buffer)
  bytes.set([0x52, 0x49, 0x46, 0x46], 0) // "RIFF"
  view.setUint32(4, 36, true)
  bytes.set([0x57, 0x41, 0x56, 0x45], 8) // "WAVE"
  bytes.set([0x66, 0x6d, 0x74, 0x20], 12) // "fmt "
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 2, true) // channels
  view.setUint32(24, 44_100, true) // sample rate
  view.setUint32(28, 44_100 * 2 * (bitsPerSample / 8), true) // byte rate
  view.setUint16(32, 2 * (bitsPerSample / 8), true) // block align
  view.setUint16(34, bitsPerSample, true)
  bytes.set([0x64, 0x61, 0x74, 0x61], 36) // "data"
  view.setUint32(40, 0, true)
  return bytes
}

test('parseWavBitDepth reads bitsPerSample from the fmt chunk, null for non-WAV bytes', () => {
  expect(parseWavBitDepth(buildMinimalWavHeader(16))).toBe(16)
  expect(parseWavBitDepth(buildMinimalWavHeader(24))).toBe(24)
  expect(parseWavBitDepth(new TextEncoder().encode('not a wav file at all'))).toBeNull()
})

test('readAudioFileMetadata combines format/bit-depth/size with an injected duration decoder', async () => {
  const wavBytes = buildMinimalWavHeader(16)
  const metadata = await readAudioFileMetadata('song.wav', wavBytes, async () => 4.5)
  expect(metadata).toEqual({
    fileName: 'song.wav',
    format: 'WAV',
    bitDepth: 16,
    durationSeconds: 4.5,
    sizeBytes: wavBytes.byteLength,
  })
})

test('readAudioFileMetadata reports a null duration when decoding fails, without throwing', async () => {
  const metadata = await readAudioFileMetadata('song.mp3', new Uint8Array([1, 2, 3]), async () => {
    throw new Error('decode failed')
  })
  expect(metadata.durationSeconds).toBeNull()
  expect(metadata.bitDepth).toBeNull()
  expect(metadata.format).toBe('MP3')
})
