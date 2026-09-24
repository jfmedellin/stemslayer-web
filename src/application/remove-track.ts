import { transitionTrack, updateTrackMetadata } from '../domain/track'
import type { CatalogPort } from './ports/catalog-port'
import type { StemStorePort } from './ports/stem-store-port'

export interface RemoveTrackDeps {
  readonly catalog: CatalogPort
  readonly stemStore: StemStorePort
}

export type RemoveTrackResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: 'not-found' | 'in-progress' | 'unavailable' }>

/**
 * Refuses while `preparing`/`processing`; otherwise deletes the stem set
 * then the catalog row, in that order. A stem-store failure lands the track
 * on `unavailable` instead of deleting the row (desktop `history.py:456-464`).
 */
export async function removeTrack(trackId: string, deps: RemoveTrackDeps): Promise<RemoveTrackResult> {
  const track = await deps.catalog.getById(trackId)
  if (track === undefined) {
    return Object.freeze({ ok: false, reason: 'not-found' })
  }
  if (track.status === 'preparing' || track.status === 'processing') {
    return Object.freeze({ ok: false, reason: 'in-progress' })
  }

  try {
    await deps.stemStore.delete(track.resultKey)
  } catch {
    const errorDetail = 'storage.delete_failed Could not remove stored stems. Retry or remove again.'
    const unavailable = track.status === 'unavailable'
      ? updateTrackMetadata(track, { errorDetail })
      : updateTrackMetadata(transitionTrack(track, 'unavailable'), { errorDetail })
    await deps.catalog.update(unavailable)
    return Object.freeze({ ok: false, reason: 'unavailable' })
  }

  await deps.catalog.remove(trackId)
  return Object.freeze({ ok: true })
}
