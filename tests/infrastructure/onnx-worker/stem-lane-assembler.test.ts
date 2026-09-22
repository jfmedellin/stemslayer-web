import { describe, expect, it } from 'vitest'

import { BASIC_PROFILE, ROCK_PROFILE, createStemProfile } from '../../../src/domain/stem-profile'
import {
  StemLaneAssemblyError,
  assembleStemLanes,
  type NamedRawStem,
} from '../../../src/infrastructure/onnx-worker/stem-lane-assembler'

const stereo = (left: readonly number[], right: readonly number[]): readonly Float32Array[] => [
  new Float32Array(left),
  new Float32Array(right),
]

const raw = (rawId: string, left: readonly number[], right: readonly number[]): NamedRawStem => ({
  rawId,
  channels: stereo(left, right),
})

const constantRaw = (rawId: string, value: number): NamedRawStem => raw(rawId, [value, value], [value, value])

describe('assembleStemLanes', () => {
  it('reorders Basic model outputs into immutable owned profile lanes', () => {
    const inputs = [
      constantRaw('drums', 1),
      constantRaw('bass', 2),
      constantRaw('other', 3),
      constantRaw('vocals', 4),
    ]

    const result = assembleStemLanes(BASIC_PROFILE, inputs)

    expect(result.map(({ laneId }) => laneId)).toEqual(['vocals', 'drums', 'bass', 'other'])
    expect(result.map(({ channels }) => channels[0][0])).toEqual([4, 1, 2, 3])
    expect(Object.isFrozen(result)).toBe(true)
    expect(result.every((lane) => Object.isFrozen(lane) && Object.isFrozen(lane.channels))).toBe(true)
    expect(result[1].channels[0]).not.toBe(inputs[0].channels[0])

    result[1].channels[0][0] = 99
    expect(inputs[0].channels[0][0]).toBe(1)
  })

  it('assembles Rock residual and center/sides lanes without publishing raw guitar or piano', () => {
    const inputs = [
      raw('drums', [1, 1, 1], [1, 1, 1]),
      raw('bass', [2, 2, 2], [2, 2, 2]),
      raw('other', [10, -2, 0.25], [20, 4, -0.5]),
      raw('vocals', [4, 4, 4], [4, 4, 4]),
      raw('guitar', [6, -4, 0.5], [2, 8, -1.5]),
      raw('piano', [1, 3, 0.75], [-5, 2, 1.5]),
    ]

    const result = assembleStemLanes(ROCK_PROFILE, inputs)
    const byId = Object.fromEntries(result.map((lane) => [lane.laneId, lane.channels]))

    expect(result.map(({ laneId }) => laneId)).toEqual([
      'vocals', 'drums', 'bass', 'guitar_center', 'guitar_sides', 'other',
    ])
    expect(result.some(({ laneId }) => laneId === 'guitar' || laneId === 'piano')).toBe(false)
    expect([...byId.guitar_center[0]]).toEqual([4, 2, -0.5])
    expect([...byId.guitar_center[1]]).toEqual([4, 2, -0.5])
    expect([...byId.guitar_sides[0]]).toEqual([2, -6, 1])
    expect([...byId.guitar_sides[1]]).toEqual([-2, 6, -1])
    expect([...byId.other[0]]).toEqual([11, 1, 1])
    expect([...byId.other[1]]).toEqual([15, 6, 1])
  })

  it('reconstructs representative finite guitar samples from center plus sides', () => {
    const left = Float32Array.from({ length: 97 }, (_, index) => Math.sin(index * 0.37) * 7)
    const right = Float32Array.from({ length: 97 }, (_, index) => Math.cos(index * 0.23) * 5)
    const inputs = ROCK_PROFILE.rawOutputs.map((rawId) =>
      rawId === 'guitar'
        ? { rawId, channels: [left, right] }
        : raw(rawId, new Array(97).fill(0), new Array(97).fill(0)),
    )

    const result = assembleStemLanes(ROCK_PROFILE, inputs)
    const center = result.find(({ laneId }) => laneId === 'guitar_center')!
    const sides = result.find(({ laneId }) => laneId === 'guitar_sides')!

    for (let index = 0; index < left.length; index += 1) {
      expect(center.channels[0][index] + sides.channels[0][index]).toBeCloseTo(left[index], 5)
      expect(center.channels[1][index] + sides.channels[1][index]).toBeCloseTo(right[index], 5)
    }
  })

  it.each([
    ['unknown profile', createStemProfile({
      profileId: 'custom', displayName: 'Custom', lanes: [{ laneId: 'vocals', displayName: 'Vocals' }],
      primaryModel: 'custom', rawOutputs: ['vocals'],
    }), [constantRaw('vocals', 1)], 'stem-lane-assembler.unknown_profile:custom'],
    ['unknown splitter', createStemProfile({
      profileId: ROCK_PROFILE.profileId, displayName: 'Rock', lanes: ROCK_PROFILE.lanes,
      primaryModel: ROCK_PROFILE.primaryModel, rawOutputs: ROCK_PROFILE.rawOutputs,
      residualSources: ROCK_PROFILE.residualSources, splitInput: 'guitar', splitterId: 'future-splitter',
    }), ROCK_PROFILE.rawOutputs.map((id) => constantRaw(id, 1)), 'stem-lane-assembler.unknown_splitter:future-splitter'],
    ['missing output', BASIC_PROFILE, BASIC_PROFILE.rawOutputs.slice(1).map((id) => constantRaw(id, 1)), 'stem-lane-assembler.missing_raw_output:vocals'],
    ['duplicate output', BASIC_PROFILE, [...BASIC_PROFILE.rawOutputs.map((id) => constantRaw(id, 1)), constantRaw('vocals', 2)], 'stem-lane-assembler.duplicate_raw_output:vocals'],
    ['unexpected output', BASIC_PROFILE, [...BASIC_PROFILE.rawOutputs.map((id) => constantRaw(id, 1)), constantRaw('piano', 2)], 'stem-lane-assembler.unexpected_raw_output:piano'],
  ])('rejects %s', (_label, profile, inputs, message) => {
    expect(() => assembleStemLanes(profile, inputs)).toThrowError(new StemLaneAssemblyError(message))
  })

  it.each([
    ['Basic mono stems', BASIC_PROFILE, BASIC_PROFILE.rawOutputs.map((id) => ({
      rawId: id,
      channels: [new Float32Array([1, 2])],
    })), 'stem-lane-assembler.non_stereo:drums'],
    ['non-stereo split input', ROCK_PROFILE, ROCK_PROFILE.rawOutputs.map((id) => id === 'guitar'
      ? { rawId: id, channels: [new Float32Array([1])] }
      : constantRaw(id, 1)), 'stem-lane-assembler.non_stereo:guitar'],
    ['unequal channel frames', BASIC_PROFILE, BASIC_PROFILE.rawOutputs.map((id) => id === 'bass'
      ? raw(id, [1, 2], [1])
      : constantRaw(id, 1)), 'stem-lane-assembler.channel_length_mismatch:bass'],
    ['unequal stem frames', BASIC_PROFILE, BASIC_PROFILE.rawOutputs.map((id) => id === 'bass'
      ? raw(id, [1, 2, 3], [1, 2, 3])
      : constantRaw(id, 1)), 'stem-lane-assembler.frame_length_mismatch:bass'],
    ['non-finite input', BASIC_PROFILE, BASIC_PROFILE.rawOutputs.map((id) => id === 'bass'
      ? raw(id, [1, Number.NaN], [1, 2])
      : constantRaw(id, 1)), 'stem-lane-assembler.non_finite:bass'],
  ])('rejects %s before producing output', (_label, profile, inputs, message) => {
    expect(() => assembleStemLanes(profile, inputs))
      .toThrowError(new StemLaneAssemblyError(message))
  })

  it('rejects a non-finite transformed residual', () => {
    const inputs = ROCK_PROFILE.rawOutputs.map((id) => id === 'piano'
      ? raw(id, [3.4e38, 0], [0, 0])
      : id === 'other'
        ? raw(id, [3.4e38, 0], [0, 0])
        : raw(id, [0, 0], [0, 0]))

    expect(() => assembleStemLanes(ROCK_PROFILE, inputs))
      .toThrowError(new StemLaneAssemblyError('stem-lane-assembler.non_finite_output:other'))
  })

  it('does not mutate any Rock inference input', () => {
    const inputs = ROCK_PROFILE.rawOutputs.map((id, index) => constantRaw(id, index + 1))
    const snapshots = inputs.map(({ channels }) => channels.map((channel) => [...channel]))

    assembleStemLanes(ROCK_PROFILE, inputs)

    expect(inputs.map(({ channels }) => channels.map((channel) => [...channel]))).toEqual(snapshots)
  })
})
