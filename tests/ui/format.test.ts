import { expect, test } from 'vitest'
import { formatBytes } from '../../src/ui/format/format-bytes'
import { formatDuration } from '../../src/ui/format/format-duration'

test('formatBytes renders binary units with one decimal above kibibyte scale', () => {
  expect(formatBytes(0)).toBe('0 B')
  expect(formatBytes(512)).toBe('512 B')
  expect(formatBytes(1_536)).toBe('1.5 KiB')
  expect(formatBytes(174_266_088)).toBe('166.2 MiB')
  expect(formatBytes(2_150_000_000)).toBe('2.0 GiB')
})

test('formatDuration renders minutes:seconds, zero-padded', () => {
  expect(formatDuration(0)).toBe('0:00')
  expect(formatDuration(5)).toBe('0:05')
  expect(formatDuration(65)).toBe('1:05')
  expect(formatDuration(241.95)).toBe('4:02')
})
