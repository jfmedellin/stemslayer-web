import type { Track, TrackStatus } from './track'

export interface TrackIdentity {
  readonly sourceHash: string
  readonly pipelineFingerprint: string
}

const ownerRank: Readonly<Record<TrackStatus, number>> = {
  ready: 3,
  processing: 2,
  preparing: 1,
  failed: 0,
  interrupted: 0,
  unavailable: 0,
}

export function identityOf(track: Track): TrackIdentity | undefined {
  if (track.sourceHash === undefined) return undefined
  return Object.freeze({
    sourceHash: track.sourceHash,
    pipelineFingerprint: track.pipelineFingerprint,
  })
}

export function hasIdentity(track: Track, identity: TrackIdentity): boolean {
  return track.sourceHash !== undefined
    && track.sourceHash === identity.sourceHash
    && track.pipelineFingerprint === identity.pipelineFingerprint
}

function isPreferred(candidate: Track, current: Track): boolean {
  const rankDifference = ownerRank[candidate.status] - ownerRank[current.status]
  if (rankDifference !== 0) return rankDifference > 0
  return candidate.createdAtUtc > current.createdAtUtc
}

export function selectPreferredIdentityOwner(
  catalog: readonly Track[],
  candidate: Track,
): Track | undefined {
  const identity = identityOf(candidate)
  if (identity === undefined) return undefined

  let preferred: Track | undefined
  for (const competitor of catalog) {
    if (competitor.trackId === candidate.trackId || !hasIdentity(competitor, identity)) {
      continue
    }
    if (preferred === undefined || isPreferred(competitor, preferred)) {
      preferred = competitor
    }
  }
  return preferred
}
