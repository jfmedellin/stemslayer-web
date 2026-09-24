import { BASIC_PROFILE, ROCK_PROFILE, type StemProfile } from '../../domain/stem-profile'
import { BASIC_STEM_LANES } from './basic-inference'
import { ROCK_STEM_LANES } from './rock-inference'

export interface NamedRawStem {
  readonly rawId: string
  readonly channels: readonly Float32Array[]
}

export interface AssembledStemLane {
  readonly laneId: string
  readonly channels: readonly Float32Array[]
}

export class StemLaneAssemblyError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'StemLaneAssemblyError'
  }
}

interface ValidatedRawStems {
  readonly byId: ReadonlyMap<string, readonly Float32Array[]>
  readonly channelCount: number
  readonly frameCount: number
}

const fail = (code: string): never => {
  throw new StemLaneAssemblyError(`stem-lane-assembler.${code}`)
}

function expectedRawIds(profile: StemProfile): readonly string[] {
  if (profile.profileId === BASIC_PROFILE.profileId) return BASIC_STEM_LANES
  if (profile.profileId === ROCK_PROFILE.profileId) return ROCK_STEM_LANES
  return fail(`unknown_profile:${profile.profileId}`)
}

function validateRawStems(profile: StemProfile, rawStems: readonly NamedRawStem[]): ValidatedRawStems {
  const expected = expectedRawIds(profile)
  const expectedSet = new Set(expected)
  const byId = new Map<string, readonly Float32Array[]>()

  for (const stem of rawStems) {
    if (!expectedSet.has(stem.rawId)) fail(`unexpected_raw_output:${stem.rawId}`)
    if (byId.has(stem.rawId)) fail(`duplicate_raw_output:${stem.rawId}`)
    byId.set(stem.rawId, stem.channels)
  }

  for (const rawId of expected) {
    if (!byId.has(rawId)) fail(`missing_raw_output:${rawId}`)
  }

  for (const rawId of expected) {
    if (byId.get(rawId)!.length !== 2) fail(`non_stereo:${rawId}`)
  }

  const first = byId.get(expected[0])!
  const channelCount = first.length
  const frameCount = first[0]?.length ?? 0
  if (channelCount === 0 || frameCount === 0) fail(`empty_raw_output:${expected[0]}`)

  for (const rawId of expected) {
    const channels = byId.get(rawId)!
    if (channels.length === 0 || channels.some((channel) => channel.length === 0)) {
      fail(`empty_raw_output:${rawId}`)
    }
    if (channels.some((channel) => channel.length !== channels[0].length)) {
      fail(`channel_length_mismatch:${rawId}`)
    }
    if (channels.length !== channelCount || channels[0].length !== frameCount) {
      fail(`frame_length_mismatch:${rawId}`)
    }
    for (const channel of channels) {
      for (const sample of channel) {
        if (!Number.isFinite(sample)) fail(`non_finite:${rawId}`)
      }
    }
  }

  return { byId, channelCount, frameCount }
}

function cloneChannels(channels: readonly Float32Array[]): readonly Float32Array[] {
  return Object.freeze(channels.map((channel) => channel.slice()))
}

function assertFiniteOutput(laneId: string, channels: readonly Float32Array[]): void {
  for (const channel of channels) {
    for (const sample of channel) {
      if (!Number.isFinite(sample)) fail(`non_finite_output:${laneId}`)
    }
  }
}

function sumChannels(
  left: readonly Float32Array[],
  right: readonly Float32Array[],
  channelCount: number,
  frameCount: number,
): readonly Float32Array[] {
  const result = Array.from({ length: channelCount }, (_, channelIndex) => {
    const channel = new Float32Array(frameCount)
    for (let frame = 0; frame < frameCount; frame += 1) {
      channel[frame] = left[channelIndex][frame] + right[channelIndex][frame]
    }
    return channel
  })
  assertFiniteOutput('other', result)
  return Object.freeze(result)
}

function splitCenterSides(guitar: readonly Float32Array[]): ReadonlyMap<string, readonly Float32Array[]> {
  if (guitar.length !== 2) fail('non_stereo:guitar')

  const [left, right] = guitar
  const center = new Float32Array(left.length)
  const side = new Float32Array(left.length)
  for (let frame = 0; frame < left.length; frame += 1) {
    center[frame] = (left[frame] + right[frame]) / 2
    side[frame] = (left[frame] - right[frame]) / 2
  }

  const centerChannels = Object.freeze([center, center.slice()])
  const sidesChannels = Object.freeze([side, Float32Array.from(side, (sample) => -sample)])
  assertFiniteOutput('guitar_center', centerChannels)
  assertFiniteOutput('guitar_sides', sidesChannels)
  return new Map([
    ['guitar_center', centerChannels],
    ['guitar_sides', sidesChannels],
  ])
}

function assembleBasic(profile: StemProfile, raw: ValidatedRawStems): readonly AssembledStemLane[] {
  return Object.freeze(profile.lanes.map(({ laneId }) => Object.freeze({
    laneId,
    channels: cloneChannels(raw.byId.get(laneId)!),
  })))
}

function assembleRock(profile: StemProfile, raw: ValidatedRawStems): readonly AssembledStemLane[] {
  if (profile.splitterId !== 'center-sides-v1') {
    fail(`unknown_splitter:${profile.splitterId ?? 'null'}`)
  }

  const splitLanes = splitCenterSides(raw.byId.get('guitar')!)
  const residual = sumChannels(
    raw.byId.get('piano')!,
    raw.byId.get('other')!,
    raw.channelCount,
    raw.frameCount,
  )

  return Object.freeze(profile.lanes.map(({ laneId }) => {
    const channels = splitLanes.get(laneId)
      ?? (laneId === 'other' ? residual : cloneChannels(raw.byId.get(laneId)!))
    return Object.freeze({ laneId, channels })
  }))
}

/** Converts named raw model stems into owned final lanes in exact profile order. */
export function assembleStemLanes(
  profile: StemProfile,
  rawStems: readonly NamedRawStem[],
): readonly AssembledStemLane[] {
  const raw = validateRawStems(profile, rawStems)
  if (profile.profileId === BASIC_PROFILE.profileId) return assembleBasic(profile, raw)
  if (profile.profileId === ROCK_PROFILE.profileId) return assembleRock(profile, raw)
  return fail(`unknown_profile:${profile.profileId}`)
}
