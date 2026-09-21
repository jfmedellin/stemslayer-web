import { afterEach, beforeEach, expect, test } from 'vitest'
import { createTrack, type Track } from '../../domain/track'
import {
  DuplicateTrackIdError,
  IdentityCollisionError,
  IndexedDbCatalog,
  TrackNotFoundError,
} from './indexeddb-catalog'

let dbName: string
let openCatalogs: IndexedDbCatalog[]

beforeEach(() => {
  dbName = `stemslayer-test-${Math.random().toString(36).slice(2)}`
  openCatalogs = []
})

afterEach(async () => {
  for (const catalog of openCatalogs) {
    await catalog.close()
  }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('delete_failed'))
  })
})

function newCatalog(): IndexedDbCatalog {
  const catalog = new IndexedDbCatalog(dbName)
  openCatalogs.push(catalog)
  return catalog
}

function trackInput(overrides: Partial<Parameters<typeof createTrack>[0]> = {}) {
  return {
    trackId: overrides.trackId ?? `track-${Math.random().toString(36).slice(2)}`,
    title: 'Song',
    artist: 'Artist',
    genre: null,
    durationSeconds: 180,
    bpm: null,
    musicalKey: null,
    createdAtUtc: '2026-01-01T00:00:00.000Z',
    profileId: 'legacy-four-stem',
    pipelineFingerprint: 'fp-1',
    resultKey: 'stems/track',
    ...overrides,
  }
}

test('creates the tracks store, keyed by trackId, with by_identity and by_createdAt indexes at version 1', async () => {
  const catalog = newCatalog()
  await catalog.listAll()

  const raw = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('open_failed'))
  })
  try {
    expect(raw.version).toBe(1)
    expect(raw.objectStoreNames.contains('tracks')).toBe(true)
    const tx = raw.transaction('tracks', 'readonly')
    const store = tx.objectStore('tracks')
    expect(store.keyPath).toBe('trackId')
    expect(store.indexNames.contains('by_identity')).toBe(true)
    expect(store.indexNames.contains('by_createdAt')).toBe(true)
    const identityIndex = store.index('by_identity')
    expect(identityIndex.unique).toBe(true)
    expect(identityIndex.keyPath).toEqual(['sourceHash', 'pipelineFingerprint'])
  } finally {
    raw.close()
  }
})

test('inserts and reads back a track, and getById on an unknown id resolves undefined', async () => {
  const catalog = newCatalog()
  const track = createTrack(trackInput({ trackId: 'track-1' }))
  await catalog.insert(track)

  const read = await catalog.getById('track-1')
  expect(read).toEqual(track)
  expect(await catalog.getById('missing')).toBeUndefined()
})

test('listAll returns rows ordered newest first by createdAtUtc', async () => {
  const catalog = newCatalog()
  const older = createTrack(trackInput({ trackId: 'older', createdAtUtc: '2026-01-01T00:00:00.000Z' }))
  const newer = createTrack(trackInput({ trackId: 'newer', createdAtUtc: '2026-01-02T00:00:00.000Z' }))
  await catalog.insert(older)
  await catalog.insert(newer)

  const rows = await catalog.listAll()
  expect(rows.map((row) => row.trackId)).toEqual(['newer', 'older'])
})

test('insert rejects a duplicate trackId with a typed error', async () => {
  const catalog = newCatalog()
  const track = createTrack(trackInput({ trackId: 'dup' }))
  await catalog.insert(track)

  await expect(catalog.insert(track)).rejects.toBeInstanceOf(DuplicateTrackIdError)
})

test('insert rejects a unique-index collision on [sourceHash, pipelineFingerprint] with a typed error', async () => {
  const catalog = newCatalog()
  const first = { ...createTrack(trackInput({ trackId: 'first' })), sourceHash: 'hash-a' } as Track
  const second = { ...createTrack(trackInput({ trackId: 'second' })), sourceHash: 'hash-a' } as Track
  await catalog.insert(first)

  await expect(catalog.insert(second)).rejects.toBeInstanceOf(IdentityCollisionError)
})

test('a row with no sourceHash never collides in the unique index', async () => {
  const catalog = newCatalog()
  const first = createTrack(trackInput({ trackId: 'first' }))
  const second = createTrack(trackInput({ trackId: 'second' }))

  await catalog.insert(first)
  await expect(catalog.insert(second)).resolves.toBeUndefined()
})

test('update requires an existing row and rejects an unknown id with a typed error', async () => {
  const catalog = newCatalog()
  const track = createTrack(trackInput({ trackId: 'to-update' }))

  await expect(catalog.update(track)).rejects.toBeInstanceOf(TrackNotFoundError)

  await catalog.insert(track)
  const updated = { ...track, title: 'New title' } as Track
  await catalog.update(updated)
  expect((await catalog.getById('to-update'))?.title).toBe('New title')
})

test('remove of an unknown id is a no-op', async () => {
  const catalog = newCatalog()
  await expect(catalog.remove('never-existed')).resolves.toBeUndefined()
})

test('a track read back is frozen exactly as createTrack produces it', async () => {
  const catalog = newCatalog()
  const track = createTrack(trackInput({ trackId: 'frozen' }))
  await catalog.insert(track)

  const read = await catalog.getById('frozen')
  expect(read).toEqual(track)
  expect(Object.isFrozen(read)).toBe(true)

  const [listed] = await catalog.listAll()
  expect(Object.isFrozen(listed)).toBe(true)
})

test('two catalog instances on the same database observe each other\'s writes', async () => {
  const first = newCatalog()
  const second = new IndexedDbCatalog(dbName)
  openCatalogs.push(second)

  const track = createTrack(trackInput({ trackId: 'shared' }))
  await first.insert(track)

  expect(await second.getById('shared')).toEqual(track)
  const rows = await second.listAll()
  expect(rows.map((row) => row.trackId)).toEqual(['shared'])
})
