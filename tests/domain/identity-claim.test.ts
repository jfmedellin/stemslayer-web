import { describe, expect, test } from 'vitest'

import {
  IdentityClaimError,
  hasIdentity,
  identityOf,
  planIdentityClaim,
  selectPreferredIdentityOwner,
  type TrackIdentity,
} from '../../src/domain/identity-claim'
import {
  assignTrackSourceHash,
  createTrack,
  transitionTrack,
  type Track,
  type TrackInput,
  type TrackStatus,
} from '../../src/domain/track'

const baseInput: TrackInput = {
  trackId: 'candidate',
  title: 'Song',
  artist: 'Artist',
  genre: 'Rock',
  durationSeconds: 240,
  bpm: null,
  musicalKey: null,
  createdAtUtc: '2026-09-21T12:00:00.000Z',
  profileId: 'legacy-four-stem',
  pipelineFingerprint: 'pipeline-a',
  resultKey: 'stems/candidate',
}

const statusPath: Readonly<Record<TrackStatus, readonly TrackStatus[]>> = {
  preparing: [],
  processing: ['processing'],
  ready: ['processing', 'ready'],
  failed: ['failed'],
  interrupted: ['interrupted'],
  unavailable: ['unavailable'],
}

function track(
  trackId: string,
  status: TrackStatus = 'preparing',
  createdAtUtc = baseInput.createdAtUtc,
  sourceHash: string | null = 'source-a',
  pipelineFingerprint = 'pipeline-a',
): Track {
  let value = createTrack({
    ...baseInput,
    trackId,
    createdAtUtc,
    pipelineFingerprint,
    resultKey: `stems/${trackId}`,
  })
  if (sourceHash !== null) value = assignTrackSourceHash(value, sourceHash)
  for (const nextStatus of statusPath[status]) value = transitionTrack(value, nextStatus)
  return value
}

describe('track identity', () => {
  const identity: TrackIdentity = {
    sourceHash: 'source-a',
    pipelineFingerprint: 'pipeline-a',
  }

  test('extracts both identity fields only after source hashing', () => {
    expect(identityOf(track('unhashed', 'preparing', baseInput.createdAtUtc, null))).toBeUndefined()
    expect(identityOf(track('identified'))).toEqual(identity)
  })

  test.each([
    ['same identity', track('same'), true],
    ['missing source hash', track('missing', 'preparing', baseInput.createdAtUtc, null), false],
    ['different source hash', track('source', 'preparing', baseInput.createdAtUtc, 'source-b'), false],
    ['different pipeline', track('pipeline', 'preparing', baseInput.createdAtUtc, 'source-a', 'pipeline-b'), false],
  ])('matches exact source and pipeline for %s', (_name, value, expected) => {
    expect(hasIdentity(value, identity)).toBe(expected)
  })
})

describe('preferred identity owner', () => {
  const candidate = track('candidate')

  test('returns no owner when no competitor has the exact identity', () => {
    expect(selectPreferredIdentityOwner([
      track('missing', 'ready', baseInput.createdAtUtc, null),
      track('source', 'ready', baseInput.createdAtUtc, 'source-b'),
      track('pipeline', 'ready', baseInput.createdAtUtc, 'source-a', 'pipeline-b'),
    ], candidate)).toBeUndefined()
  })

  test('excludes the candidate by trackId', () => {
    const candidateCopy = track('candidate', 'ready', '2026-09-21T15:00:00.000Z')
    const competitor = track('competitor', 'failed')

    expect(selectPreferredIdentityOwner([candidateCopy, competitor], candidate)).toBe(competitor)
  })

  test.each([
    ['ready', 'processing'],
    ['processing', 'preparing'],
    ['preparing', 'failed'],
    ['preparing', 'interrupted'],
    ['preparing', 'unavailable'],
  ] as const satisfies ReadonlyArray<readonly [TrackStatus, TrackStatus]>) (
    'ranks %s above %s regardless of age',
    (preferredStatus, lowerStatus) => {
      const preferred = track('preferred', preferredStatus, '2026-09-21T10:00:00.000Z')
      const lower = track('lower', lowerStatus, '2026-09-21T16:00:00.000Z')

      expect(selectPreferredIdentityOwner([lower, preferred], candidate)).toBe(preferred)
    },
  )

  test('selects the newest owner within one rank', () => {
    const older = track('older', 'ready', '2026-09-21T10:00:00.000Z')
    const newer = track('newer', 'ready', '2026-09-21T11:00:00.000Z')

    expect(selectPreferredIdentityOwner([older, newer], candidate)).toBe(newer)
  })

  test('groups terminal statuses at one rank before comparing timestamps', () => {
    const failed = track('failed', 'failed', '2026-09-21T10:00:00.000Z')
    const unavailable = track('unavailable', 'unavailable', '2026-09-21T11:00:00.000Z')

    expect(selectPreferredIdentityOwner([failed, unavailable], candidate)).toBe(unavailable)
  })

  test('preserves catalog order as the final tie-break', () => {
    const first = track('first', 'processing')
    const second = track('second', 'processing')

    expect(selectPreferredIdentityOwner([first, second], candidate)).toBe(first)
    expect(selectPreferredIdentityOwner([second, first], candidate)).toBe(second)
  })

  test('does not mutate the catalog or its tracks', () => {
    const first = track('first', 'failed')
    const second = track('second', 'ready')
    const catalog = Object.freeze([first, second])
    const before = JSON.stringify(catalog)

    expect(selectPreferredIdentityOwner(catalog, candidate)).toBe(second)
    expect(JSON.stringify(catalog)).toBe(before)
    expect(catalog).toEqual([first, second])
  })
})

describe('identity claim planning', () => {
  const identity: TrackIdentity = {
    sourceHash: 'source-a',
    pipelineFingerprint: 'pipeline-a',
  }
  const candidate = track('candidate')

  test('rejects a missing candidate deterministically', () => {
    expect(() => planIdentityClaim([], 'missing', identity)).toThrowError(IdentityClaimError)
    try {
      planIdentityClaim([], 'missing', identity)
    } catch (error) {
      expect(error).toMatchObject({ code: 'identity_claim.candidate_missing' })
    }
  })

  test.each([
    ['no owner', []],
    ['different source', [track('source', 'ready', baseInput.createdAtUtc, 'source-b')]],
    ['different pipeline', [track('pipeline', 'ready', baseInput.createdAtUtc, 'source-a', 'pipeline-b')]],
  ] as const)('plans claim-candidate for %s', (_reason, competitors) => {
    expect(planIdentityClaim([candidate, ...competitors], candidate.trackId, identity)).toEqual({
      kind: 'claim-candidate',
      trackId: candidate.trackId,
    })
  })

  test.each([
    ['ready', 'reuse-ready'],
    ['processing', 'await-owner'],
    ['preparing', 'await-owner'],
    ['failed', 'adopt-and-retry'],
    ['interrupted', 'adopt-and-retry'],
    ['unavailable', 'adopt-and-retry'],
  ] as const satisfies ReadonlyArray<readonly [TrackStatus, string]>) (
    'plans %s owner as %s',
    (status, kind) => {
      const owner = track('owner', status)

      expect(planIdentityClaim([candidate, owner], candidate.trackId, identity)).toEqual({
        kind,
        ownerTrackId: owner.trackId,
      })
    },
  )

  test('does not mutate the catalog or tracks while planning', () => {
    const owner = track('owner', 'ready')
    const catalog = Object.freeze([candidate, owner])
    const before = JSON.stringify(catalog)

    expect(planIdentityClaim(catalog, candidate.trackId, identity).kind).toBe('reuse-ready')
    expect(JSON.stringify(catalog)).toBe(before)
    expect(catalog).toEqual([candidate, owner])
  })
})
