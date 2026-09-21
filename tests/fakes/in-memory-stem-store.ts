import type { StemStorePort } from '../../src/application/ports/stem-store-port'

export class InMemoryStemStore implements StemStorePort {
  private readonly keys = new Set<string>()
  private readonly failingKeys = new Set<string>()

  async delete(resultKey: string): Promise<void> {
    if (this.failingKeys.has(resultKey)) {
      this.failingKeys.delete(resultKey)
      throw new Error(`stem-store.delete_failed:${resultKey}`)
    }
    this.keys.delete(resultKey)
  }

  seed(resultKey: string): void {
    this.keys.add(resultKey)
  }

  has(resultKey: string): boolean {
    return this.keys.has(resultKey)
  }

  failNextDeleteFor(resultKey: string): void {
    this.failingKeys.add(resultKey)
  }
}
