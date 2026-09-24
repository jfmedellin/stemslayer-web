import { afterEach, beforeEach, expect, test } from 'vitest'
import { addToLibrary } from '../application/add-to-library'
import { BASIC_PROFILE } from '../domain/stem-profile'
import { FakeQuota } from '../../tests/fakes/fake-quota'
import { InMemoryModelStore } from '../../tests/fakes/in-memory-model-store'
import { IndexedDbCatalog } from './indexeddb/indexeddb-catalog'
import { WebCryptoHash } from './web-crypto/web-crypto-hash'
import { WebLocksLock } from './web-locks/web-locks-lock'

let dbName: string
let catalog: IndexedDbCatalog

beforeEach(() => {
  dbName = `stemslayer-test-${Math.random().toString(36).slice(2)}`
  catalog = new IndexedDbCatalog(dbName)
})

afterEach(async () => {
  await catalog.close()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('delete_failed'))
  })
})

test('two racing adds of the same bytes claim exactly once through the real Web Lock', async () => {
  const modelStore = new InMemoryModelStore()
  modelStore.setFootprint(BASIC_PROFILE.profileId, { cached: true, sizeBytes: 0 })
  const quota = new FakeQuota(1_000_000_000)
  const lock = new WebLocksLock()
  const hash = new WebCryptoHash()
  let trackIdCounter = 0

  const deps = {
    catalog,
    modelStore,
    quota,
    lock,
    hash,
    generateTrackId: () => `track-${trackIdCounter++}`,
    now: () => '2026-09-21T00:00:00.000Z',
  }

  const bytes = new TextEncoder().encode('same audio bytes, twice')
  const input = { bytes, fileName: 'song.wav', profile: BASIC_PROFILE }

  const [first, second] = await Promise.all([
    addToLibrary(input, deps),
    addToLibrary(input, deps),
  ])

  const decisions = [first.decision, second.decision].sort()
  expect(decisions).toEqual(['awaiting', 'claimed'])

  const rows = await catalog.listAll()
  expect(rows).toHaveLength(1)
  expect(rows[0]?.status).toBe('preparing')
})
