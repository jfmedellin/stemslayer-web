import { describe, expect, test } from 'vitest'

import { retryTrack } from '../../src/application/retry-track'
import { SeparationQueue, type SeparationQueueDeps } from '../../src/application/separation-queue'
import { BASIC_PROFILE } from '../../src/domain/stem-profile'
import { createTrack, type Track, type TrackInput } from '../../src/domain/track'
import { FakeHash } from '../fakes/fake-hash'
import { FakeInference } from '../fakes/fake-inference'
import { FakeLock } from '../fakes/fake-lock'
import { InMemoryCatalog } from '../fakes/in-memory-catalog'
import { InMemoryModelStore } from '../fakes/in-memory-model-store'
import { InMemoryStemStore } from '../fakes/in-memory-stem-store'

function trackInput(trackId: string): TrackInput {
  return {
    trackId,
    title: 'Song',
    artist: 'Artist',
    genre: null,
    durationSeconds: 0,
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

async function seedPreparing(catalog: InMemoryCatalog, trackId: string): Promise<Track> {
  const track = createTrack(trackInput(trackId))
  await catalog.insert(track)
  return track
}

async function waitUntilStatus(catalog: InMemoryCatalog, trackId: string, status: Track['status']): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    const track = await catalog.getById(trackId)
    if (track?.status === status) return
    await Promise.resolve()
  }
}

function makeDeps(): SeparationQueueDeps & {
  catalog: InMemoryCatalog
  stemStore: InMemoryStemStore
  modelStore: InMemoryModelStore
  inference: FakeInference
} {
  const stemStore = new InMemoryStemStore()
  return {
    catalog: new InMemoryCatalog(),
    stemStore,
    modelStore: new InMemoryModelStore(),
    inference: new FakeInference(stemStore),
  }
}

describe('SeparationQueue', () => {
  test('runs one job at a time and preserves FIFO order', async () => {
    const deps = makeDeps()
    await seedPreparing(deps.catalog, 'track-1')
    await seedPreparing(deps.catalog, 'track-2')
    deps.inference.scriptSuccess('track-1', laneKeysFor('track-1'))
    deps.inference.scriptSuccess('track-2', laneKeysFor('track-2'))
    const events: Array<{ trackId: string; phase: string }> = []

    const queue = new SeparationQueue({
      ...deps,
      onProgress: (trackId, event) => events.push({ trackId, phase: event.phase }),
    })
    queue.enqueue('track-1', new Uint8Array([1]))
    queue.enqueue('track-2', new Uint8Array([2]))

    // Drain: poll until both tracks are settled (fakes resolve within microtasks).
    for (let i = 0; i < 20; i += 1) {
      const [one, two] = await Promise.all([deps.catalog.getById('track-1'), deps.catalog.getById('track-2')])
      if (one?.status === 'ready' && two?.status === 'ready') break
      await Promise.resolve()
    }

    await expect(deps.catalog.getById('track-1')).resolves.toMatchObject({ status: 'ready' })
    await expect(deps.catalog.getById('track-2')).resolves.toMatchObject({ status: 'ready' })

    const track1LastIndex = events.map((e) => e.trackId).lastIndexOf('track-1')
    const track2FirstIndex = events.map((e) => e.trackId).indexOf('track-2')
    expect(track1LastIndex).toBeLessThan(track2FirstIndex)
  })

  test('cancel on a queued job removes it without ever starting it and lands on interrupted', async () => {
    const deps = makeDeps()
    await seedPreparing(deps.catalog, 'track-1')
    await seedPreparing(deps.catalog, 'track-2')
    // track-1 is unscripted: FakeInference hangs, keeping the queue busy so
    // track-2 stays queued long enough to be cancelled before it ever runs.
    const queue = new SeparationQueue(deps)
    queue.enqueue('track-1', new Uint8Array([1]))
    queue.enqueue('track-2', new Uint8Array([2]))
    await Promise.resolve()
    await Promise.resolve()

    const cancelled = queue.cancel('track-2')
    await waitUntilStatus(deps.catalog, 'track-2', 'interrupted')

    expect(cancelled).toBe(true)
    await expect(deps.catalog.getById('track-2')).resolves.toMatchObject({
      status: 'interrupted',
      errorDetail: 'job.cancelled Separation was cancelled; no partial result was kept. Retry from the original audio.',
    })
    expect(deps.inference.writtenLaneKeysByTrackId.has('track-2')).toBe(false)

    queue.cancel('track-1') // clean up the still-running hung job
  })

  test('cancel on the running job terminates it and lands on interrupted', async () => {
    const deps = makeDeps()
    await seedPreparing(deps.catalog, 'track-1')
    const queue = new SeparationQueue(deps)
    queue.enqueue('track-1', new Uint8Array([1]))
    await Promise.resolve()
    await Promise.resolve()

    const cancelled = queue.cancel('track-1')
    await waitUntilStatus(deps.catalog, 'track-1', 'interrupted')

    expect(cancelled).toBe(true)
    await expect(deps.catalog.getById('track-1')).resolves.toMatchObject({
      status: 'interrupted',
      errorDetail: 'job.cancelled Separation was cancelled; no partial result was kept. Retry from the original audio.',
    })
  })

  test('cancel on a track that is neither queued nor running returns false', async () => {
    const deps = makeDeps()
    const queue = new SeparationQueue(deps)

    expect(queue.cancel('unknown-track')).toBe(false)
  })

  test('retry after a cancel re-enqueues and still reaches ready', async () => {
    const deps = makeDeps()
    await seedPreparing(deps.catalog, 'track-1')
    const queue = new SeparationQueue(deps)
    queue.enqueue('track-1', new Uint8Array([1]))
    await Promise.resolve()
    await Promise.resolve()
    queue.cancel('track-1')
    await waitUntilStatus(deps.catalog, 'track-1', 'interrupted')
    await expect(deps.catalog.getById('track-1')).resolves.toMatchObject({ status: 'interrupted' })

    const retryDeps = { catalog: deps.catalog, hash: new FakeHash(), lock: new FakeLock() }
    const retried = await retryTrack('track-1', retryDeps)
    expect(retried.ok).toBe(true)

    deps.inference.scriptSuccess('track-1', laneKeysFor('track-1'))
    queue.enqueue('track-1', new Uint8Array([1]))
    for (let i = 0; i < 20; i += 1) {
      const track = await deps.catalog.getById('track-1')
      if (track?.status === 'ready') break
      await Promise.resolve()
    }

    await expect(deps.catalog.getById('track-1')).resolves.toMatchObject({ status: 'ready' })
  })
})
