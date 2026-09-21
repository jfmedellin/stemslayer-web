export const TRACK_STATUSES = [
  'preparing',
  'processing',
  'ready',
  'failed',
  'interrupted',
  'unavailable',
] as const

export type TrackStatus = (typeof TRACK_STATUSES)[number]

export interface TrackInput {
  readonly trackId: string
  readonly title: string
  readonly artist: string
  readonly genre: string | null
  readonly durationSeconds: number
  readonly bpm: number | null
  readonly musicalKey: string | null
  readonly createdAtUtc: string
  readonly profileId: string
  readonly pipelineFingerprint: string
  readonly resultKey: string
}

export interface Track extends TrackInput {
  readonly sourceHash?: string
  readonly status: TrackStatus
  readonly errorDetail: string | null
}

export interface TrackMetadataPatch {
  readonly title?: string
  readonly artist?: string
  readonly genre?: string | null
  readonly durationSeconds?: number
  readonly bpm?: number | null
  readonly musicalKey?: string | null
  readonly errorDetail?: string | null
}

export class TrackDomainError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'TrackDomainError'
  }
}

const allowedTransitions: Readonly<Record<TrackStatus, readonly TrackStatus[]>> = {
  preparing: ['processing', 'failed', 'interrupted', 'unavailable'],
  processing: ['ready', 'failed', 'interrupted'],
  ready: ['unavailable'],
  failed: ['preparing', 'unavailable'],
  interrupted: ['preparing', 'unavailable'],
  unavailable: ['preparing'],
}

const mutableMetadata = new Set<keyof TrackMetadataPatch>([
  'title',
  'artist',
  'genre',
  'durationSeconds',
  'bpm',
  'musicalKey',
  'errorDetail',
])

const reject = (code: string): never => {
  throw new TrackDomainError(code)
}

export function createTrack(input: TrackInput): Track {
  return Object.freeze({
    trackId: input.trackId,
    title: input.title,
    artist: input.artist,
    genre: input.genre,
    durationSeconds: input.durationSeconds,
    bpm: input.bpm,
    musicalKey: input.musicalKey,
    createdAtUtc: input.createdAtUtc,
    profileId: input.profileId,
    pipelineFingerprint: input.pipelineFingerprint,
    resultKey: input.resultKey,
    status: 'preparing',
    errorDetail: null,
  })
}

export function assignTrackSourceHash(track: Track, sourceHash: string): Track {
  if (track.sourceHash === sourceHash) return track
  if (track.sourceHash !== undefined) reject('track.identity_immutable')
  return Object.freeze({ ...track, sourceHash })
}

export function transitionTrack(track: Track, nextStatus: TrackStatus): Track {
  if (!allowedTransitions[track.status].includes(nextStatus)) {
    reject('track.illegal_transition')
  }
  return Object.freeze({ ...track, status: nextStatus })
}

export function updateTrackMetadata(
  track: Track,
  patch: TrackMetadataPatch,
): Track {
  if (Object.keys(patch).some((field) => !mutableMetadata.has(field as keyof TrackMetadataPatch))) {
    reject('track.identity_immutable')
  }
  return Object.freeze({ ...track, ...patch })
}
