import { transitionTrack, updateTrackMetadata } from '../domain/track'
import type { CatalogPort } from './ports/catalog-port'
import type { StemStorePort } from './ports/stem-store-port'
import { unavailableErrorDetail, UNFINISHED_ERROR_DETAIL } from './separation-copy'
import { expectedLaneKeys } from './separation-lane-keys'

export interface RunStartupSweepsDeps {
  readonly catalog: CatalogPort
  readonly stemStore: StemStorePort
}

export interface StartupSweepCounts {
  readonly recoveredUnfinished: number
  readonly invalidatedReady: number
  readonly orphansRemoved: number
}

async function recoverUnfinished(deps: RunStartupSweepsDeps): Promise<number> {
  const tracks = await deps.catalog.listAll()
  let count = 0
  for (const track of tracks) {
    if (track.status !== 'preparing' && track.status !== 'processing') continue
    const interrupted = updateTrackMetadata(transitionTrack(track, 'interrupted'), {
      errorDetail: UNFINISHED_ERROR_DETAIL,
    })
    await deps.catalog.update(interrupted)
    count += 1
  }
  return count
}

async function validateReady(deps: RunStartupSweepsDeps): Promise<number> {
  const tracks = await deps.catalog.listAll()
  let count = 0
  for (const track of tracks) {
    if (track.status !== 'ready') continue
    const laneKeys = expectedLaneKeys(track)
    const presence = await Promise.all(laneKeys.map((key) => deps.stemStore.exists(key)))
    if (presence.every(Boolean)) continue

    const unavailable = updateTrackMetadata(transitionTrack(track, 'unavailable'), {
      errorDetail: unavailableErrorDetail('one or more stem files are missing'),
    })
    await deps.catalog.update(unavailable)
    count += 1
  }
  return count
}

async function sweepOrphans(deps: RunStartupSweepsDeps): Promise<number> {
  const tracks = await deps.catalog.listAll()
  const referencedResultKeys = tracks.map((track) => track.resultKey)
  const storedKeys = await deps.stemStore.listResultKeys()

  let count = 0
  for (const key of storedKeys) {
    const referenced = referencedResultKeys.some(
      (resultKey) => key === resultKey || key.startsWith(`${resultKey}/`),
    )
    if (referenced) continue
    await deps.stemStore.delete(key)
    count += 1
  }
  return count
}

/**
 * Runs the three startup sweeps in order (`docs/decisions/browser-storage.md`
 * section 4 and section 7, `history.py:385-412`):
 *
 * 1. `recoverUnfinished` — every `preparing`/`processing` row left behind by
 *    a crash or closed tab lands on `interrupted` with the desktop crash copy.
 * 2. `validateReady` — every `ready` row whose stem set is missing any
 *    expected lane key lands on `unavailable` with the desktop copy.
 * 3. `sweepOrphans` — every stored stem key with no matching catalog row is
 *    deleted.
 *
 * Idempotent on a clean catalog: every count is zero and nothing changes.
 */
export async function runStartupSweeps(deps: RunStartupSweepsDeps): Promise<StartupSweepCounts> {
  const recoveredUnfinished = await recoverUnfinished(deps)
  const invalidatedReady = await validateReady(deps)
  const orphansRemoved = await sweepOrphans(deps)
  return Object.freeze({ recoveredUnfinished, invalidatedReady, orphansRemoved })
}
