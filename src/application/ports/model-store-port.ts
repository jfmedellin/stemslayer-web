export interface ModelFootprint {
  readonly cached: boolean
  readonly sizeBytes: number
}

/**
 * Reports whether a profile's model weights are already cached, and their
 * byte size, for the quota pre-flight forecast. Implemented by P6 (Cache
 * API adapter: revision-named caches, SHA-256 check,
 * `docs/decisions/browser-storage.md` section 5).
 */
export interface ModelStorePort {
  getFootprint(profileId: string): Promise<ModelFootprint>
}
