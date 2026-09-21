import { describe, expect, test } from 'vitest'

import { addToLibrary, type AddToLibraryDeps } from '../../src/application/add-to-library'
import { BASIC_PROFILE, ROCK_PROFILE } from '../../src/domain/stem-profile'
import { transitionTrack, type Track } from '../../src/domain/track'
import { FakeHash } from '../fakes/fake-hash'
import { FakeLock } from '../fakes/fake-lock'
import { FakeQuota } from '../fakes/fake-quota'
import { InMemoryCatalog } from '../fakes/in-memory-catalog'
import { InMemoryModelStore } from '../fakes/in-memory-model-store'

const PLENTY_OF_QUOTA = 10_000_000_000

function makeDeps(overrides: Partial<AddToLibraryDeps> = {}): AddToLibraryDeps {
  let counter = 0
  return {
    catalog: new InMemoryCatalog(),
    modelStore: new InMemoryModelStore(),
    quota: new FakeQuota(PLENTY_OF_QUOTA),
    lock: new FakeLock(),
    hash: new FakeHash(),
    generateTrackId: () => `track-${++counter}`,
    now: () => '2026-09-21T12:00:00.000Z',
    ...overrides,
  }
}

async function seedReadyTrack(deps: AddToLibraryDeps, bytes: Uint8Array, profile = BASIC_PROFILE): Promise<Track> {
  const result = await addToLibrary({ bytes, fileName: 'song.wav', profile }, deps)
  if (result.decision !== 'claimed') throw new Error(`expected claimed, got ${result.decision}`)
  const ready = transitionTrack(transitionTrack(result.track, 'processing'), 'ready')
  await deps.catalog.update(ready)
  return ready
}

describe('addToLibrary', () => {
  test('claims a new identity and creates a preparing track', async () => {
    const deps = makeDeps()

    const result = await addToLibrary(
      { bytes: new Uint8Array([1, 2, 3]), fileName: 'my-song.wav', profile: BASIC_PROFILE },
      deps,
    )

    expect(result.decision).toBe('claimed')
    if (result.decision !== 'claimed') return
    expect(result.track).toMatchObject({
      status: 'preparing',
      title: 'my-song',
      artist: 'Unknown artist',
      profileId: BASIC_PROFILE.profileId,
    })
    expect(result.track.sourceHash).toBeDefined()
    await expect(deps.catalog.listAll()).resolves.toEqual([result.track])
  })

  test('reuses an existing ready track for identical bytes and profile', async () => {
    const deps = makeDeps()
    const bytes = new Uint8Array([9, 9, 9])
    const ready = await seedReadyTrack(deps, bytes)

    const result = await addToLibrary({ bytes, fileName: 'song.wav', profile: BASIC_PROFILE }, deps)

    expect(result).toEqual({ decision: 'reused', track: ready })
    await expect(deps.catalog.listAll()).resolves.toEqual([ready])
  })

  test('same bytes with a different profile are independent (not a duplicate)', async () => {
    const deps = makeDeps()
    const bytes = new Uint8Array([5, 5, 5])
    await seedReadyTrack(deps, bytes, BASIC_PROFILE)

    const result = await addToLibrary({ bytes, fileName: 'song.wav', profile: ROCK_PROFILE }, deps)

    expect(result.decision).toBe('claimed')
    await expect(deps.catalog.listAll()).resolves.toHaveLength(2)
  })

  test('changed bytes create a new track instead of reusing the old identity', async () => {
    const deps = makeDeps()
    const original = await seedReadyTrack(deps, new Uint8Array([1, 1, 1]))

    const result = await addToLibrary(
      { bytes: new Uint8Array([2, 2, 2]), fileName: 'song.wav', profile: BASIC_PROFILE },
      deps,
    )

    expect(result.decision).toBe('claimed')
    if (result.decision !== 'claimed') return
    expect(result.track.trackId).not.toBe(original.trackId)
    await expect(deps.catalog.listAll()).resolves.toHaveLength(2)
  })

  test('re-adding the same bytes after a failure adopts and retries the existing identity', async () => {
    // Domain note (identity-claim.ts): selectPreferredIdentityOwner only ever
    // matches a competitor whose sourceHash+pipelineFingerprint exactly equal
    // the identity being claimed, so 'adopt-and-retry' can only fire for the
    // *same* content re-submitted after a failure (desktop's
    // test_failed_duplicate_retries_the_existing_identity). The hash always
    // matches the owner's here already, so addToLibrary does not rebind it;
    // rebinding a genuinely different hash on retry is retryTrack's job
    // (retry-track.ts), which takes the freshly supplied bytes explicitly.
    const deps = makeDeps()
    const bytes = new Uint8Array([7, 7, 7])
    const claim = await addToLibrary({ bytes, fileName: 'song.wav', profile: BASIC_PROFILE }, deps)
    if (claim.decision !== 'claimed') throw new Error('setup failed')
    const failed = transitionTrack(transitionTrack(claim.track, 'processing'), 'failed')
    await deps.catalog.update({ ...failed, errorDetail: 'inference.failed Retry from the original audio.' })

    const adoption = await addToLibrary({ bytes, fileName: 'song.wav', profile: BASIC_PROFILE }, deps)

    expect(adoption.decision).toBe('adopted')
    if (adoption.decision !== 'adopted') return
    expect(adoption.track.trackId).toBe(failed.trackId)
    expect(adoption.track.status).toBe('preparing')
    expect(adoption.track.errorDetail).toBeNull()
    expect(adoption.track.sourceHash).toBe(failed.sourceHash)
    await expect(deps.catalog.listAll()).resolves.toEqual([adoption.track])
  })

  test('changed bytes leave a stale failed identity untouched and independent', async () => {
    const deps = makeDeps()
    const claim = await addToLibrary(
      { bytes: new Uint8Array([1, 1, 1]), fileName: 'song.wav', profile: BASIC_PROFILE },
      deps,
    )
    if (claim.decision !== 'claimed') throw new Error('setup failed')
    const failed = transitionTrack(transitionTrack(claim.track, 'processing'), 'failed')
    await deps.catalog.update(failed)

    const result = await addToLibrary(
      { bytes: new Uint8Array([2, 2, 2]), fileName: 'song.wav', profile: BASIC_PROFILE },
      deps,
    )

    expect(result.decision).toBe('claimed')
    if (result.decision !== 'claimed') return
    expect(result.track.trackId).not.toBe(failed.trackId)
    await expect(deps.catalog.getById(failed.trackId)).resolves.toEqual(failed)
  })

  test('a preparing/processing owner is awaited without creating anything new', async () => {
    const deps = makeDeps()
    const bytes = new Uint8Array([3, 3, 3])
    const claim = await addToLibrary({ bytes, fileName: 'song.wav', profile: BASIC_PROFILE }, deps)
    if (claim.decision !== 'claimed') throw new Error('setup failed')

    const result = await addToLibrary({ bytes, fileName: 'song.wav', profile: BASIC_PROFILE }, deps)

    expect(result).toEqual({ decision: 'awaiting', track: claim.track })
    await expect(deps.catalog.listAll()).resolves.toEqual([claim.track])
  })

  test('quota refusal happens before any catalog write', async () => {
    const deps = makeDeps({ quota: new FakeQuota(1) })

    const result = await addToLibrary(
      { bytes: new Uint8Array([1, 2, 3]), fileName: 'song.wav', profile: BASIC_PROFILE },
      deps,
    )

    expect(result.decision).toBe('quota-refused')
    if (result.decision !== 'quota-refused') return
    expect(result.availableBytes).toBe(1)
    expect(result.forecastBytes).toBeGreaterThan(1)
    await expect(deps.catalog.listAll()).resolves.toEqual([])
  })

  test('quota forecast adds the model footprint only when uncached', async () => {
    const modelStore = new InMemoryModelStore()
    const stemForecast = BASIC_PROFILE.lanes.length * 105_840_000
    const availableBytes = stemForecast + 500
    const uncachedModelBytes = 1_000

    modelStore.setFootprint(BASIC_PROFILE.profileId, { cached: false, sizeBytes: uncachedModelBytes })
    const withUncachedModel = await addToLibrary(
      { bytes: new Uint8Array([1]), fileName: 'song.wav', profile: BASIC_PROFILE },
      makeDeps({ modelStore, quota: new FakeQuota(availableBytes) }),
    )
    expect(withUncachedModel.decision).toBe('quota-refused')

    modelStore.setFootprint(BASIC_PROFILE.profileId, { cached: true, sizeBytes: uncachedModelBytes })
    const withCachedModel = await addToLibrary(
      { bytes: new Uint8Array([1]), fileName: 'song.wav', profile: BASIC_PROFILE },
      makeDeps({ modelStore, quota: new FakeQuota(availableBytes) }),
    )
    expect(withCachedModel.decision).toBe('claimed')
  })

  test('concurrent identical adds under the same lock claim exactly once', async () => {
    const deps = makeDeps()
    const bytes = new Uint8Array([4, 4, 4])

    const [first, second] = await Promise.all([
      addToLibrary({ bytes, fileName: 'song.wav', profile: BASIC_PROFILE }, deps),
      addToLibrary({ bytes, fileName: 'song.wav', profile: BASIC_PROFILE }, deps),
    ])

    const decisions = [first.decision, second.decision].sort()
    expect(decisions).toEqual(['awaiting', 'claimed'])
    await expect(deps.catalog.listAll()).resolves.toHaveLength(1)
    expect((deps.lock as FakeLock).acquisitionOrder).toHaveLength(2)
  })
})
