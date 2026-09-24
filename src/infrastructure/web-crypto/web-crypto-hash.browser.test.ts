import { expect, test } from 'vitest'
import { WebCryptoHash } from './web-crypto-hash'

test('hashes the known SHA-256 vector for "abc"', async () => {
  const hash = new WebCryptoHash()
  const digest = await hash.sha256(new TextEncoder().encode('abc'))
  expect(digest).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('hashes the known SHA-256 vector for empty input', async () => {
  const hash = new WebCryptoHash()
  const digest = await hash.sha256(new Uint8Array())
  expect(digest).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
})
