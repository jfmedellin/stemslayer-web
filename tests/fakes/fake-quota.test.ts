import { describe, expect, test } from 'vitest'

import { FakeQuota } from './fake-quota'

describe('FakeQuota', () => {
  test('reports the configured available bytes', async () => {
    const quota = new FakeQuota(1_000)

    await expect(quota.availableBytes()).resolves.toBe(1_000)
  })

  test('reflects a later change in available bytes', async () => {
    const quota = new FakeQuota(1_000)
    quota.setAvailableBytes(500)

    await expect(quota.availableBytes()).resolves.toBe(500)
  })
})
