/**
 * Reads and writes a track's stored stem set. Implemented by P5 (OPFS
 * adapter: one float32 WAV per lane under `/stems/{trackId}/{laneId}.wav`,
 * `docs/decisions/browser-storage.md` section 2).
 */
export interface StemStorePort {
  /** Writes one lane's encoded bytes under a result key (`writeLane('stems/track-1', 'vocals', bytes)`). */
  writeLane(resultKey: string, laneId: string, audio: Uint8Array): Promise<void>
  /** Reads back one lane's stored bytes, byte-identical to what was written. Rejects if the lane was never written. */
  readLane(resultKey: string, laneId: string): Promise<Uint8Array>
  /** Deletes one stored key (a whole result key, or one lane key within it); deleting an unknown key is a no-op. */
  delete(resultKey: string): Promise<void>
  /** Whether a given key is currently stored (startup validation sweep). */
  exists(resultKey: string): Promise<boolean>
  /** Every key currently stored, for the startup orphan sweep. */
  listResultKeys(): Promise<readonly string[]>
}
