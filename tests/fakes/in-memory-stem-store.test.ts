import { describe, expect, test } from 'vitest'

import { InMemoryStemStore } from './in-memory-stem-store'

describe('InMemoryStemStore', () => {
  test('deletes a stored key without error', async () => {
    const store = new InMemoryStemStore()
    store.seed('stems/track-1')

    await expect(store.delete('stems/track-1')).resolves.toBeUndefined()
    expect(store.has('stems/track-1')).toBe(false)
  })

  test('deleting an unknown key is a no-op', async () => {
    const store = new InMemoryStemStore()

    await expect(store.delete('stems/missing')).resolves.toBeUndefined()
  })

  test('rejects when the key is configured to fail', async () => {
    const store = new InMemoryStemStore()
    store.seed('stems/track-1')
    store.failNextDeleteFor('stems/track-1')

    await expect(store.delete('stems/track-1')).rejects.toThrow()
    expect(store.has('stems/track-1')).toBe(true)
  })

  test('exists reports whether a key is currently stored', async () => {
    const store = new InMemoryStemStore()
    store.seed('stems/track-1/vocals')

    await expect(store.exists('stems/track-1/vocals')).resolves.toBe(true)
    await expect(store.exists('stems/track-1/drums')).resolves.toBe(false)
  })

  test('listResultKeys returns every currently stored key', async () => {
    const store = new InMemoryStemStore()
    store.seed('stems/track-1/vocals')
    store.seed('stems/track-1/drums')

    await expect(store.listResultKeys()).resolves.toEqual(
      expect.arrayContaining(['stems/track-1/vocals', 'stems/track-1/drums']),
    )
    await expect(store.listResultKeys()).resolves.toHaveLength(2)
  })

  test('listResultKeys omits a key after it is deleted', async () => {
    const store = new InMemoryStemStore()
    store.seed('stems/track-1/vocals')
    await store.delete('stems/track-1/vocals')

    await expect(store.listResultKeys()).resolves.toEqual([])
  })

  test('writeLane then readLane round trips the exact bytes', async () => {
    const store = new InMemoryStemStore()
    const audio = Uint8Array.from([1, 2, 3, 4, 5])

    await store.writeLane('stems/track-1', 'vocals', audio)

    await expect(store.readLane('stems/track-1', 'vocals')).resolves.toEqual(audio)
  })

  test('writeLane makes the lane key and the result key exist', async () => {
    const store = new InMemoryStemStore()

    await store.writeLane('stems/track-1', 'vocals', Uint8Array.from([9]))

    await expect(store.exists('stems/track-1')).resolves.toBe(true)
    await expect(store.exists('stems/track-1/vocals')).resolves.toBe(true)
  })

  test('readLane on a lane that was never written rejects', async () => {
    const store = new InMemoryStemStore()

    await expect(store.readLane('stems/track-1', 'vocals')).rejects.toThrow()
  })
})
