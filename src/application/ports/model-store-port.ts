export interface ModelFootprint {
  readonly cached: boolean
  readonly sizeBytes: number
}

/** Streamed download progress, reported while a profile's weights are fetched. */
export interface ModelDownloadProgress {
  readonly receivedBytes: number
  readonly totalBytes: number
}

/**
 * Reports whether a profile's model weights are already cached, and their
 * byte size, for the quota pre-flight forecast; ensures the weights are
 * fetched, hash-verified and cached before inference can run. Implemented
 * by P6 (Cache API adapter: revision-named caches, SHA-256 check,
 * `docs/decisions/browser-storage.md` section 5).
 */
export interface ModelStorePort {
  getFootprint(profileId: string): Promise<ModelFootprint>
  /**
   * Resolves once the profile's weights are verified and cached; reports
   * streamed-byte progress while downloading. A verified cache hit resolves
   * immediately without reporting any progress
   * (`docs/decisions/browser-storage.md` section 5, `model_manager.py:226-227`).
   */
  ensure(profileId: string, onProgress: (progress: ModelDownloadProgress) => void): Promise<void>
  /**
   * Returns an owned copy of the already-cached, verified model bytes.
   * Never downloads or repairs: callers must `ensure()` first.
   */
  read(profileId: string): Promise<Uint8Array>
}
