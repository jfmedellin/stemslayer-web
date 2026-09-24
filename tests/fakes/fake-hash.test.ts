import { describe, expect, test } from 'vitest'

import { FakeHash } from './fake-hash'

describe('FakeHash', () => {
  test('is deterministic for the same bytes', async () => {
    const hash = new FakeHash()
    const bytes = new Uint8Array([1, 2, 3, 4])

    await expect(hash.sha256(bytes)).resolves.toBe(await hash.sha256(bytes.slice()))
  })

  test('is distinct for different content', async () => {
    const hash = new FakeHash()

    const digestA = await hash.sha256(new Uint8Array([1, 2, 3]))
    const digestB = await hash.sha256(new Uint8Array([1, 2, 4]))
    const digestC = await hash.sha256(new Uint8Array([1, 2, 3, 0]))

    expect(digestA).not.toBe(digestB)
    expect(digestA).not.toBe(digestC)
  })
})
