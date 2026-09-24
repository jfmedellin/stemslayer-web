import { afterEach, beforeEach, expect, test } from 'vitest'

import { runStartupSweeps } from '../../application/run-startup-sweeps'
import { BASIC_PROFILE } from '../../domain/stem-profile'
import { createTrack, transitionTrack, type TrackInput } from '../../domain/track'
import { InMemoryCatalog } from '../../../tests/fakes/in-memory-catalog'
import { OpfsStemStore } from './opfs-stem-store'

let rootDirectoryName: string
let store: OpfsStemStore

beforeEach(() => {
  rootDirectoryName = `opfs-sweep-test-${Math.random().toString(36).slice(2)}`
  store = new OpfsStemStore({ rootDirectoryName })
})

afterEach(async () => {
  const opfsRoot = await navigator.storage.getDirectory()
  await opfsRoot.removeEntry(rootDirectoryName, { recursive: true }).catch(() => undefined)
})

function trackInput(trackId: string): TrackInput {
  return {
    trackId,
    title: 'Song',
    artist: 'Artist',
    genre: null,
    durationSeconds: 200,
    bpm: null,
    musicalKey: null,
    createdAtUtc: '2026-09-21T12:00:00.000Z',
    profileId: BASIC_PROFILE.profileId,
    pipelineFingerprint: `pipeline-${trackId}`,
    resultKey: `stems/${trackId}`,
  }
}

async function writeAllLanes(resultKey: string): Promise<void> {
  for (const lane of BASIC_PROFILE.lanes) {
    await store.writeLane(resultKey, lane.laneId, Uint8Array.from([1, 2, 3]))
  }
}

test('the referential orphan sweep removes a result directory with no matching catalog row and keeps the referenced one', async () => {
  const catalog = new InMemoryCatalog()
  const kept = transitionTrack(createTrack(trackInput('track-1')), 'processing')
  const orphaned = transitionTrack(createTrack(trackInput('track-2')), 'processing')
  await catalog.insert(transitionTrack(kept, 'ready'))
  await catalog.insert(transitionTrack(orphaned, 'ready'))
  await writeAllLanes(kept.resultKey)
  await writeAllLanes(orphaned.resultKey)

  // The catalog row for track-2 is gone (e.g. removed by the user), but its
  // stem directory is still on disk: exactly the orphan sweepOrphans exists for.
  await catalog.remove('track-2')

  const counts = await runStartupSweeps({ catalog, stemStore: store })

  expect(counts.orphansRemoved).toBeGreaterThan(0)
  await expect(store.exists(kept.resultKey)).resolves.toBe(true)
  await expect(store.exists(orphaned.resultKey)).resolves.toBe(false)
})

test('validateReady flips a ready row to unavailable when its directory was deleted out of band', async () => {
  const catalog = new InMemoryCatalog()
  const track = transitionTrack(transitionTrack(createTrack(trackInput('track-1')), 'processing'), 'ready')
  await catalog.insert(track)
  await writeAllLanes(track.resultKey)

  // Deleted out of band: the browser evicted it, or storage was cleared,
  // without the app's own delete path running.
  await store.delete(track.resultKey)

  const counts = await runStartupSweeps({ catalog, stemStore: store })

  expect(counts.invalidatedReady).toBe(1)
  const updated = await catalog.getById('track-1')
  expect(updated?.status).toBe('unavailable')
  expect(updated?.errorDetail).toContain('Stored stems are unavailable')
})
