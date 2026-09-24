import { describe, expect, test } from 'vitest'

import { removeTrack, type RemoveTrackDeps } from '../../src/application/remove-track'
import { createTrack, transitionTrack, type Track, type TrackInput, type TrackStatus } from '../../src/domain/track'
import { InMemoryCatalog } from '../fakes/in-memory-catalog'
import { InMemoryStemStore } from '../fakes/in-memory-stem-store'

const input: TrackInput = {
  trackId: 'track-1',
  title: 'Song',
  artist: 'Artist',
  genre: null,
  durationSeconds: 200,
  bpm: null,
  musicalKey: null,
  createdAtUtc: '2026-09-21T12:00:00.000Z',
  profileId: 'legacy-four-stem',
  pipelineFingerprint: 'pipeline-a',
  resultKey: 'stems/track-1',
}

const pathToStatus: Readonly<Record<TrackStatus, readonly TrackStatus[]>> = {
  preparing: [],
  processing: ['processing'],
  ready: ['processing', 'ready'],
  failed: ['failed'],
  interrupted: ['interrupted'],
  unavailable: ['unavailable'],
}

function trackAt(status: TrackStatus): Track {
  let track = createTrack(input)
  for (const next of pathToStatus[status]) track = transitionTrack(track, next)
  return track
}

function makeDeps(): RemoveTrackDeps & { catalog: InMemoryCatalog; stemStore: InMemoryStemStore } {
  return { catalog: new InMemoryCatalog(), stemStore: new InMemoryStemStore() }
}

describe('removeTrack', () => {
  test('returns not-found for an unknown track', async () => {
    const deps = makeDeps()

    await expect(removeTrack('missing', deps)).resolves.toEqual({ ok: false, reason: 'not-found' })
  })

  test.each(['preparing', 'processing'] as const)('refuses removal while %s', async (status) => {
    const deps = makeDeps()
    const track = trackAt(status)
    await deps.catalog.insert(track)
    deps.stemStore.seed(track.resultKey)

    await expect(removeTrack(track.trackId, deps)).resolves.toEqual({ ok: false, reason: 'in-progress' })
    await expect(deps.catalog.getById(track.trackId)).resolves.toEqual(track)
    expect(deps.stemStore.has(track.resultKey)).toBe(true)
  })

  test.each(['ready', 'failed', 'interrupted', 'unavailable'] as const)(
    'deletes the stem set then the catalog row while %s',
    async (status) => {
      const deps = makeDeps()
      const track = trackAt(status)
      await deps.catalog.insert(track)
      deps.stemStore.seed(track.resultKey)

      await expect(removeTrack(track.trackId, deps)).resolves.toEqual({ ok: true })

      expect(deps.stemStore.has(track.resultKey)).toBe(false)
      await expect(deps.catalog.getById(track.trackId)).resolves.toBeUndefined()
    },
  )

  test('a stem-store failure marks the track unavailable instead of deleting the row', async () => {
    const deps = makeDeps()
    const track = trackAt('ready')
    await deps.catalog.insert(track)
    deps.stemStore.seed(track.resultKey)
    deps.stemStore.failNextDeleteFor(track.resultKey)

    await expect(removeTrack(track.trackId, deps)).resolves.toEqual({ ok: false, reason: 'unavailable' })

    const stored = await deps.catalog.getById(track.trackId)
    expect(stored?.status).toBe('unavailable')
    expect(stored?.errorDetail).toBeTruthy()
    expect(deps.stemStore.has(track.resultKey)).toBe(true)
  })

  test('a repeated stem-store failure on an already-unavailable track keeps its status', async () => {
    const deps = makeDeps()
    const track = trackAt('unavailable')
    await deps.catalog.insert(track)
    deps.stemStore.seed(track.resultKey)
    deps.stemStore.failNextDeleteFor(track.resultKey)

    await expect(removeTrack(track.trackId, deps)).resolves.toEqual({ ok: false, reason: 'unavailable' })

    const stored = await deps.catalog.getById(track.trackId)
    expect(stored?.status).toBe('unavailable')
  })
})
