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

  test('ensure resolves immediately with no progress when already cached', async () => {
    const store = new InMemoryModelStore()
    store.setFootprint('legacy-four-stem', { cached: true, sizeBytes: 174_266_088 })
    const progress: unknown[] = []

    await store.ensure('legacy-four-stem', (event) => progress.push(event))

    expect(progress).toEqual([])
    await expect(store.getFootprint('legacy-four-stem')).resolves.toEqual({
      cached: true,
      sizeBytes: 174_266_088,
    })
  })

  test('ensure reports a default full-download step and then caches an uncached profile', async () => {
    const store = new InMemoryModelStore()
    store.setFootprint('legacy-four-stem', { cached: false, sizeBytes: 1_000 })
    const progress: unknown[] = []

    await store.ensure('legacy-four-stem', (event) => progress.push(event))

    expect(progress).toEqual([{ receivedBytes: 1_000, totalBytes: 1_000 }])
    await expect(store.getFootprint('legacy-four-stem')).resolves.toEqual({
      cached: true,
      sizeBytes: 1_000,
    })
  })

  test('ensure reports configured download steps in order', async () => {
    const store = new InMemoryModelStore()
    store.setFootprint('metal-stereo-six-stem', { cached: false, sizeBytes: 300 })
    store.setDownloadSteps('metal-stereo-six-stem', [
      { receivedBytes: 100, totalBytes: 300 },
      { receivedBytes: 300, totalBytes: 300 },
    ])
    const progress: unknown[] = []

    await store.ensure('metal-stereo-six-stem', (event) => progress.push(event))

    expect(progress).toEqual([
      { receivedBytes: 100, totalBytes: 300 },
      { receivedBytes: 300, totalBytes: 300 },
    ])
  })
})
