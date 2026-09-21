import { planIdentityClaim, type TrackIdentity } from '../domain/identity-claim'
import {
  assignTrackSourceHash,
  createTrack,
  rebindTrackSourceHashForRetry,
  transitionTrack,
  updateTrackMetadata,
  type Track,
} from '../domain/track'
import type { StemProfile } from '../domain/stem-profile'
import { createPipelineFingerprint } from './create-pipeline-fingerprint'
import type { CatalogPort } from './ports/catalog-port'
import type { HashPort } from './ports/hash-port'
import type { LockPort } from './ports/lock-port'
import type { ModelStorePort } from './ports/model-store-port'
import type { QuotaPort } from './ports/quota-port'

const IDENTITY_CLAIM_LOCK_KEY = 'stemslayer:identity-claim'

// docs/decisions/browser-storage.md section 2: 44,100 samples/s * 4 bytes
// (float32) * 2 channels * 60 s/min * 5 min, per stem, for a worst-case
// 5-minute-song forecast (duration is unknown before decoding).
const STEM_BYTES_PER_LANE_FIVE_MINUTES = 105_840_000

export class AddToLibraryError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'AddToLibraryError'
  }
}

export interface AddToLibraryInput {
  readonly bytes: Uint8Array
  readonly fileName: string
  readonly profile: StemProfile
}

export interface AddToLibraryDeps {
  readonly catalog: CatalogPort
  readonly modelStore: ModelStorePort
  readonly quota: QuotaPort
  readonly lock: LockPort
  readonly hash: HashPort
  readonly generateTrackId: () => string
  readonly now: () => string
}

export type AddToLibraryResult =
  | Readonly<{ decision: 'claimed'; track: Track }>
  | Readonly<{ decision: 'reused'; track: Track }>
  | Readonly<{ decision: 'awaiting'; track: Track }>
  | Readonly<{ decision: 'adopted'; track: Track }>
  | Readonly<{ decision: 'quota-refused'; forecastBytes: number; availableBytes: number }>

function titleFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^./]+$/, '')
  return withoutExtension.length > 0 ? withoutExtension : fileName
}

function stemSetForecastBytes(profile: StemProfile): number {
  return profile.lanes.length * STEM_BYTES_PER_LANE_FIVE_MINUTES
}

export async function addToLibrary(
  input: AddToLibraryInput,
  deps: AddToLibraryDeps,
): Promise<AddToLibraryResult> {
  const sourceHash = await deps.hash.sha256(input.bytes)
  const pipelineFingerprint = await createPipelineFingerprint(input.profile, deps.hash)
  const identity: TrackIdentity = { sourceHash, pipelineFingerprint }

  const footprint = await deps.modelStore.getFootprint(input.profile.profileId)
  const forecastBytes = stemSetForecastBytes(input.profile)
    + (footprint.cached ? 0 : footprint.sizeBytes)
  const availableBytes = await deps.quota.availableBytes()
  if (availableBytes < forecastBytes) {
    return Object.freeze({ decision: 'quota-refused', forecastBytes, availableBytes })
  }

  return deps.lock.withLock(IDENTITY_CLAIM_LOCK_KEY, async (): Promise<AddToLibraryResult> => {
    const snapshot = await deps.catalog.listAll()
    const trackId = deps.generateTrackId()
    const candidate = createTrack({
      trackId,
      title: titleFromFileName(input.fileName),
      artist: 'Unknown artist',
      genre: null,
      durationSeconds: 0,
      bpm: null,
      musicalKey: null,
      createdAtUtc: deps.now(),
      profileId: input.profile.profileId,
      pipelineFingerprint,
      resultKey: `stems/${trackId}`,
    })

    const decision = planIdentityClaim([...snapshot, candidate], trackId, identity)

    if (decision.kind === 'claim-candidate') {
      const claimed = assignTrackSourceHash(candidate, sourceHash)
      await deps.catalog.insert(claimed)
      return Object.freeze({ decision: 'claimed', track: claimed })
    }

    const owner = snapshot.find((track) => track.trackId === decision.ownerTrackId)
    if (owner === undefined) {
      throw new AddToLibraryError(`add-to-library.owner_missing:${decision.ownerTrackId}`)
    }

    if (decision.kind === 'reuse-ready') {
      return Object.freeze({ decision: 'reused', track: owner })
    }
    if (decision.kind === 'await-owner') {
      return Object.freeze({ decision: 'awaiting', track: owner })
    }

    const rebound = rebindTrackSourceHashForRetry(owner, sourceHash)
    const preparing = transitionTrack(rebound, 'preparing')
    const adopted = updateTrackMetadata(preparing, { errorDetail: null })
    await deps.catalog.update(adopted)
    return Object.freeze({ decision: 'adopted', track: adopted })
  })
}
