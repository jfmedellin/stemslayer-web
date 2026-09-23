import { useEffect, useMemo, useRef, useState } from 'react'
import { exportTrack, type ExportTrackDeps, type ExportTrackEntry } from '../../application/export-track'
import { resolveStemProfile } from '../../application/resolve-stem-profile'
import { decodeFloat32Wav } from '../../domain/audio/float32-wav'
import type { Track } from '../../domain/track'
import { writeZip } from '../../domain/zip/zip-writer'
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

interface StemRow extends ExportTrackEntry {
  readonly sampleRateHz: number
}

// Verbatim, fetched from the real Export Stitch mockup — the exact sentence
// `phase-2-plan.md`'s own P10 row calls for ("Safari seven-day notice") and
// `architecture.md`/`browser-storage.md` section 4 already establish as
// fact (WebKit ITP 7-day full-storage deletion).
const STORAGE_NOTICE =
  'These stems live only in this browser. Safari deletes site data after 7 days without a visit; ' +
  'other browsers may evict it under disk pressure. Download what you want to keep.'

function triggerDownload(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes.slice()], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
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

  const depsRef = useRef(deps)
  depsRef.current = deps

  useEffect(() => {
    let cancelled = false
    setTrack(undefined)
    setRows(null)
    setLoadFailed(false)
    setCheckedLaneIds(new Set())

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
      const withSampleRate = await Promise.all(result.entries.map(async (entry): Promise<StemRow> => ({
        ...entry,
        sampleRateHz: decodeFloat32Wav(entry.bytes).sampleRate,
      })))
      if (cancelled) return
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
    }
  }, [trackId])

  const checkedRows = useMemo(
    () => (rows ?? []).filter((row) => checkedLaneIds.has(row.laneId)),
    [rows, checkedLaneIds],
  )
  const totalCheckedBytes = checkedRows.reduce((sum, row) => sum + row.bytes.length, 0)
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

  function handleDownloadZip(): void {
    if (checkedRows.length === 0) return
    const zipBytes = writeZip(checkedRows.map((row) => ({ fileName: row.fileName, bytes: row.bytes })))
    const title = track?.title.trim() ?? ''
    triggerDownload(zipBytes, title.length > 0 ? `${track?.title}-stems.zip` : 'stems.zip')
  }

  function handleDownloadSelected(): void {
    for (const row of checkedRows) triggerDownload(row.bytes, row.fileName)
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
            onBackToMixer={onBackToMixer}
          />
        )
        : (
          <header className="export-track-header">
            <button type="button" className="export-back-to-mixer" onClick={onBackToMixer}>
              ← Back to mixer
            </button>
            <h1 id="export-page-title">Export</h1>
          </header>
        )}

      {rows === null && <p className="export-loading" role="status">Loading…</p>}

      {loadFailed && (
        <p className="export-load-error" role="alert">Could not load this track&apos;s stems for export.</p>
      )}

      {rows !== null && rows.length > 0 && (
        <>
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
                sizeBytes={row.bytes.length}
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
              disabled={checkedRows.length === 0}
              onClick={handleDownloadZip}
            >
              Download ZIP · {formatBytes(totalCheckedBytes)} download
            </button>
            <button
              type="button"
              className="export-download-selected"
              disabled={checkedRows.length === 0}
              onClick={handleDownloadSelected}
            >
              Download selected
            </button>
          </div>

          <WhatYouGetCard />

          <p className="export-storage-notice">{STORAGE_NOTICE}</p>
        </>
      )}
    </section>
  )
}
