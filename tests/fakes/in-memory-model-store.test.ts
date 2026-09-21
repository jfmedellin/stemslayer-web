import { describe, expect, test } from 'vitest'

import { InMemoryModelStore } from './in-memory-model-store'

describe('InMemoryModelStore', () => {
  test('reports an uncached profile with zero size by default', async () => {
    const store = new InMemoryModelStore()

    await expect(store.getFootprint('legacy-four-stem')).resolves.toEqual({
      cached: false,
      sizeBytes: 0,
    })
  })

  test('reports a configured footprint', async () => {
    const store = new InMemoryModelStore()
    store.setFootprint('metal-stereo-six-stem', { cached: true, sizeBytes: 284_797_240 })

    await expect(store.getFootprint('metal-stereo-six-stem')).resolves.toEqual({
      cached: true,
      sizeBytes: 284_797_240,
    })
  })
})
