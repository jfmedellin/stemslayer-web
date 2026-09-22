import type { StemProfile } from '../../domain/stem-profile'

/** Renders the Upload page's primary CTA copy: "Separate · {Profile} · {N} stems". */
export function primaryActionLabel(profile: StemProfile): string {
  return `Separate · ${profile.displayName} · ${profile.lanes.length} stems`
}
