import { canonicalPipelineIdentityBytes } from '../domain/stem-profile'
import type { StemProfile } from '../domain/stem-profile'
import type { HashPort } from './ports/hash-port'

export function createPipelineFingerprint(
  profile: StemProfile,
  hashPort: HashPort,
): Promise<string> {
  return hashPort.sha256(canonicalPipelineIdentityBytes(profile))
}
