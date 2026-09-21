import { transitionTrack, updateTrackMetadata, type Track, type TrackStatus } from '../domain/track'
import type { CatalogPort } from './ports/catalog-port'

export interface RetryTrackDeps {
  readonly catalog: CatalogPort
}

export type RetryTrackResult =
  | Readonly<{ ok: true; track: Track }>
  | Readonly<{ ok: false }>

const retryableStatuses = new Set<TrackStatus>(['failed', 'interrupted', 'unavailable'])

/**
 * Retries a `failed`/`interrupted`/`unavailable` track: moves it back to
 * `preparing` and clears `errorDetail`. Any other status, or an unknown
 * track id, is refused.
 */
export async function retryTrack(trackId: string, deps: RetryTrackDeps): Promise<RetryTrackResult> {
  const track = await deps.catalog.getById(trackId)
  if (track === undefined || !retryableStatuses.has(track.status)) {
    return Object.freeze({ ok: false })
  }

  const retried = updateTrackMetadata(transitionTrack(track, 'preparing'), { errorDetail: null })
  await deps.catalog.update(retried)
  return Object.freeze({ ok: true, track: retried })
}
