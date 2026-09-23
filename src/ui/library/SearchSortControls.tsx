import type { LibrarySortKey } from './filter-sort-tracks'

export interface SearchSortControlsProps {
  readonly searchQuery: string
  readonly onSearchChange: (value: string) => void
  readonly sortKey: LibrarySortKey
  readonly onSortChange: (value: LibrarySortKey) => void
  readonly visibleCount: number
}

/** Search box (title/artist substring) plus the three kept sorts — no status/profile filters (`feature-parity.md` line 40). */
export function SearchSortControls({ searchQuery, onSearchChange, sortKey, onSortChange, visibleCount }: SearchSortControlsProps) {
  return (
    <div className="library-controls">
      <input
        type="search"
        className="library-search"
        aria-label="Search tracks by title or artist"
        placeholder="Search title or artist"
        value={searchQuery}
        onChange={(event) => onSearchChange(event.target.value)}
      />
      <span className="library-sort-label">Sort:</span>
      <select
        className="library-sort"
        aria-label="Sort tracks"
        value={sortKey}
        onChange={(event) => onSortChange(event.target.value as LibrarySortKey)}
      >
        <option value="newest">Newest</option>
        <option value="title">Title</option>
        <option value="duration">Duration</option>
      </select>
      <span className="library-count" role="status">{visibleCount} {visibleCount === 1 ? 'track' : 'tracks'}</span>
    </div>
  )
}
