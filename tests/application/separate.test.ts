import { describe, expect, test } from 'vitest'

import { separate, type SeparateDeps, type SeparateProgressEvent } from '../../src/application/separate'
import { BASIC_PROFILE } from '../../src/domain/stem-profile'
import { createTrack, transitionTrack, type Track, type TrackInput } from '../../src/domain/track'
import { FakeInference } from '../fakes/fake-inference'
import { InMemoryCatalog } from '../fakes/in-memory-catalog'
import { InMemoryModelStore } from '../fakes/in-memory-model-store'
import { InMemoryStemStore } from '../fakes/in-memory-stem-store'

const input: TrackInput = {
  trackId: 'track-1',
  title: 'Song',
  artist: 'Artist',
  genre: null,
  durationSeconds: 0,
  bpm: null,
  musicalKey: null,
  createdAtUtc: '2026-09-21T12:00:00.000Z',
  profileId: BASIC_PROFILE.profileId,
  pipelineFingerprint: 'pipeline-a',
  resultKey: 'stems/track-1',
}

const expectedLaneKeys = BASIC_PROFILE.lanes.map((lane) => `stems/track-1/${lane.laneId}`)

function makeDeps(): SeparateDeps & {
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

async function seedPreparing(catalog: InMemoryCatalog): Promise<Track> {
  const track = createTrack(input)
  await catalog.insert(track)
  return track
}

describe('separate', () => {
  test('refuses a non-preparing row', async () => {
    const deps = makeDeps()
    const preparing = createTrack(input)
    const processing = transitionTrack(preparing, 'processing')
    await deps.catalog.insert(processing)

    const handle = separate(processing.trackId, new Uint8Array([1]), deps)

    await expect(handle.result).resolves.toEqual({ ok: false, reason: 'not-preparing' })
  })

  test('refuses an unknown track', async () => {
    const deps = makeDeps()

    const handle = separate('missing', new Uint8Array([1]), deps)

    await expect(handle.result).resolves.toEqual({ ok: false, reason: 'not-preparing' })
  })

  test('success path flips to ready once every expected lane key is written, with progress events', async () => {
    const deps = makeDeps()
    await seedPreparing(deps.catalog)
    deps.modelStore.setFootprint(BASIC_PROFILE.profileId, { cached: false, sizeBytes: 1_000 })
    deps.inference.scriptSuccess('track-1', expectedLaneKeys)
    const events: SeparateProgressEvent[] = []

    const handle = separate('track-1', new Uint8Array([1, 2, 3]), { ...deps, onProgress: (event) => events.push(event) })
    const result = await handle.result

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.track.status).toBe('ready')
    await expect(deps.catalog.getById('track-1')).resolves.toEqual(result.track)
    for (const key of expectedLaneKeys) {
      await expect(deps.stemStore.exists(key)).resolves.toBe(true)
    }
    expect(events.some((event) => event.phase === 'preparing' && event.detail.includes('Basic'))).toBe(true)
    expect(events.some((event) => event.phase === 'processing')).toBe(true)
  })

  test('an inference failure lands on failed with no partial stems referenced', async () => {
    const deps = makeDeps()
    await seedPreparing(deps.catalog)
    deps.inference.scriptFailure('track-1', new Error('inference.crashed Model produced no output.'))
    // Simulate a partial write before the failure to prove cleanup happens.
    deps.stemStore.seed(expectedLaneKeys[0])

    const handle = separate('track-1', new Uint8Array([1]), deps)
    const result = await handle.result

    expect(result.ok).toBe(false)
    if (result.ok || result.reason === 'not-preparing') return
    expect(result.reason).toBe('failed')
    expect(result.track.status).toBe('failed')
    expect(result.track.errorDetail).toContain('inference.crashed')
    expect(result.track.errorDetail).toContain('Retry from the original audio.')
    for (const key of expectedLaneKeys) {
      await expect(deps.stemStore.exists(key)).resolves.toBe(false)
    }
  })

  test('cancelling the running inference lands on interrupted with the desktop cancel copy and no partial stems', async () => {
    const deps = makeDeps()
    await seedPreparing(deps.catalog)
    // Unscripted track id: FakeInference hangs until terminate().
    deps.stemStore.seed(expectedLaneKeys[1])

    const handle = separate('track-1', new Uint8Array([1]), deps)
    await Promise.resolve()
    await Promise.resolve()
    handle.terminate()
    const result = await handle.result

    expect(result.ok).toBe(false)
    if (result.ok || result.reason === 'not-preparing') return
    expect(result.reason).toBe('interrupted')
    expect(result.track.status).toBe('interrupted')
    expect(result.track.errorDetail).toBe(
      'job.cancelled Separation was cancelled; no partial result was kept. Retry from the original audio.',
    )
    for (const key of expectedLaneKeys) {
      await expect(deps.stemStore.exists(key)).resolves.toBe(false)
    }
  })

  test('terminating before inference ever starts still lands on interrupted without running inference', async () => {
    const deps = makeDeps()
    await seedPreparing(deps.catalog)
    deps.modelStore.setFootprint(BASIC_PROFILE.profileId, { cached: false, sizeBytes: 500 })
    deps.modelStore.setDownloadSteps(BASIC_PROFILE.profileId, [{ receivedBytes: 500, totalBytes: 500 }])
    deps.inference.scriptSuccess('track-1', expectedLaneKeys)

    const handle = separate('track-1', new Uint8Array([1]), deps)
    handle.terminate()
    const result = await handle.result

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('interrupted')
    for (const key of expectedLaneKeys) {
      await expect(deps.stemStore.exists(key)).resolves.toBe(false)
    }
  })

  test('a publish that is missing an expected lane key is treated as a failure and cleans up', async () => {
    const deps = makeDeps()
    await seedPreparing(deps.catalog)
    // Script success with only some of the expected lanes: incomplete publish.
    deps.inference.scriptSuccess('track-1', [expectedLaneKeys[0]])

    const handle = separate('track-1', new Uint8Array([1]), deps)
    const result = await handle.result

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('failed')
    for (const key of expectedLaneKeys) {
      await expect(deps.stemStore.exists(key)).resolves.toBe(false)
    }
  })
})
