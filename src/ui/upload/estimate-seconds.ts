import { BASIC_PROFILE, ROCK_PROFILE } from '../../domain/stem-profile'

// docs/decisions/spike-s2.md, "Product promise": ~25s Rock / ~36s Basic for
// a 4-minute (240s) song on a WebGPU-capable desktop.
const BASELINE_SONG_SECONDS = 240
const BASELINE_ESTIMATE_SECONDS: Readonly<Record<string, number>> = {
  [ROCK_PROFILE.profileId]: 25,
  [BASIC_PROFILE.profileId]: 36,
}

/** Scales spike-s2's 4-minute-song baseline estimate by the loaded file's actual duration. */
export function estimateSeparationSeconds(profileId: string, durationSeconds: number): number {
  const baseline = BASELINE_ESTIMATE_SECONDS[profileId]
  if (baseline === undefined) return 0
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return baseline
  return (baseline / BASELINE_SONG_SECONDS) * durationSeconds
}
