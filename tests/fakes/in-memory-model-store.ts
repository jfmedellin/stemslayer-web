import type { ModelFootprint, ModelStorePort } from '../../src/application/ports/model-store-port'

const defaultFootprint: ModelFootprint = { cached: false, sizeBytes: 0 }

export class InMemoryModelStore implements ModelStorePort {
  private readonly footprintsByProfileId = new Map<string, ModelFootprint>()

  async getFootprint(profileId: string): Promise<ModelFootprint> {
    return this.footprintsByProfileId.get(profileId) ?? defaultFootprint
  }

  setFootprint(profileId: string, footprint: ModelFootprint): void {
    this.footprintsByProfileId.set(profileId, footprint)
  }
}
