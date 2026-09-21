export const PIPELINE_IDENTITY_SCHEMA = 1

export interface StemLaneInput {
  readonly laneId: string
  readonly displayName: string
  readonly roleGroup?: string | null
  readonly residual?: boolean
  readonly absentable?: boolean
}

export interface StemLane {
  readonly laneId: string
  readonly displayName: string
  readonly roleGroup: string | null
  readonly residual: boolean
  readonly absentable: boolean
}

export interface StemProfileInput {
  readonly profileId: string
  readonly displayName: string
  readonly lanes: readonly StemLaneInput[]
  readonly primaryModel: string
  readonly rawOutputs: readonly string[]
  readonly residualSources?: readonly string[]
  readonly specialistId?: string | null
  readonly specialistInput?: string | null
  readonly splitInput?: string | null
  readonly splitterId?: string | null
  readonly note?: string
}

export interface StemProfile {
  readonly profileId: string
  readonly displayName: string
  readonly lanes: readonly StemLane[]
  readonly primaryModel: string
  readonly rawOutputs: readonly string[]
  readonly residualSources: readonly string[]
  readonly specialistId: string | null
  readonly specialistInput: string | null
  readonly splitInput: string | null
  readonly splitterId: string | null
  readonly note: string
}

export class ProfileValidationError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'ProfileValidationError'
  }
}

const reject = (code: string): never => {
  throw new ProfileValidationError(code)
}

export function createStemProfile(input: StemProfileInput): StemProfile {
  if (input.lanes.length === 0) reject('profile.empty')

  const laneIds = input.lanes.map(({ laneId }) => laneId)
  if (new Set(laneIds).size !== laneIds.length) reject('profile.duplicate_lane')
  if (input.lanes.filter(({ residual }) => residual).length > 1) {
    reject('profile.multiple_residuals')
  }

  const residualSources = [...(input.residualSources ?? [])]
  if (residualSources.some((source) => !input.rawOutputs.includes(source))) {
    reject('profile.unknown_residual_source')
  }
  if (residualSources.length > 0 && !input.lanes.some(({ residual }) => residual)) {
    reject('profile.missing_residual_lane')
  }

  const specialistInput = input.specialistInput ?? null
  const specialistId = input.specialistId ?? null
  const splitInput = input.splitInput ?? null
  const splitterId = input.splitterId ?? null
  if (specialistInput !== null && !input.rawOutputs.includes(specialistInput)) {
    reject('profile.unknown_specialist_input')
  }
  if (specialistInput !== null && splitInput !== null) {
    reject('profile.conflicting_decomposition')
  }
  if (splitInput !== null && !input.rawOutputs.includes(splitInput)) {
    reject('profile.unknown_split_input')
  }
  if (splitInput !== null && splitterId === null) reject('profile.missing_splitter')

  const lanes = input.lanes.map((lane) => Object.freeze({
    laneId: lane.laneId,
    displayName: lane.displayName,
    roleGroup: lane.roleGroup ?? null,
    residual: lane.residual ?? false,
    absentable: lane.absentable ?? false,
  }))

  return Object.freeze({
    profileId: input.profileId,
    displayName: input.displayName,
    lanes: Object.freeze(lanes),
    primaryModel: input.primaryModel,
    rawOutputs: Object.freeze([...input.rawOutputs]),
    residualSources: Object.freeze(residualSources),
    specialistId,
    specialistInput,
    splitInput,
    splitterId,
    note: input.note ?? '',
  })
}

export function canonicalPipelineIdentity(profile: StemProfile): string {
  return JSON.stringify({
    lanes: profile.lanes.map(({ laneId }) => laneId),
    primary_model: profile.primaryModel,
    profile_id: profile.profileId,
    raw_outputs: profile.rawOutputs,
    residual_sources: profile.residualSources,
    schema: PIPELINE_IDENTITY_SCHEMA,
    specialist_id: profile.specialistId,
    specialist_input: profile.specialistInput,
    split_input: profile.splitInput,
    splitter_id: profile.splitterId,
  })
}

export function canonicalPipelineIdentityBytes(profile: StemProfile): Uint8Array {
  return new TextEncoder().encode(canonicalPipelineIdentity(profile))
}

export const BASIC_PROFILE = createStemProfile({
  profileId: 'legacy-four-stem',
  displayName: 'Basic',
  lanes: [
    { laneId: 'vocals', displayName: 'Vocals' },
    { laneId: 'drums', displayName: 'Drums' },
    { laneId: 'bass', displayName: 'Bass' },
    { laneId: 'other', displayName: 'Other', residual: true },
  ],
  primaryModel: 'htdemucs',
  rawOutputs: ['vocals', 'drums', 'bass', 'other'],
})

export const ROCK_PROFILE = createStemProfile({
  profileId: 'metal-stereo-six-stem',
  displayName: 'Rock',
  lanes: [
    { laneId: 'vocals', displayName: 'Vocals' },
    { laneId: 'drums', displayName: 'Drums' },
    { laneId: 'bass', displayName: 'Bass' },
    {
      laneId: 'guitar_center',
      displayName: 'Guitar Center',
      roleGroup: 'guitar',
      absentable: true,
    },
    {
      laneId: 'guitar_sides',
      displayName: 'Guitar Sides',
      roleGroup: 'guitar',
      absentable: true,
    },
    { laneId: 'other', displayName: 'Other', residual: true },
  ],
  primaryModel: 'htdemucs_6s',
  rawOutputs: ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'],
  residualSources: ['piano', 'other'],
  splitInput: 'guitar',
  splitterId: 'center-sides-v1',
  note: 'Guitar lanes describe stereo position, not musical roles.',
})
