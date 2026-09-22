import { useEffect, useMemo, useRef, useState } from 'react'
import type { CatalogPort } from '../../application/ports/catalog-port'
import type { HashPort } from '../../application/ports/hash-port'
import type { LockPort } from '../../application/ports/lock-port'
import type { StemStorePort } from '../../application/ports/stem-store-port'
import { removeTrack } from '../../application/remove-track'
import { retryTrack } from '../../application/retry-track'
import type { SeparateProgressEvent } from '../../application/separate'
import type { SeparationQueue } from '../../application/separation-queue'
import type { Track } from '../../domain/track'
import type { StartupSweepGuard } from '../app-dependencies'
import { CancelConfirmDialog } from './CancelConfirmDialog'
import { filterTracksBySearch, sortTracks, type LibrarySortKey } from './filter-sort-tracks'
import { RemoveConfirmDialog } from './RemoveConfirmDialog'
import { removeRefusalMessage } from './remove-refusal-copy'
import { SearchSortControls } from './SearchSortControls'
import { TrackRow } from './TrackRow'

export interface LibraryPageDeps {
  readonly catalog: CatalogPort
  readonly stemStore: StemStorePort
  readonly hash: HashPort
  readonly lock: LockPort
}

export interface LibraryPageProps {
  readonly deps: LibraryPageDeps
  readonly queue: SeparationQueue
  readonly progressByTrackId: Readonly<Record<string, SeparateProgressEvent>>
  readonly onOpenInMixer: (trackId: string) => void
  readonly onExport: (trackId: string) => void
  /** Session-scoped: ensures the startup sweep runs exactly once, even across repeated Library mounts (`app-dependencies.ts`). */
  readonly startupSweepGuard: StartupSweepGuard
}

// Live-job rows (preparing/processing) can change status outside any UI
// event (the queue mutates the catalog on its own once inference settles);
// this is a light periodic refresh so a Library page left open observes
// those transitions without a dedicated "job settled" port/callback.
const REFRESH_INTERVAL_MS = 200

/** Container for the Library destination: search/sort, live row status, cancel/retry/remove wired to their use cases. */
export function LibraryPage({
  deps,
  queue,
  progressByTrackId,
  onOpenInMixer,
  onExport,
  startupSweepGuard,
}: LibraryPageProps) {
  const [tracks, setTracks] = useState<readonly Track[]>([])
  const [sweepsDone, setSweepsDone] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState<LibrarySortKey>('newest')
  const [cancelConfirmTrackId, setCancelConfirmTrackId] = useState<string | null>(null)
  const [removeConfirmTrackId, setRemoveConfirmTrackId] = useState<string | null>(null)
  const [retryPromptTrackId, setRetryPromptTrackId] = useState<string | null>(null)
  const [rowErrorsByTrackId, setRowErrorsByTrackId] = useState<Readonly<Record<string, string>>>({})

  const depsRef = useRef(deps)
  depsRef.current = deps

  async function refresh(): Promise<void> {
    const rows = await depsRef.current.catalog.listAll()
    setTracks(rows)
  }

  useEffect(() => {
    let cancelled = false
    void startupSweepGuard.runOnce(deps).then(() => deps.catalog.listAll()).then((rows) => {
      if (cancelled) return
      setTracks(rows)
      setSweepsDone(true)
    })
    return () => {
      cancelled = true
    }
  }, [deps, startupSweepGuard])

  useEffect(() => {
    if (!sweepsDone) return undefined
    const intervalId = setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    return () => clearInterval(intervalId)
  }, [sweepsDone])

  function clearRowError(trackId: string): void {
    setRowErrorsByTrackId((previous) => {
      if (!(trackId in previous)) return previous
      const next = { ...previous }
      delete next[trackId]
      return next
    })
  }

  function setRowError(trackId: string, message: string): void {
    setRowErrorsByTrackId((previous) => ({ ...previous, [trackId]: message }))
  }

  async function handleCancelConfirmed(trackId: string): Promise<void> {
    queue.cancel(trackId)
    setCancelConfirmTrackId(null)
    await refresh()
  }

  async function handleRemoveConfirmed(trackId: string): Promise<void> {
    const result = await removeTrack(trackId, deps)
    setRemoveConfirmTrackId(null)
    if (result.ok) {
      clearRowError(trackId)
    } else {
      setRowError(trackId, removeRefusalMessage(result.reason))
    }
    await refresh()
  }

  async function handleRetryFileChosen(trackId: string, file: File): Promise<void> {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const result = await retryTrack(trackId, deps, { bytes })

    if (result.ok) {
      setRetryPromptTrackId(null)
      clearRowError(trackId)
      queue.enqueue(trackId, bytes)
    } else if ('reason' in result) {
      setRowError(trackId, `Already separated as another track (${result.ownerTrackId}).`)
    } else {
      setRowError(trackId, 'Retry failed. Try again.')
    }
    await refresh()
  }

  const visibleTracks = useMemo(
    () => sortTracks(filterTracksBySearch(tracks, searchQuery), sortKey),
    [tracks, searchQuery, sortKey],
  )

  return (
    <section className="library-page" aria-labelledby="library-page-title">
      <h1 id="library-page-title">Library</h1>

      <SearchSortControls
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sortKey={sortKey}
        onSortChange={setSortKey}
      />

      {visibleTracks.length === 0
        ? <p className="library-empty" role="status">No tracks yet.</p>
        : (
          <ul className="track-list">
            {visibleTracks.map((track) => (
              <TrackRow
                key={track.trackId}
                track={track}
                progress={progressByTrackId[track.trackId]}
                errorMessage={rowErrorsByTrackId[track.trackId] ?? null}
                showRetryPrompt={retryPromptTrackId === track.trackId}
                onCancelRequested={() => setCancelConfirmTrackId(track.trackId)}
                onRemoveRequested={() => setRemoveConfirmTrackId(track.trackId)}
                onRetryRequested={() => setRetryPromptTrackId(track.trackId)}
                onRetryFileChosen={(file) => void handleRetryFileChosen(track.trackId, file)}
                onRetryCancelled={() => setRetryPromptTrackId(null)}
                onOpenInMixer={onOpenInMixer}
                onExport={onExport}
              />
            ))}
          </ul>
        )}

      {cancelConfirmTrackId !== null && (
        <CancelConfirmDialog
          onKeepRunning={() => setCancelConfirmTrackId(null)}
          onCancelJob={() => void handleCancelConfirmed(cancelConfirmTrackId)}
        />
      )}
      {removeConfirmTrackId !== null && (
        <RemoveConfirmDialog
          onKeepTrack={() => setRemoveConfirmTrackId(null)}
          onRemoveTrack={() => void handleRemoveConfirmed(removeConfirmTrackId)}
        />
      )}
    </section>
  )
}
