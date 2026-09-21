import { createHash } from 'node:crypto'

import { describe, expect, test } from 'vitest'

import { createPipelineFingerprint } from '../../src/application/create-pipeline-fingerprint'
import type { HashPort } from '../../src/application/ports/hash-port'
import {
  BASIC_PROFILE,
  ROCK_PROFILE,
  createStemProfile,
} from '../../src/domain/stem-profile'

const nodeHash: HashPort = {
  sha256: async (input) => createHash('sha256').update(input).digest('hex'),
}

describe('createPipelineFingerprint', () => {
  test.each([
    ['Basic', BASIC_PROFILE, '2b0c71ec79d6c660c43842a8f45c99f4fbddf22e8cb5a81e4105a8284743ca69'],
    ['Rock', ROCK_PROFILE, 'dc80db8098e29c07b43c90ca38bba381433ad6c3c3a43e096521773ff4813351'],
  ] as const)('matches the known %s digest', async (_name, profile, digest) => {
    await expect(createPipelineFingerprint(profile, nodeHash)).resolves.toBe(digest)
  })

  test('hashes canonical UTF-8 bytes without whitespace', async () => {
    let captured: Uint8Array | undefined
    const hash: HashPort = {
      sha256: async (input) => {
        captured = input
        return 'fingerprint'
      },
    }

    await expect(createPipelineFingerprint(BASIC_PROFILE, hash)).resolves.toBe('fingerprint')
    expect(new TextDecoder().decode(captured)).toBe(
      '{"lanes":["vocals","drums","bass","other"],"primary_model":"htdemucs",' +
      '"profile_id":"legacy-four-stem","raw_outputs":["vocals","drums","bass","other"],' +
      '"residual_sources":[],"schema":1,"specialist_id":null,"specialist_input":null,' +
      '"split_input":null,"splitter_id":null}',
    )
  })

  test('excludes cosmetic profile and lane labels', async () => {
    const renamed = createStemProfile({
      ...BASIC_PROFILE,
      displayName: 'Renamed Profile',
      note: 'Changed presentation only',
      lanes: BASIC_PROFILE.lanes.map((lane) => ({
        ...lane,
        displayName: `Renamed ${lane.laneId}`,
      })),
    })

    await expect(createPipelineFingerprint(renamed, nodeHash)).resolves.toBe(
      await createPipelineFingerprint(BASIC_PROFILE, nodeHash),
    )
  })

  test('changes when a pipeline field changes', async () => {
    const revised = createStemProfile({ ...ROCK_PROFILE, splitterId: 'center-sides-v2' })

    await expect(createPipelineFingerprint(revised, nodeHash)).resolves.not.toBe(
      await createPipelineFingerprint(ROCK_PROFILE, nodeHash),
    )
  })
})
