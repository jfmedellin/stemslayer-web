import { afterEach, beforeEach, expect, test } from 'vitest'

import { OpfsStemStore, StorageQuotaExceededError } from './opfs-stem-store'

let rootDirectoryName: string

beforeEach(() => {
  // Each test gets its own root directory name so tests never touch the
  // production `stems` root and never see each other's writes.
  rootDirectoryName = `opfs-test-${Math.random().toString(36).slice(2)}`
})

afterEach(async () => {
  const opfsRoot = await navigator.storage.getDirectory()
  await opfsRoot.removeEntry(rootDirectoryName, { recursive: true }).catch(() => undefined)
})

function newStore(overrides: ConstructorParameters<typeof OpfsStemStore>[0] = {}): OpfsStemStore {
  return new OpfsStemStore({ rootDirectoryName, ...overrides })
}

test('writeLane then readLane round trips the exact bytes', async () => {
  const store = newStore()
  const audio = Uint8Array.from([82, 73, 70, 70, 1, 2, 3, 4])

  await store.writeLane('stems/track-1', 'vocals', audio)

  await expect(store.readLane('stems/track-1', 'vocals')).resolves.toEqual(audio)
})

test('writeLane can write more than one lane under the same result key', async () => {
  const store = newStore()
  await store.writeLane('stems/track-1', 'vocals', Uint8Array.from([1]))
  await store.writeLane('stems/track-1', 'drums', Uint8Array.from([2]))

  await expect(store.readLane('stems/track-1', 'vocals')).resolves.toEqual(Uint8Array.from([1]))
  await expect(store.readLane('stems/track-1', 'drums')).resolves.toEqual(Uint8Array.from([2]))
})

test('exists reports true for a stored result key and for a stored lane key, false otherwise', async () => {
  const store = newStore()
  await store.writeLane('stems/track-1', 'vocals', Uint8Array.from([1]))

  await expect(store.exists('stems/track-1')).resolves.toBe(true)
  await expect(store.exists('stems/track-1/vocals')).resolves.toBe(true)
  await expect(store.exists('stems/track-2')).resolves.toBe(false)
})

test('listResultKeys returns every written result key, empty when nothing is stored', async () => {
  const store = newStore()
  await expect(store.listResultKeys()).resolves.toEqual([])

  await store.writeLane('stems/track-1', 'vocals', Uint8Array.from([1]))
  await store.writeLane('stems/track-2', 'drums', Uint8Array.from([2]))

  const keys = await store.listResultKeys()
  expect(keys).toHaveLength(2)
  expect(keys).toEqual(expect.arrayContaining(['stems/track-1', 'stems/track-2']))
})

test('delete on a whole result key removes every lane under it recursively', async () => {
  const store = newStore()
  await store.writeLane('stems/track-1', 'vocals', Uint8Array.from([1]))
  await store.writeLane('stems/track-1', 'drums', Uint8Array.from([2]))

  await store.delete('stems/track-1')

  await expect(store.exists('stems/track-1')).resolves.toBe(false)
  await expect(store.listResultKeys()).resolves.toEqual([])
})

test('delete on a single lane key removes only that lane, keeping its siblings', async () => {
  const store = newStore()
  await store.writeLane('stems/track-1', 'vocals', Uint8Array.from([1]))
  await store.writeLane('stems/track-1', 'drums', Uint8Array.from([2]))

  await store.delete('stems/track-1/vocals')

  await expect(store.exists('stems/track-1/vocals')).resolves.toBe(false)
  await expect(store.readLane('stems/track-1', 'drums')).resolves.toEqual(Uint8Array.from([2]))
})

test('deleting an unknown key is a no-op', async () => {
  const store = newStore()

  await expect(store.delete('stems/missing')).resolves.toBeUndefined()
})

test('a QuotaExceededError from the writable stream is mapped to a typed StorageQuotaExceededError', async () => {
  const store = newStore({
    createWritable: async () => {
      throw new DOMException('mock quota exceeded', 'QuotaExceededError')
    },
  })

  await expect(store.writeLane('stems/track-1', 'vocals', Uint8Array.from([1]))).rejects.toBeInstanceOf(
    StorageQuotaExceededError,
  )
  try {
    await store.writeLane('stems/track-1', 'vocals', Uint8Array.from([1]))
    expect.unreachable()
  } catch (error) {
    expect(error).toBeInstanceOf(StorageQuotaExceededError)
    expect((error as Error).message).toContain(
      'Not enough browser storage to save this separation. Remove old tracks and retry.',
    )
  }
})

test('two different root directory names never observe each other\'s writes', async () => {
  const store = newStore()
  await store.writeLane('stems/track-1', 'vocals', Uint8Array.from([1]))

  const otherRootName = `${rootDirectoryName}-other`
  const otherStore = new OpfsStemStore({ rootDirectoryName: otherRootName })
  try {
    await expect(otherStore.exists('stems/track-1')).resolves.toBe(false)
  } finally {
    const opfsRoot = await navigator.storage.getDirectory()
    await opfsRoot.removeEntry(otherRootName, { recursive: true }).catch(() => undefined)
  }
})
