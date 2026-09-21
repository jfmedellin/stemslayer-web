import { IDENTITY_CLAIM_LOCK_KEY } from './identity-claim-lock-key'
import { hasIdentity, type TrackIdentity } from '../domain/identity-claim'
import {
  rebindTrackSourceHashForRetry,
  transitionTrack,
  updateTrackMetadata,
  type Track,
  type TrackStatus,
} from '../domain/track'
import type { CatalogPort } from './ports/catalog-port'
import type { HashPort } from './ports/hash-port'
import type { LockPort } from './ports/lock-port'

export interface RetryTrackDeps {
  readonly catalog: CatalogPort
  readonly hash: HashPort
  readonly lock: LockPort
}

export interface RetryTrackInput {
  readonly bytes?: Uint8Array
}

export type RetryTrackResult =
  | Readonly<{ ok: true; track: Track }>
  | Readonly<{ ok: false }>
  | Readonly<{ ok: false; reason: 'identity-owned'; ownerTrackId: string }>

const retryableStatuses = new Set<TrackStatus>(['failed', 'interrupted', 'unavailable'])

function retryInPlace(track: Track): Track {
  return updateTrackMetadata(transitionTrack(track, 'preparing'), { errorDetail: null })
}

/**
 * Retries a `failed`/`interrupted`/`unavailable` track: moves it back to
 * `preparing` and clears `errorDetail`. Any other status, or an unknown
 * track id, is refused.
 *
 * The web app has no standing handle back to the original file
 * (`docs/decisions/browser-storage.md` section 7), so a retry that needs to
 * re-run the source through hashing again takes the bytes the user just
 * re-supplied (mirrors desktop's `history.py:617-630`, which re-hashes the
 * source on every retry). When the new bytes hash to something different
 * from the track's current identity, the rebind is serialized under the
 * identity-claim lock: if another track already owns `(newHash,
 * pipelineFingerprint)`, the retry is refused rather than creating a
 * duplicate identity; otherwise the same track id keeps its row, takes the
 * new hash, and the old identity is released for a later, independent claim
 * (desktop `test_retry_after_source_bytes_change_transfers_identity_without_stale_reuse`).
 */
export async function retryTrack(
  trackId: string,
  deps: RetryTrackDeps,
  input?: RetryTrackInput,
): Promise<RetryTrackResult> {
  const track = await deps.catalog.getById(trackId)
  if (track === undefined || !retryableStatuses.has(track.status)) {
    return Object.freeze({ ok: false })
  }

  if (input?.bytes === undefined) {
    const retried = retryInPlace(track)
    await deps.catalog.update(retried)
    return Object.freeze({ ok: true, track: retried })
  }

  const newHash = await deps.hash.sha256(input.bytes)
  if (newHash === track.sourceHash) {
    const retried = retryInPlace(track)
    await deps.catalog.update(retried)
    return Object.freeze({ ok: true, track: retried })
  }

  return deps.lock.withLock(IDENTITY_CLAIM_LOCK_KEY, async (): Promise<RetryTrackResult> => {
    const snapshot = await deps.catalog.listAll()
    const identity: TrackIdentity = { sourceHash: newHash, pipelineFingerprint: track.pipelineFingerprint }
    const owner = snapshot.find(
      (other) => other.trackId !== track.trackId && hasIdentity(other, identity),
    )
    if (owner !== undefined) {
      return Object.freeze({ ok: false, reason: 'identity-owned', ownerTrackId: owner.trackId })
    }

    const rebound = rebindTrackSourceHashForRetry(track, newHash)
    const retried = retryInPlace(rebound)
    await deps.catalog.update(retried)
    return Object.freeze({ ok: true, track: retried })
  })
}
