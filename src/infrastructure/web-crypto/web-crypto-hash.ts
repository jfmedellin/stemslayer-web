import type { HashPort } from '../../application/ports/hash-port'

const HEX_RADIX = 16

/** `HashPort` over `crypto.subtle.digest`, returning lower-case hex. */
export class WebCryptoHash implements HashPort {
  async sha256(input: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(input))
    return toHex(new Uint8Array(digest))
  }
}

function toArrayBuffer(input: Uint8Array): ArrayBuffer {
  return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(HEX_RADIX).padStart(2, '0')).join('')
}
