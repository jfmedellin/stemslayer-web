import { expect, test } from 'vitest'
import type { Track } from '../../src/domain/track'
import { filterTracksBySearch, sortTracks } from '../../src/ui/library/filter-sort-tracks'
import {
  FAILED_FALLBACK_DETAIL,
  INTERRUPTED_DETAIL,
  PREPARING_FALLBACK_DETAIL,
  UNAVAILABLE_DETAIL,
  preparingLabel,
  processingLabel,
} from '../../src/ui/library/track-row-copy'
import { removeRefusalMessage } from '../../src/ui/library/remove-refusal-copy'

function buildTrack(overrides: Partial<Track> = {}): Track {
  return {
    trackId: overrides.trackId ?? 'track-1',
    title: overrides.title ?? 'Song',
    artist: overrides.artist ?? 'Artist',
    genre: overrides.genre ?? null,
    durationSeconds: overrides.durationSeconds ?? 100,
    bpm: overrides.bpm ?? null,
    musicalKey: overrides.musicalKey ?? null,
    createdAtUtc: overrides.createdAtUtc ?? '2026-01-01T00:00:00.000Z',
    profileId: overrides.profileId ?? 'metal-stereo-six-stem',
    pipelineFingerprint: overrides.pipelineFingerprint ?? 'fingerprint',
    resultKey: overrides.resultKey ?? 'stems/track-1',
    sourceHash: overrides.sourceHash,
    status: overrides.status ?? 'ready',
    errorDetail: overrides.errorDetail ?? null,
  }
}

test('filterTracksBySearch matches title or artist, case-insensitive, trimmed', () => {
  const tracks = [
    buildTrack({ trackId: 'a', title: 'Komorebi Master Mix', artist: 'Yui' }),
    buildTrack({ trackId: 'b', title: 'Second Song', artist: 'Ren' }),
  ]
  expect(filterTracksBySearch(tracks, '')).toEqual(tracks)
  expect(filterTracksBySearch(tracks, '  komorebi ').map((t) => t.trackId)).toEqual(['a'])
  expect(filterTracksBySearch(tracks, 'REN').map((t) => t.trackId)).toEqual(['b'])
  expect(filterTracksBySearch(tracks, 'no-match')).toEqual([])
})

test('sortTracks orders by newest createdAtUtc descending', () => {
  const tracks = [
    buildTrack({ trackId: 'old', createdAtUtc: '2026-01-01T00:00:00.000Z' }),
    buildTrack({ trackId: 'new', createdAtUtc: '2026-06-01T00:00:00.000Z' }),
  ]
  expect(sortTracks(tracks, 'newest').map((t) => t.trackId)).toEqual(['new', 'old'])
})

test('sortTracks orders by title, case-insensitive ascending', () => {
  const tracks = [
    buildTrack({ trackId: 'b', title: 'banana' }),
    buildTrack({ trackId: 'a', title: 'Apple' }),
  ]
  expect(sortTracks(tracks, 'title').map((t) => t.trackId)).toEqual(['a', 'b'])
})

test('sortTracks orders by duration ascending', () => {
  const tracks = [
    buildTrack({ trackId: 'long', durationSeconds: 300 }),
    buildTrack({ trackId: 'short', durationSeconds: 30 }),
  ]
  expect(sortTracks(tracks, 'duration').map((t) => t.trackId)).toEqual(['short', 'long'])
})

test('sortTracks never mutates the input array', () => {
  const tracks = [buildTrack({ trackId: 'a' }), buildTrack({ trackId: 'b' })]
  const original = [...tracks]
  sortTracks(tracks, 'title')
  expect(tracks).toEqual(original)
})

test('processingLabel formats "Separating · window N of M · P%"', () => {
  expect(processingLabel({ phase: 'processing', window: 1, totalWindows: 4 })).toBe(
    'Separating · window 1 of 4 · 25%',
  )
  expect(processingLabel(undefined)).toBe('Separating…')
})

test('preparingLabel passes through the already-formatted detail string, with a fallback', () => {
  expect(preparingLabel({ phase: 'preparing', detail: 'Preparing Rock: 42%' })).toBe('Preparing Rock: 42%')
  expect(preparingLabel(undefined)).toBe(PREPARING_FALLBACK_DETAIL)
})

test('exposes the fixed interrupted/unavailable/failed-fallback copy from the fetched Stitch screen', () => {
  expect(INTERRUPTED_DETAIL).toBe('Cancelled before it finished.')
  expect(UNAVAILABLE_DETAIL).toBe('Stems were removed by the browser. Separate again from the original file.')
  expect(FAILED_FALLBACK_DETAIL).toBe('Separation failed.')
})

test('removeRefusalMessage covers all three of removeTrack\'s refusal reasons', () => {
  expect(removeRefusalMessage('not-found')).toMatch(/no longer exists/i)
  expect(removeRefusalMessage('in-progress')).toMatch(/running/i)
  expect(removeRefusalMessage('unavailable')).toMatch(/could not remove/i)
})
