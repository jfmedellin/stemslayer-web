import { BASIC_PROFILE, ROCK_PROFILE, type StemProfile } from '../domain/stem-profile'

const profilesByProfileId: Readonly<Record<string, StemProfile>> = {
  [BASIC_PROFILE.profileId]: BASIC_PROFILE,
  [ROCK_PROFILE.profileId]: ROCK_PROFILE,
}

export class UnknownProfileError extends Error {
  constructor(readonly profileId: string) {
    super(`resolve-stem-profile.unknown:${profileId}`)
    this.name = 'UnknownProfileError'
  }
}

/**
 * A track only stores its `profileId`; the separation lifecycle needs the
 * full `StemProfile` (lane set) to build an inference job and the expected
 * publish keys, so it is resolved back from the fixed set of web profiles.
 */
export function resolveStemProfile(profileId: string): StemProfile {
  const profile = profilesByProfileId[profileId]
  if (profile === undefined) throw new UnknownProfileError(profileId)
  return profile
}
