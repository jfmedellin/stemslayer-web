import type { QuotaPort } from '../../src/application/ports/quota-port'

export class FakeQuota implements QuotaPort {
  constructor(private availableByteCount: number) {}

  async availableBytes(): Promise<number> {
    return this.availableByteCount
  }

  setAvailableBytes(bytes: number): void {
    this.availableByteCount = bytes
  }
}
