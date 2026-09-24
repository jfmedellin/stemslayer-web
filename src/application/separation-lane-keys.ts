import type { Track } from '../domain/track'
import { resolveStemProfile } from './resolve-stem-profile'

/**
 * The per-lane `StemStorePort` keys a track's separation is expected to
 * publish, one per lane of its profile under its `resultKey`
 * (`docs/decisions/browser-storage.md` section 2: `/stems/{trackId}/{laneId}.wav`).
 * `separate`'s all-or-nothing publish and the `validateReady` startup sweep
 * both check every one of these is present before trusting a `ready` row.
 */
export function expectedLaneKeys(track: Pick<Track, 'resultKey' | 'profileId'>): readonly string[] {
  const profile = resolveStemProfile(track.profileId)
  return profile.lanes.map((lane) => `${track.resultKey}/${lane.laneId}`)
}
