/**
 * Deletes a track's stored stem set. Implemented by P5 (OPFS adapter: one
 * float32 WAV per lane under `/stems/{trackId}/{laneId}.wav`,
 * `docs/decisions/browser-storage.md` section 2).
 *
 * Reading/writing stems during separation is out of scope for P3a (no
 * inference runs yet); only the deletion `removeTrack` needs is declared.
 */
export interface StemStorePort {
  delete(resultKey: string): Promise<void>
}
