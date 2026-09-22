import type { StemProfile } from '../../domain/stem-profile'
import type { ModelFootprint } from '../../application/ports/model-store-port'
import { formatBytes } from '../format/format-bytes'

export interface ProfileCardProps {
  readonly profile: StemProfile
  /** `null` while the footprint hasn't resolved yet. */
  readonly footprint: ModelFootprint | null
  readonly selected: boolean
  readonly onSelect: () => void
}

function footprintLabel(footprint: ModelFootprint | null): string {
  if (footprint === null) return 'Checking cache…'
  return footprint.cached ? 'Cached' : `${formatBytes(footprint.sizeBytes)} to download`
}

/** One selectable profile card: stem list plus its cached/download-size readout. */
export function ProfileCard({ profile, footprint, selected, onSelect }: ProfileCardProps) {
  const stemNames = profile.lanes.map((lane) => lane.displayName).join(', ')

  return (
    <button type="button" className="profile-card" aria-pressed={selected} onClick={onSelect}>
      <p className="profile-card-name">{profile.displayName}</p>
      <p className="profile-card-stems">{stemNames}</p>
      <p className="profile-card-footprint">{footprintLabel(footprint)}</p>
    </button>
  )
}
