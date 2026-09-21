import type { Track, TrackStatus } from './track'

export interface TrackIdentity {
  readonly sourceHash: string
  readonly pipelineFingerprint: string
}

export type IdentityClaimDecision =
  | Readonly<{ kind: 'claim-candidate'; trackId: string }>
  | Readonly<{
      kind: 'reuse-ready' | 'await-owner' | 'adopt-and-retry'
      ownerTrackId: string
    }>

export class IdentityClaimError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'IdentityClaimError'
  }
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
  claimedIdentity?: TrackIdentity,
): Track | undefined {
  const identity = claimedIdentity ?? identityOf(candidate)
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

export function planIdentityClaim(
  catalog: readonly Track[],
  candidateTrackId: string,
  identity: TrackIdentity,
): IdentityClaimDecision {
  const candidate = catalog.find(({ trackId }) => trackId === candidateTrackId)
  if (candidate === undefined) {
    throw new IdentityClaimError('identity_claim.candidate_missing')
  }

  const owner = selectPreferredIdentityOwner(catalog, candidate, identity)
  if (owner === undefined) {
    return Object.freeze({ kind: 'claim-candidate', trackId: candidateTrackId })
  }

  const kind = owner.status === 'ready'
    ? 'reuse-ready'
    : owner.status === 'processing' || owner.status === 'preparing'
      ? 'await-owner'
      : 'adopt-and-retry'
  return Object.freeze({ kind, ownerTrackId: owner.trackId })
}
