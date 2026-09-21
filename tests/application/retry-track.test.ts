import { describe, expect, test } from 'vitest'

import { retryTrack, type RetryTrackDeps } from '../../src/application/retry-track'
import { createTrack, transitionTrack, updateTrackMetadata, type Track, type TrackInput, type TrackStatus } from '../../src/domain/track'
import { InMemoryCatalog } from '../fakes/in-memory-catalog'

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
  if (status === 'failed' || status === 'interrupted' || status === 'unavailable') {
    track = updateTrackMetadata(track, { errorDetail: 'job.failed Retry from the original audio.' })
  }
  return track
}

function makeDeps(): RetryTrackDeps & { catalog: InMemoryCatalog } {
  return { catalog: new InMemoryCatalog() }
}

describe('retryTrack', () => {
  test('returns false for an unknown track', async () => {
    const deps = makeDeps()

    await expect(retryTrack('missing', deps)).resolves.toEqual({ ok: false })
  })

  test.each(['failed', 'interrupted', 'unavailable'] as const)(
    'moves a %s track back to preparing and clears errorDetail',
    async (status) => {
      const deps = makeDeps()
      const track = trackAt(status)
      await deps.catalog.insert(track)

      const result = await retryTrack(track.trackId, deps)

      expect(result).toEqual({
        ok: true,
        track: { ...track, status: 'preparing', errorDetail: null },
      })
      await expect(deps.catalog.getById(track.trackId)).resolves.toEqual(result.ok ? result.track : undefined)
    },
  )

  test.each(['preparing', 'processing', 'ready'] as const)('refuses to retry while %s', async (status) => {
    const deps = makeDeps()
    const track = trackAt(status)
    await deps.catalog.insert(track)

    await expect(retryTrack(track.trackId, deps)).resolves.toEqual({ ok: false })
    await expect(deps.catalog.getById(track.trackId)).resolves.toEqual(track)
  })
})
