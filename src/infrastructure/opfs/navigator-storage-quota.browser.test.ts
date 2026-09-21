import { expect, test } from 'vitest'

import { NavigatorStorageQuota } from './navigator-storage-quota'

function fakeStorageManager(overrides: Partial<StorageManager> = {}): StorageManager {
  return {
    estimate: async () => ({ quota: 0, usage: 0 }),
    persist: async () => false,
    persisted: async () => false,
    ...overrides,
  } as StorageManager
}

test('availableBytes is quota minus usage against a fake StorageManager', async () => {
  const quota = new NavigatorStorageQuota(fakeStorageManager({ estimate: async () => ({ quota: 100, usage: 40 }) }))

  await expect(quota.availableBytes()).resolves.toBe(60)
})

test('availableBytes is 0 when the estimate carries no quota', async () => {
  const quota = new NavigatorStorageQuota(
    fakeStorageManager({ estimate: async () => ({ quota: undefined, usage: 40 }) }),
  )

  await expect(quota.availableBytes()).resolves.toBe(0)
})

test('availableBytes is 0 when the estimate carries no usage', async () => {
  const quota = new NavigatorStorageQuota(
    fakeStorageManager({ estimate: async () => ({ quota: 100, usage: undefined }) }),
  )

  await expect(quota.availableBytes()).resolves.toBe(0)
})

test('requestPersistence wraps navigator.storage.persist()', async () => {
  const quota = new NavigatorStorageQuota(fakeStorageManager({ persist: async () => true }))

  await expect(quota.requestPersistence()).resolves.toBe(true)
})

test('isPersisted wraps navigator.storage.persisted()', async () => {
  const quota = new NavigatorStorageQuota(fakeStorageManager({ persisted: async () => true }))

  await expect(quota.isPersisted()).resolves.toBe(true)
})

test('against the real navigator.storage API, availableBytes resolves a non-negative number', async () => {
  const quota = new NavigatorStorageQuota()

  const available = await quota.availableBytes()

  expect(available).toBeGreaterThanOrEqual(0)
  expect(Number.isFinite(available)).toBe(true)
})

test('against the real navigator.storage API, isPersisted resolves a boolean consistent across calls', async () => {
  const quota = new NavigatorStorageQuota()

  const first = await quota.isPersisted()
  const second = await quota.isPersisted()

  expect(typeof first).toBe('boolean')
  expect(second).toBe(first)
})
