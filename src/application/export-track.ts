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
  /** The exact stored bytes, never re-decoded/re-encoded (`StemStorePort.readLane`'s own contract). */
  readonly bytes: Uint8Array
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
 * Reads a track's full stem set for export: reuses `resolveStemProfile`
 * (the same lane-set derivation `separate.ts`/`open-in-mixer.ts` already
 * use) and reads every lane's raw bytes via `StemStorePort.readLane` — the
 * exact bytes `encodeFloat32Wav` wrote at separation time, never
 * re-decoded/re-encoded. This is the entire point of the desktop's "raw
 * byte-for-byte copy" export rule (`mixer_controller.py:417-434`'s
 * docstring, quoted in `feature-parity.md`'s Export section).
 *
 * Absent lanes (e.g. Rock's `guitar_center`/`guitar_sides` with no
 * detectable energy) are included exactly like any other lane — real,
 * aligned silence, per the same "still... exportable" rule already applied
 * to the Mixer.
 *
 * A track that can't be found, or whose stems fail to read, is a typed
 * refusal, never a throw — matching `openInMixer`'s own error-handling
 * shape. Unlike the Mixer there is no meaningful "fallback session" to
 * export, so failure here is a plain refusal with no placeholder data.
 */
export async function exportTrack(trackId: string, deps: ExportTrackDeps): Promise<ExportTrackResult> {
  const track = await deps.catalog.getById(trackId)
  if (track === undefined) {
    return Object.freeze({ ok: false, reason: 'track-not-found' as const })
  }

  try {
    const profile = resolveStemProfile(track.profileId)
    const entries = await Promise.all(profile.lanes.map(async (lane): Promise<ExportTrackEntry> => {
      const bytes = await deps.stemStore.readLane(track.resultKey, lane.laneId)
      return Object.freeze({
        laneId: lane.laneId,
        displayName: lane.displayName,
        fileName: fileNameFor(track, lane.laneId),
        bytes,
      })
    }))
    return Object.freeze({ ok: true, entries: Object.freeze(entries) })
  } catch {
    return Object.freeze({ ok: false, reason: 'stems-unavailable' as const })
  }
}
