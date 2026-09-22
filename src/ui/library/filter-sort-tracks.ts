import type { Track } from '../../domain/track'

export type LibrarySortKey = 'newest' | 'title' | 'duration'

/** Client-side title/artist substring search (`docs/decisions/browser-storage.md` section 1: no LIKE/wildcard IndexedDB query, a hobby-scale catalog fits in memory). */
export function filterTracksBySearch(tracks: readonly Track[], query: string): readonly Track[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (normalized === '') return tracks
  return tracks.filter(
    (track) =>
      track.title.toLocaleLowerCase().includes(normalized)
      || track.artist.toLocaleLowerCase().includes(normalized),
  )
}

/** The three sorts the product kept (`feature-parity.md` line 40: no status/profile filters). */
export function sortTracks(tracks: readonly Track[], sortKey: LibrarySortKey): readonly Track[] {
  const copy = [...tracks]
  switch (sortKey) {
    case 'newest':
      return copy.sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc))
    case 'title':
      return copy.sort((a, b) => a.title.toLocaleLowerCase().localeCompare(b.title.toLocaleLowerCase()))
    case 'duration':
      return copy.sort((a, b) => a.durationSeconds - b.durationSeconds)
  }
}
