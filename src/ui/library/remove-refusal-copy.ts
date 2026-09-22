import type { RemoveTrackResult } from '../../application/remove-track'

type RemoveRefusalReason = Extract<RemoveTrackResult, { ok: false }>['reason']

/** Inline copy for a Library row's remove-refusal reasons (`removeTrack`'s own contract). */
export function removeRefusalMessage(reason: RemoveRefusalReason): string {
  switch (reason) {
    case 'not-found':
      return 'This track no longer exists.'
    case 'in-progress':
      return 'Cannot remove while separation is running.'
    case 'unavailable':
      return 'Could not remove stored stems. Retry or remove again.'
  }
}
