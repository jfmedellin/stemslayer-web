import type { Track } from '../domain/track'
import type { CatalogPort } from './ports/catalog-port'
import { resolveStemProfile } from './resolve-stem-profile'
import type { StemStorePort } from './ports/stem-store-port'

export interface ExportTrackDeps {
  readonly catalog: CatalogPort
  readonly stemStore: StemStorePort
}

export interface ExportTrackEntry {
  readonly laneId: string
  readonly displayName: string
  readonly fileName: string
  readonly sampleRateHz: number
  readonly sizeBytes: number
  readonly openStream: () => Promise<ReadableStream<Uint8Array>>
  readonly openFile: () => Promise<File>
}

export type ExportTrackResult =
  | Readonly<{ ok: true; entries: readonly ExportTrackEntry[] }>
  | Readonly<{ ok: false; reason: 'track-not-found' | 'stems-unavailable' }>

/**
 * `{title}-{stem}.wav` when the track has a (non-blank) title, bare
 * `{stem}.wav` otherwise (`mixer_controller.py:101-123`'s `_export_target`
 * naming scheme). No collision-suffix logic: a plain `<a download>` lets
 * the browser dedupe filenames itself (`feature-parity.md`'s Export naming
 * row) — collision suffixes only matter for a File System Access API write
 * to a chosen folder, out of this task's scope.
 */
function fileNameFor(track: Track, laneId: string): string {
  const title = track.title.trim()
  return title.length > 0 ? `${track.title}-${laneId}.wav` : `${laneId}.wav`
}

/**
 * Resolves a track's stem metadata for export without materializing WAV
 * payloads. Streams reopen the exact bytes `encodeFloat32Wav` wrote at
 * separation time, never re-decoded/re-encoded. This is the desktop's "raw
 * byte-for-byte copy" export rule (`mixer_controller.py:417-434`'s
 * docstring, quoted in `feature-parity.md`'s Export section).
 *
 * Absent lanes (e.g. Rock's `guitar_center`/`guitar_sides` with no
 * detectable energy) are included exactly like any other lane — real,
 * aligned silence, per the same "still... exportable" rule already applied
 * to the Mixer.
 *
 * A track that can't be found, or has no readable stems, is a typed
 * refusal. Individual unreadable lanes do not block the rest of the batch.
 */
export async function exportTrack(trackId: string, deps: ExportTrackDeps): Promise<ExportTrackResult> {
  const track = await deps.catalog.getById(trackId)
  if (track === undefined) {
    return Object.freeze({ ok: false, reason: 'track-not-found' as const })
  }

  try {
    const profile = resolveStemProfile(track.profileId)
    if (deps.stemStore.readLaneInfo === undefined
      || deps.stemStore.readLaneFile === undefined
      || deps.stemStore.openLaneStream === undefined) {
      return Object.freeze({ ok: false, reason: 'stems-unavailable' as const })
    }
    const results = await Promise.allSettled(profile.lanes.map(async (lane): Promise<ExportTrackEntry> => {
      const [info, file] = await Promise.all([
        deps.stemStore.readLaneInfo!(track.resultKey, lane.laneId),
        deps.stemStore.readLaneFile!(track.resultKey, lane.laneId),
      ])
      return Object.freeze({
        laneId: lane.laneId,
        displayName: lane.displayName,
        fileName: fileNameFor(track, lane.laneId),
        sampleRateHz: info.sampleRate,
        sizeBytes: file.size,
        openStream: () => deps.stemStore.openLaneStream!(track.resultKey, lane.laneId),
        openFile: () => deps.stemStore.readLaneFile!(track.resultKey, lane.laneId),
      })
    }))
    const entries = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
    if (entries.length === 0) {
      return Object.freeze({ ok: false, reason: 'stems-unavailable' as const })
    }
    return Object.freeze({ ok: true, entries: Object.freeze(entries) })
  } catch {
    return Object.freeze({ ok: false, reason: 'stems-unavailable' as const })
  }
}
