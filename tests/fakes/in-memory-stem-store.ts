import type { StemStorePort } from '../../src/application/ports/stem-store-port'

function laneKey(resultKey: string, laneId: string): string {
  return `${resultKey}/${laneId}`
}

export class InMemoryStemStore implements StemStorePort {
  private readonly keys = new Set<string>()
  private readonly failingKeys = new Set<string>()
  private readonly lanes = new Map<string, Uint8Array>()

  async writeLane(resultKey: string, laneId: string, audio: Uint8Array): Promise<void> {
    this.lanes.set(laneKey(resultKey, laneId), audio)
    this.keys.add(resultKey)
    this.keys.add(laneKey(resultKey, laneId))
  }

  async readLane(resultKey: string, laneId: string): Promise<Uint8Array> {
    const audio = this.lanes.get(laneKey(resultKey, laneId))
    if (audio === undefined) {
      throw new Error(`stem-store.lane_not_found:${laneKey(resultKey, laneId)}`)
    }
    return audio
  }

  async delete(resultKey: string): Promise<void> {
    if (this.failingKeys.has(resultKey)) {
      this.failingKeys.delete(resultKey)
      throw new Error(`stem-store.delete_failed:${resultKey}`)
    }
    this.keys.delete(resultKey)
    for (const key of [...this.lanes.keys()]) {
      if (key === resultKey || key.startsWith(`${resultKey}/`)) this.lanes.delete(key)
    }
    for (const key of [...this.keys]) {
      if (key.startsWith(`${resultKey}/`)) this.keys.delete(key)
    }
  }

  async exists(resultKey: string): Promise<boolean> {
    return this.keys.has(resultKey)
  }

  async listResultKeys(): Promise<readonly string[]> {
    return [...this.keys]
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
