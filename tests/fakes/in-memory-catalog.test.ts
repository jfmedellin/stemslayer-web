import { describe, expect, test } from 'vitest'

import { createTrack, type TrackInput } from '../../src/domain/track'
import { InMemoryCatalog } from './in-memory-catalog'

const input: TrackInput = {
  trackId: 'track-1',
  title: 'Song',
  artist: 'Artist',
  genre: null,
  durationSeconds: 0,
  bpm: null,
  musicalKey: null,
  createdAtUtc: '2026-09-21T12:00:00.000Z',
  profileId: 'legacy-four-stem',
  pipelineFingerprint: 'pipeline-a',
  resultKey: 'stems/track-1',
}

describe('InMemoryCatalog', () => {
  test('starts empty', async () => {
    const catalog = new InMemoryCatalog()

    await expect(catalog.listAll()).resolves.toEqual([])
    await expect(catalog.getById('missing')).resolves.toBeUndefined()
  })

  test('inserts and reads a track back', async () => {
    const catalog = new InMemoryCatalog()
    const track = createTrack(input)

    await catalog.insert(track)

    await expect(catalog.getById(track.trackId)).resolves.toEqual(track)
    await expect(catalog.listAll()).resolves.toEqual([track])
  })

  test('updates an existing track in place', async () => {
    const catalog = new InMemoryCatalog()
    const track = createTrack(input)
    await catalog.insert(track)

    const updated = { ...track, title: 'Renamed' }
    await catalog.update(updated)

    await expect(catalog.getById(track.trackId)).resolves.toEqual(updated)
    await expect(catalog.listAll()).resolves.toEqual([updated])
  })

  test('removes a track', async () => {
    const catalog = new InMemoryCatalog()
    const track = createTrack(input)
    await catalog.insert(track)

    await catalog.remove(track.trackId)

    await expect(catalog.getById(track.trackId)).resolves.toBeUndefined()
    await expect(catalog.listAll()).resolves.toEqual([])
  })
})
