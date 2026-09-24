import type { Track } from '../../domain/track'

/**
 * Reads and writes the `tracks` catalog. Implemented by P4 (IndexedDB
 * adapter: `tracks` object store, `by_identity` and `by_createdAt` indexes,
 * `docs/decisions/browser-storage.md` section 1).
 */
export interface CatalogPort {
  listAll(): Promise<readonly Track[]>
  getById(trackId: string): Promise<Track | undefined>
  insert(track: Track): Promise<void>
  update(track: Track): Promise<void>
  remove(trackId: string): Promise<void>
}
