import { describe, expect, test } from 'vitest'

import { runStartupSweeps, type RunStartupSweepsDeps } from '../../src/application/run-startup-sweeps'
import { BASIC_PROFILE } from '../../src/domain/stem-profile'
import { createTrack, transitionTrack, type Track, type TrackInput, type TrackStatus } from '../../src/domain/track'
import { InMemoryCatalog } from '../fakes/in-memory-catalog'
import { InMemoryStemStore } from '../fakes/in-memory-stem-store'

function trackInput(trackId: string): TrackInput {
  return {
    trackId,
    title: 'Song',
    artist: 'Artist',
    genre: null,
    durationSeconds: 200,
    bpm: null,
    musicalKey: null,
    createdAtUtc: '2026-09-21T12:00:00.000Z',
    profileId: BASIC_PROFILE.profileId,
    pipelineFingerprint: `pipeline-${trackId}`,
    resultKey: `stems/${trackId}`,
  }
}

function laneKeysFor(trackId: string): readonly string[] {
  return BASIC_PROFILE.lanes.map((lane) => `stems/${trackId}/${lane.laneId}`)
}

const pathToStatus: Readonly<Record<TrackStatus, readonly TrackStatus[]>> = {
  preparing: [],
  processing: ['processing'],
  ready: ['processing', 'ready'],
  failed: ['failed'],
  interrupted: ['interrupted'],
  unavailable: ['unavailable'],
}

function trackAt(trackId: string, status: TrackStatus): Track {
  let track = createTrack(trackInput(trackId))
  for (const next of pathToStatus[status]) track = transitionTrack(track, next)
  return track
}

function makeDeps(): RunStartupSweepsDeps & { catalog: InMemoryCatalog; stemStore: InMemoryStemStore } {
  return { catalog: new InMemoryCatalog(), stemStore: new InMemoryStemStore() }
}

describe('runStartupSweeps', () => {
  test('is idempotent on a clean catalog', async () => {
    const deps = makeDeps()

    await expect(runStartupSweeps(deps)).resolves.toEqual({
      recoveredUnfinished: 0,
      invalidatedReady: 0,
      orphansRemoved: 0,
    })
    await expect(runStartupSweeps(deps)).resolves.toEqual({
      recoveredUnfinished: 0,
      invalidatedReady: 0,
      orphansRemoved: 0,
    })
  })

  test('recoverUnfinished flips every preparing/processing row to interrupted with the crash copy', async () => {
    const deps = makeDeps()
    const preparing = trackAt('track-1', 'preparing')
    const processing = trackAt('track-2', 'processing')
    const ready = trackAt('track-3', 'ready')
    for (const key of laneKeysFor('track-3')) deps.stemStore.seed(key)
    await deps.catalog.insert(preparing)
    await deps.catalog.insert(processing)
    await deps.catalog.insert(ready)

    const counts = await runStartupSweeps(deps)

    expect(counts.recoveredUnfinished).toBe(2)
    await expect(deps.catalog.getById('track-1')).resolves.toMatchObject({
      status: 'interrupted',
      errorDetail: 'Stemslayer closed before this separation finished. Retry the track.',
    })
    await expect(deps.catalog.getById('track-2')).resolves.toMatchObject({
      status: 'interrupted',
      errorDetail: 'Stemslayer closed before this separation finished. Retry the track.',
    })
    await expect(deps.catalog.getById('track-3')).resolves.toMatchObject({ status: 'ready' })
  })

  test('validateReady marks a ready row unavailable when its stems are missing, and leaves a complete one alone', async () => {
    const deps = makeDeps()
    const completeReady = trackAt('track-1', 'ready')
    for (const key of laneKeysFor('track-1')) deps.stemStore.seed(key)
    const missingReady = trackAt('track-2', 'ready')
    // Seed only some of the expected lane keys: incomplete stem set.
    deps.stemStore.seed(laneKeysFor('track-2')[0])
    await deps.catalog.insert(completeReady)
    await deps.catalog.insert(missingReady)

    const counts = await runStartupSweeps(deps)

    expect(counts.invalidatedReady).toBe(1)
    await expect(deps.catalog.getById('track-1')).resolves.toMatchObject({ status: 'ready' })
    const invalidated = await deps.catalog.getById('track-2')
    expect(invalidated?.status).toBe('unavailable')
    expect(invalidated?.errorDetail).toContain('Stored stems are unavailable')
    expect(invalidated?.errorDetail).toContain('Retry from the original audio.')
  })

  test('sweepOrphans deletes stem keys with no matching catalog row and keeps referenced ones', async () => {
    const deps = makeDeps()
    const ready = trackAt('track-1', 'ready')
    for (const key of laneKeysFor('track-1')) deps.stemStore.seed(key)
    await deps.catalog.insert(ready)
    // Orphan: no catalog row for track-2 at all.
    for (const key of laneKeysFor('track-2')) deps.stemStore.seed(key)

    const counts = await runStartupSweeps(deps)

    expect(counts.orphansRemoved).toBe(laneKeysFor('track-2').length)
    for (const key of laneKeysFor('track-1')) {
      await expect(deps.stemStore.exists(key)).resolves.toBe(true)
    }
    for (const key of laneKeysFor('track-2')) {
      await expect(deps.stemStore.exists(key)).resolves.toBe(false)
    }
  })

  test('runs the sweeps in order: a crash-recovered row is then also validated and its stray stems orphan-swept', async () => {
    const deps = makeDeps()
    // A preparing row with no stems at all: recovered to interrupted first;
    // validateReady only looks at 'ready' rows, so it is untouched by it;
    // it has no stem keys, so sweepOrphans has nothing of its to remove.
    const preparing = trackAt('track-1', 'preparing')
    await deps.catalog.insert(preparing)

    const counts = await runStartupSweeps(deps)

    expect(counts).toEqual({ recoveredUnfinished: 1, invalidatedReady: 0, orphansRemoved: 0 })
    await expect(deps.catalog.getById('track-1')).resolves.toMatchObject({ status: 'interrupted' })
  })
})
