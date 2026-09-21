import { describe, expect, test } from 'vitest'

import {
  BASIC_PROFILE,
  ProfileValidationError,
  ROCK_PROFILE,
  canonicalPipelineIdentity,
  createStemProfile,
  type StemProfileInput,
} from '../../src/domain/stem-profile'

const validProfile = (overrides: Partial<StemProfileInput> = {}) =>
  createStemProfile({
    profileId: 'test-profile',
    displayName: 'Test',
    lanes: [
      { laneId: 'vocals', displayName: 'Vocals' },
      { laneId: 'other', displayName: 'Other', residual: true },
    ],
    primaryModel: 'test-model',
    rawOutputs: ['vocals', 'other'],
    ...overrides,
  })

describe('published stem profiles', () => {
  test('Basic preserves the four-stem model layout', () => {
    expect(BASIC_PROFILE.profileId).toBe('legacy-four-stem')
    expect(BASIC_PROFILE.displayName).toBe('Basic')
    expect(BASIC_PROFILE.primaryModel).toBe('htdemucs')
    expect(BASIC_PROFILE.rawOutputs).toEqual(['vocals', 'drums', 'bass', 'other'])
    expect(BASIC_PROFILE.lanes.map(({ laneId }) => laneId)).toEqual([
      'vocals', 'drums', 'bass', 'other',
    ])
    expect(BASIC_PROFILE.lanes.at(-1)?.residual).toBe(true)
    expect(BASIC_PROFILE.residualSources).toEqual([])
  })

  test('Rock preserves six raw outputs and publishes positional guitar lanes', () => {
    expect(ROCK_PROFILE.profileId).toBe('metal-stereo-six-stem')
    expect(ROCK_PROFILE.displayName).toBe('Rock')
    expect(ROCK_PROFILE.primaryModel).toBe('htdemucs_6s')
    expect(ROCK_PROFILE.rawOutputs).toEqual([
      'vocals', 'drums', 'bass', 'guitar', 'piano', 'other',
    ])
    expect(ROCK_PROFILE.lanes.map(({ laneId }) => laneId)).toEqual([
      'vocals', 'drums', 'bass', 'guitar_center', 'guitar_sides', 'other',
    ])
    expect(ROCK_PROFILE.residualSources).toEqual(['piano', 'other'])
    expect(ROCK_PROFILE.splitInput).toBe('guitar')
    expect(ROCK_PROFILE.splitterId).toBe('center-sides-v1')
    expect(ROCK_PROFILE.lanes.filter(({ roleGroup }) => roleGroup === 'guitar')).toMatchObject([
      { laneId: 'guitar_center', displayName: 'Guitar Center', absentable: true },
      { laneId: 'guitar_sides', displayName: 'Guitar Sides', absentable: true },
    ])
  })
})

describe('profile validation', () => {
  test.each([
    ['profile.empty', { lanes: [] }],
    ['profile.duplicate_lane', {
      lanes: [
        { laneId: 'vocals', displayName: 'Vocals' },
        { laneId: 'vocals', displayName: 'Vocals Again' },
      ],
    }],
    ['profile.multiple_residuals', {
      lanes: [
        { laneId: 'vocals', displayName: 'Vocals', residual: true },
        { laneId: 'other', displayName: 'Other', residual: true },
      ],
    }],
    ['profile.unknown_residual_source', { residualSources: ['piano'] }],
    ['profile.missing_residual_lane', {
      lanes: [{ laneId: 'vocals', displayName: 'Vocals' }],
      residualSources: ['vocals'],
    }],
    ['profile.unknown_split_input', { splitInput: 'guitar', splitterId: 'split-v1' }],
    ['profile.missing_splitter', { splitInput: 'vocals' }],
  ] satisfies ReadonlyArray<readonly [string, Partial<StemProfileInput>]>) (
    'rejects invalid definitions with %s',
    (code, overrides) => {
      expect(() => validProfile(overrides)).toThrowError(ProfileValidationError)
      try {
        validProfile(overrides)
      } catch (error) {
        expect(error).toMatchObject({ code })
      }
    },
  )
})

describe('canonical pipeline identity', () => {
  test('serializes Basic with the desktop-compatible field order', () => {
    expect(canonicalPipelineIdentity(BASIC_PROFILE)).toBe(
      '{"lanes":["vocals","drums","bass","other"],"primary_model":"htdemucs",' +
      '"profile_id":"legacy-four-stem","raw_outputs":["vocals","drums","bass","other"],' +
      '"residual_sources":[],"schema":1,"specialist_id":null,"specialist_input":null,' +
      '"split_input":null,"splitter_id":null}',
    )
  })

  test('serializes Rock with explicit nulls and ordered arrays', () => {
    expect(canonicalPipelineIdentity(ROCK_PROFILE)).toBe(
      '{"lanes":["vocals","drums","bass","guitar_center","guitar_sides","other"],' +
      '"primary_model":"htdemucs_6s","profile_id":"metal-stereo-six-stem",' +
      '"raw_outputs":["vocals","drums","bass","guitar","piano","other"],' +
      '"residual_sources":["piano","other"],"schema":1,"specialist_id":null,' +
      '"specialist_input":null,"split_input":"guitar","splitter_id":"center-sides-v1"}',
    )
  })
})
