import { useEffect, useMemo, useRef, useState } from 'react'
import { exportTrack, type ExportTrackDeps, type ExportTrackEntry } from '../../application/export-track'
import { resolveStemProfile } from '../../application/resolve-stem-profile'
import type { Track } from '../../domain/track'
import { writeZipStream } from '../../domain/zip/zip-writer'
import { formatBytes } from '../format/format-bytes'
import { ExportTrackHeader } from './ExportTrackHeader'
import { StemChecklistRow } from './StemChecklistRow'
import { WhatYouGetCard } from './WhatYouGetCard'

export type ExportPageDeps = ExportTrackDeps

export interface ExportPageProps {
  readonly deps: ExportPageDeps
  readonly trackId: string
  readonly onBackToMixer: () => void
}

type StemRow = ExportTrackEntry

const STORAGE_NOTICE =
  'Track details and saved stems stay in this site’s browser storage. Anyone using this browser profile on this site can access saved tracks. ' +
  'Storage may be cleared or evicted; Safari may delete site data after 7 days without a visit. Other browsers and site origins have separate storage. ' +
  'Download what you want to keep.'

function triggerDownload(file: Blob, fileName: string, afterDownload?: () => void): void {
  const url = URL.createObjectURL(file)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  if (afterDownload === undefined) URL.revokeObjectURL(url)
  else window.setTimeout(() => {
    URL.revokeObjectURL(url)
    afterDownload()
  }, 60_000)
}

/**
 * Container for the Export destination: reads `trackId`'s stems via
 * `exportTrack` (raw, byte-identical bytes, never re-encoded — the entire
 * point of the "raw byte-for-byte copy" rule, `feature-parity.md`'s Export
 * section), decodes only each lane's WAV header for its `sampleRate` (the
 * per-row copy needs it and `Track` stores none), and owns the checked-lane
 * selection driving both "Download selected" (one `<a download>` per
 * checked lane) and "Download ZIP" (built client-side via `zip-writer.ts`,
 * STORED-only, from every checked lane).
 */
export function ExportPage({ deps, trackId, onBackToMixer }: ExportPageProps) {
  const [track, setTrack] = useState<Track | undefined>(undefined)
  const [rows, setRows] = useState<readonly StemRow[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [checkedLaneIds, setCheckedLaneIds] = useState<ReadonlySet<string>>(new Set())
  const [zipExporting, setZipExporting] = useState(false)
  const [zipError, setZipError] = useState<'storage' | 'format' | 'source' | null>(null)
  const zipAbort = useRef<AbortController | undefined>(undefined)

  const depsRef = useRef(deps)
  depsRef.current = deps

  useEffect(() => {
    let cancelled = false
    setTrack(undefined)
    setRows(null)
    setLoadFailed(false)
    setCheckedLaneIds(new Set())
    setZipExporting(false)
    setZipError(null)

    void Promise.all([
      depsRef.current.catalog.getById(trackId),
      exportTrack(trackId, depsRef.current),
    ]).then(async ([loadedTrack, result]) => {
      if (cancelled) return
      if (!result.ok) {
        setTrack(loadedTrack)
        setLoadFailed(true)
        setRows([])
        return
      }
      const withSampleRate = result.entries
      setTrack(loadedTrack)
      setRows(withSampleRate)
      setCheckedLaneIds(new Set(withSampleRate.map((row) => row.laneId)))
    }).catch(() => {
      if (cancelled) return
      setLoadFailed(true)
      setRows([])
    })

    return () => {
      cancelled = true
      zipAbort.current?.abort()
    }
  }, [trackId])

  const checkedRows = useMemo(
    () => (rows ?? []).filter((row) => checkedLaneIds.has(row.laneId)),
    [rows, checkedLaneIds],
  )
  const totalCheckedBytes = checkedRows.reduce((sum, row) => sum + row.sizeBytes, 0)
  const allChecked = rows !== null && rows.length > 0 && checkedRows.length === rows.length

  function toggleLane(laneId: string): void {
    setCheckedLaneIds((previous) => {
      const next = new Set(previous)
      if (next.has(laneId)) next.delete(laneId)
      else next.add(laneId)
      return next
    })
  }

  function toggleSelectAll(): void {
    setCheckedLaneIds(allChecked ? new Set() : new Set((rows ?? []).map((row) => row.laneId)))
  }

  async function handleDownloadZip(): Promise<void> {
    if (checkedRows.length === 0 || zipExporting) return
    if (deps.stemStore.createExportArchive === undefined) {
      setZipError('storage')
      return
    }
    const controller = new AbortController()
    zipAbort.current = controller
    setZipError(null)
    setZipExporting(true)
    let archive: Awaited<ReturnType<NonNullable<typeof deps.stemStore.createExportArchive>>> | undefined
    const title = track?.title.trim() ?? ''
    try {
      archive = await deps.stemStore.createExportArchive()
      await writeZipStream(checkedRows.map((row) => ({
        fileName: row.fileName,
        size: row.sizeBytes,
        openStream: row.openStream,
      })), archive, controller.signal)
      const file = await archive.complete()
      triggerDownload(file, title.length > 0 ? `${track?.title}-stems.zip` : 'stems.zip', () => {
        if (archive !== undefined) void archive.release().catch(() => undefined)
      })
    } catch (error) {
      if (archive !== undefined) await archive.abort().catch(() => undefined)
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setZipError(error instanceof Error && error.message.startsWith('zip-writer.') ? 'format' : 'storage')
      }
    } finally {
      if (zipAbort.current === controller) zipAbort.current = undefined
      setZipExporting(false)
    }
  }

  async function handleDownloadSelected(): Promise<void> {
    try {
      for (const row of checkedRows) triggerDownload(await row.openFile(), row.fileName)
    } catch {
      setZipError('source')
    }
  }

  const profileDisplayName = track === undefined ? '' : resolveStemProfile(track.profileId).displayName

  return (
    <section className="export-page" aria-labelledby="export-page-title">
      {track !== undefined
        ? (
          <ExportTrackHeader
            track={track}
            profileDisplayName={profileDisplayName}
            stemCount={rows?.length ?? 0}
          />
        )
        : (
          <header className="export-track-header">
            <h1 id="export-page-title" className="export-track-title">Export stems</h1>
          </header>
        )}

      {rows === null && <p className="export-loading" role="status">Loading…</p>}

      {loadFailed && (
        <p className="export-load-error" role="alert">Could not load this track&apos;s stems for export.</p>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="export-content-grid">
          <div className="export-main">
            <div className="export-select-all">
              <label>
                <input
                  type="checkbox"
                  className="export-select-all-checkbox"
                  checked={allChecked}
                  onChange={toggleSelectAll}
                />
                Select all
              </label>
            </div>

            <ul className="export-stem-list">
              {rows.map((row) => (
                <StemChecklistRow
                  key={row.laneId}
                  laneId={row.laneId}
                  displayName={row.displayName}
                  sizeBytes={row.sizeBytes}
                  sampleRateHz={row.sampleRateHz}
                  checked={checkedLaneIds.has(row.laneId)}
                  onToggle={() => toggleLane(row.laneId)}
                />
              ))}
            </ul>

            <p className="export-summary">{checkedRows.length} files · {formatBytes(totalCheckedBytes)}</p>

            <div className="export-actions">
              <button
                type="button"
                className="export-download-zip"
                disabled={checkedRows.length === 0 || zipExporting}
                onClick={() => { void handleDownloadZip() }}
              >
                {zipExporting ? 'Preparing ZIP…' : `Download ZIP · ${formatBytes(totalCheckedBytes)}`}
              </button>
              {zipExporting && <button type="button" className="export-cancel-zip" onClick={() => zipAbort.current?.abort()}>Cancel ZIP export</button>}
              <button
                type="button"
                className="export-download-selected"
                disabled={checkedRows.length === 0}
                onClick={() => { void handleDownloadSelected() }}
              >
                Download selected
              </button>
            </div>
            {zipError === 'storage' && <p className="export-zip-error" role="alert">Could not prepare the download because temporary browser storage is unavailable. Free storage if needed, then retry.</p>}
            {zipError === 'format' && <p className="export-zip-error" role="alert">This selection exceeds the ZIP format limit. Select fewer stems or download them individually.</p>}
            {zipError === 'source' && <p className="export-zip-error" role="alert">Could not read a saved stem. Check that the track is still available, then retry.</p>}
          </div>

          <aside className="export-sidebar" aria-label="Export information">
            <WhatYouGetCard />
            <section className="export-storage-panel" aria-labelledby="export-storage-title">
              <h2 id="export-storage-title">Browser storage</h2>
              <p className="export-storage-notice">{STORAGE_NOTICE}</p>
            </section>
          </aside>
        </div>
      )}

      <button type="button" className="export-back-to-mixer" onClick={onBackToMixer}>
        ← Back to mixer
      </button>
    </section>
  )
}
