/**
 * Reads and writes a track's stored stem set. Implemented by P5 (OPFS
 * adapter: one float32 WAV per lane under `/stems/{trackId}/{laneId}.wav`,
 * `docs/decisions/browser-storage.md` section 2).
 */
export interface StemStorePort {
  /** Deletes one stored key; deleting an unknown key is a no-op. */
  delete(resultKey: string): Promise<void>
  /** Whether a given key is currently stored (startup validation sweep). */
  exists(resultKey: string): Promise<boolean>
  /** Every key currently stored, for the startup orphan sweep. */
  listResultKeys(): Promise<readonly string[]>
}
