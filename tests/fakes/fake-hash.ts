import type { HashPort } from '../../src/application/ports/hash-port'

/**
 * Deterministic, non-cryptographic digest: same bytes always produce the
 * same string, and different bytes produce (for all practical test inputs)
 * a different string.
 */
export class FakeHash implements HashPort {
  async sha256(input: Uint8Array): Promise<string> {
    let hash = 0
    for (const byte of input) {
      hash = (Math.imul(hash, 31) + byte) >>> 0
    }
    return `fake-sha256-${input.length}-${hash.toString(16)}`
  }
}
