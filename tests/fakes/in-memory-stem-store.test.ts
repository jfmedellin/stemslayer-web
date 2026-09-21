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
})
