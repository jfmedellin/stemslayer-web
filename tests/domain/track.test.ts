import { describe, expect, test } from 'vitest'

import {
  TRACK_STATUSES,
  TrackDomainError,
  assignTrackSourceHash,
  createTrack,
  transitionTrack,
  updateTrackMetadata,
  type Track,
  type TrackInput,
  type TrackStatus,
} from '../../src/domain/track'

const input: TrackInput = {
  trackId: 'track-1',
  title: 'Song',
  artist: 'Artist',
  genre: 'Rock',
  durationSeconds: 245.5,
  bpm: null,
  musicalKey: null,
  createdAtUtc: '2026-09-21T12:00:00.000Z',
  profileId: 'metal-stereo-six-stem',
  pipelineFingerprint: 'pipeline-fingerprint',
  resultKey: 'stems/track-1',
}

const pathsToStatus: Readonly<Record<TrackStatus, readonly TrackStatus[]>> = {
  preparing: [],
  processing: ['processing'],
  ready: ['processing', 'ready'],
  failed: ['failed'],
  interrupted: ['interrupted'],
  unavailable: ['unavailable'],
}

const trackAt = (status: TrackStatus): Track => {
  let track = createTrack(input)
  for (const nextStatus of pathsToStatus[status]) {
    track = transitionTrack(track, nextStatus)
  }
  return track
}

const allowedTransitions = [
  ['preparing', 'processing'],
  ['preparing', 'failed'],
  ['preparing', 'interrupted'],
  ['preparing', 'unavailable'],
  ['processing', 'ready'],
  ['processing', 'failed'],
  ['processing', 'interrupted'],
  ['ready', 'unavailable'],
  ['failed', 'preparing'],
  ['failed', 'unavailable'],
  ['interrupted', 'preparing'],
  ['interrupted', 'unavailable'],
  ['unavailable', 'preparing'],
] as const satisfies ReadonlyArray<readonly [TrackStatus, TrackStatus]>

const allowedKeys = new Set(allowedTransitions.map(([from, to]) => `${from}:${to}`))
const rejectedTransitions = TRACK_STATUSES.flatMap((from) =>
  TRACK_STATUSES
    .filter((to) => from !== to && !allowedKeys.has(`${from}:${to}`))
    .map((to) => [from, to] as const),
)

describe('track creation', () => {
  test('creates the complete mapped record in preparing state', () => {
    expect(createTrack(input)).toEqual({
      ...input,
      status: 'preparing',
      errorDetail: null,
    })
  })

  test('keeps sourceHash absent until identity assignment', () => {
    expect('sourceHash' in createTrack(input)).toBe(false)
  })
})

describe('track status transitions', () => {
  test.each(allowedTransitions)('allows %s -> %s', (from, to) => {
    expect(transitionTrack(trackAt(from), to).status).toBe(to)
  })

  test.each(rejectedTransitions)('rejects %s -> %s', (from, to) => {
    expect(() => transitionTrack(trackAt(from), to)).toThrowError(TrackDomainError)
    try {
      transitionTrack(trackAt(from), to)
    } catch (error) {
      expect(error).toMatchObject({ code: 'track.illegal_transition' })
    }
  })

  test.each(TRACK_STATUSES)('does not treat %s -> same status as a transition', (status) => {
    expect(() => transitionTrack(trackAt(status), status)).toThrowError(
      expect.objectContaining({ code: 'track.illegal_transition' }),
    )
  })
})

describe('track metadata and identity', () => {
  test('updates mutable metadata without changing status or identity', () => {
    const track = assignTrackSourceHash(createTrack(input), 'source-hash')
    const updated = updateTrackMetadata(track, {
      title: 'Renamed Song',
      errorDetail: 'Actionable detail',
    })

    expect(updated).toMatchObject({
      title: 'Renamed Song',
      errorDetail: 'Actionable detail',
      status: 'preparing',
      trackId: track.trackId,
      sourceHash: track.sourceHash,
      profileId: track.profileId,
      pipelineFingerprint: track.pipelineFingerprint,
      resultKey: track.resultKey,
    })
  })

  test.each([
    'trackId',
    'sourceHash',
    'profileId',
    'pipelineFingerprint',
    'resultKey',
    'status',
  ])('rejects %s in a metadata patch', (field) => {
    expect(() => updateTrackMetadata(createTrack(input), { [field]: 'changed' })).toThrowError(
      expect.objectContaining({ code: 'track.identity_immutable' }),
    )
  })

  test('assigns sourceHash once and rejects a different value', () => {
    const identified = assignTrackSourceHash(createTrack(input), 'source-hash')

    expect(identified.sourceHash).toBe('source-hash')
    expect(assignTrackSourceHash(identified, 'source-hash')).toBe(identified)
    expect(() => assignTrackSourceHash(identified, 'different-hash')).toThrowError(
      expect.objectContaining({ code: 'track.identity_immutable' }),
    )
  })

  test('preserves identity through every status transition', () => {
    const identified = assignTrackSourceHash(createTrack(input), 'source-hash')
    const processing = transitionTrack(identified, 'processing')
    const ready = transitionTrack(processing, 'ready')

    for (const field of [
      'trackId',
      'sourceHash',
      'profileId',
      'pipelineFingerprint',
      'resultKey',
    ] as const) {
      expect(ready[field]).toBe(identified[field])
    }
  })
})
