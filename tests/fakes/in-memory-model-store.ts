import type {
  ModelDownloadProgress,
  ModelFootprint,
  ModelStorePort,
} from '../../src/application/ports/model-store-port'

const defaultFootprint: ModelFootprint = { cached: false, sizeBytes: 0 }

export class InMemoryModelStore implements ModelStorePort {
  private readonly footprintsByProfileId = new Map<string, ModelFootprint>()
  private readonly downloadStepsByProfileId = new Map<string, readonly ModelDownloadProgress[]>()
  private readonly bytesByProfileId = new Map<string, Uint8Array>()

  async getFootprint(profileId: string): Promise<ModelFootprint> {
    return this.footprintsByProfileId.get(profileId) ?? defaultFootprint
  }

  setFootprint(profileId: string, footprint: ModelFootprint): void {
    this.footprintsByProfileId.set(profileId, footprint)
  }

  /** Scripts the sequence of progress events `ensure` reports while downloading an uncached profile. */
  setDownloadSteps(profileId: string, steps: readonly ModelDownloadProgress[]): void {
    this.downloadStepsByProfileId.set(profileId, steps)
  }

  setBytes(profileId: string, bytes: Uint8Array): void {
    this.bytesByProfileId.set(profileId, bytes.slice())
    this.footprintsByProfileId.set(profileId, { cached: true, sizeBytes: bytes.byteLength })
  }

  async ensure(profileId: string, onProgress: (progress: ModelDownloadProgress) => void): Promise<void> {
    const footprint = this.footprintsByProfileId.get(profileId) ?? defaultFootprint
    if (footprint.cached) return

    const steps = this.downloadStepsByProfileId.get(profileId)
      ?? [{ receivedBytes: footprint.sizeBytes, totalBytes: footprint.sizeBytes }]
    for (const step of steps) onProgress(step)

    this.footprintsByProfileId.set(profileId, { cached: true, sizeBytes: footprint.sizeBytes })
  }

  async read(profileId: string): Promise<Uint8Array> {
    const bytes = this.bytesByProfileId.get(profileId)
    if (bytes === undefined) throw new Error(`model-store.not_cached:${profileId}`)
    return bytes.slice()
  }
}
