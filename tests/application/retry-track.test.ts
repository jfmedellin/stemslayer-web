import { describe, expect, test } from 'vitest'

import { addToLibrary, type AddToLibraryDeps } from '../../src/application/add-to-library'
import { createPipelineFingerprint } from '../../src/application/create-pipeline-fingerprint'
import { retryTrack, type RetryTrackDeps } from '../../src/application/retry-track'
import { BASIC_PROFILE } from '../../src/domain/stem-profile'
import {
  assignTrackSourceHash,
  createTrack,
  transitionTrack,
  updateTrackMetadata,
  type Track,
  type TrackInput,
  type TrackStatus,
} from '../../src/domain/track'
import { FakeHash } from '../fakes/fake-hash'
import { FakeLock } from '../fakes/fake-lock'
import { FakeQuota } from '../fakes/fake-quota'
import { InMemoryCatalog } from '../fakes/in-memory-catalog'
import { InMemoryModelStore } from '../fakes/in-memory-model-store'

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

function makeDeps(): RetryTrackDeps & { catalog: InMemoryCatalog; hash: FakeHash; lock: FakeLock } {
  return { catalog: new InMemoryCatalog(), hash: new FakeHash(), lock: new FakeLock() }
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

  describe('retrying with newly supplied bytes', () => {
    test('rebinds the source hash in place when the bytes changed', async () => {
      const deps = makeDeps()
      const track = assignTrackSourceHash(trackAt('failed'), 'old-source-hash')
      await deps.catalog.insert(track)
      const newBytes = new Uint8Array([3, 3, 3])
      const newHash = await deps.hash.sha256(newBytes)

      const result = await retryTrack(track.trackId, deps, { bytes: newBytes })

      expect(result).toEqual({
        ok: true,
        track: { ...track, status: 'preparing', errorDetail: null, sourceHash: newHash },
      })
      await expect(deps.catalog.getById(track.trackId)).resolves.toEqual(result.ok ? result.track : undefined)
    })

    test('unchanged bytes behave like a bytes-less retry', async () => {
      const deps = makeDeps()
      const sameBytes = new Uint8Array([4, 4, 4])
      const sameHash = await deps.hash.sha256(sameBytes)
      const track = assignTrackSourceHash(trackAt('interrupted'), sameHash)
      await deps.catalog.insert(track)

      const result = await retryTrack(track.trackId, deps, { bytes: sameBytes })

      expect(result).toEqual({
        ok: true,
        track: { ...track, status: 'preparing', errorDetail: null },
      })
      expect(deps.lock.acquisitionOrder).toEqual([])
    })

    test('refuses to rebind when another track already owns the new identity', async () => {
      const deps = makeDeps()
      const retrying = assignTrackSourceHash(trackAt('failed'), 'old-source-hash')
      await deps.catalog.insert(retrying)

      const ownerBytes = new Uint8Array([9, 9, 9])
      const ownerHash = await deps.hash.sha256(ownerBytes)
      const owner = transitionTrack(
        assignTrackSourceHash(createTrack({ ...input, trackId: 'owner-track', resultKey: 'stems/owner-track' }), ownerHash),
        'processing',
      )
      await deps.catalog.insert(owner)

      const result = await retryTrack(retrying.trackId, deps, { bytes: ownerBytes })

      expect(result).toEqual({ ok: false, reason: 'identity-owned', ownerTrackId: owner.trackId })
      await expect(deps.catalog.getById(retrying.trackId)).resolves.toEqual(retrying)
    })

    test('releases the old identity so re-adding the old bytes claims a fresh track', async () => {
      const hash = new FakeHash()
      const lock = new FakeLock()
      const catalog = new InMemoryCatalog()
      const pipelineFingerprint = await createPipelineFingerprint(BASIC_PROFILE, hash)
      const oldBytes = new Uint8Array([1, 1, 1])
      const newBytes = new Uint8Array([2, 2, 2])
      const oldHash = await hash.sha256(oldBytes)

      const original = transitionTrack(
        transitionTrack(
          assignTrackSourceHash(
            createTrack({ ...input, profileId: BASIC_PROFILE.profileId, pipelineFingerprint }),
            oldHash,
          ),
          'processing',
        ),
        'failed',
      )
      await catalog.insert(original)

      const retryDeps: RetryTrackDeps = { catalog, hash, lock }
      const retried = await retryTrack(original.trackId, retryDeps, { bytes: newBytes })
      expect(retried.ok).toBe(true)

      const addDeps: AddToLibraryDeps = {
        catalog,
        modelStore: new InMemoryModelStore(),
        quota: new FakeQuota(10_000_000_000),
        lock,
        hash,
        generateTrackId: () => 'track-fresh',
        now: () => '2026-09-21T13:00:00.000Z',
      }
      const result = await addToLibrary(
        { bytes: oldBytes, fileName: 'song.wav', profile: BASIC_PROFILE },
        addDeps,
      )

      expect(result.decision).toBe('claimed')
      if (result.decision !== 'claimed') return
      expect(result.track.trackId).not.toBe(original.trackId)
      expect(result.track.sourceHash).toBe(oldHash)
    })
  })
})
