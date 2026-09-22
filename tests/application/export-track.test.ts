import { describe, expect, test } from 'vitest'

import { exportTrack } from '../../src/application/export-track'
import { encodeFloat32Wav } from '../../src/domain/audio/float32-wav'
import { BASIC_PROFILE, ROCK_PROFILE } from '../../src/domain/stem-profile'
import { createTrack, transitionTrack, type TrackInput } from '../../src/domain/track'
import { InMemoryCatalog } from '../fakes/in-memory-catalog'
import { InMemoryStemStore } from '../fakes/in-memory-stem-store'

const SAMPLE_RATE = 44_100
const FRAME_COUNT = 8

function toneStereo(value: number, frameCount = FRAME_COUNT): [Float32Array, Float32Array] {
  return [
    Float32Array.from({ length: frameCount }, () => value),
    Float32Array.from({ length: frameCount }, () => value),
  ]
}

function laneBytes(planar: readonly Float32Array[]): Uint8Array {
  return encodeFloat32Wav({ sampleRate: SAMPLE_RATE, planar })
}

const basicInput: TrackInput = {
  trackId: 'track-basic',
  title: 'Komorebi',
  artist: 'Yui',
  genre: null,
  durationSeconds: 0,
  bpm: null,
  musicalKey: null,
  createdAtUtc: '2026-09-22T00:00:00.000Z',
  profileId: BASIC_PROFILE.profileId,
  pipelineFingerprint: 'pipeline-a',
  resultKey: 'stems/track-basic',
}

async function seedReadyTrack(
  catalog: InMemoryCatalog,
  stemStore: InMemoryStemStore,
  input: TrackInput,
  lanes: ReadonlyMap<string, readonly Float32Array[]>,
): Promise<void> {
  const track = transitionTrack(transitionTrack(createTrack(input), 'processing'), 'ready')
  await catalog.insert(track)
  for (const [laneId, planar] of lanes) {
    await stemStore.writeLane(input.resultKey, laneId, laneBytes(planar))
  }
}

describe('exportTrack', () => {
  test('reads every lane of a real ready track byte-identical, named "{title}-{stem}.wav"', async () => {
    const catalog = new InMemoryCatalog()
    const stemStore = new InMemoryStemStore()
    const lanes = new Map(BASIC_PROFILE.lanes.map((lane, index) => [lane.laneId, toneStereo(0.1 * (index + 1))]))
    await seedReadyTrack(catalog, stemStore, basicInput, lanes)

    const result = await exportTrack('track-basic', { catalog, stemStore })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entries).toHaveLength(BASIC_PROFILE.lanes.length)
    expect(result.entries.map((entry) => entry.laneId)).toEqual(
      BASIC_PROFILE.lanes.map((lane) => lane.laneId),
    )
    expect(result.entries.map((entry) => entry.fileName)).toEqual(
      BASIC_PROFILE.lanes.map((lane) => `Komorebi-${lane.laneId}.wav`),
    )
    expect(result.entries.map((entry) => entry.displayName)).toEqual(
      BASIC_PROFILE.lanes.map((lane) => lane.displayName),
    )
    for (const entry of result.entries) {
      const storedBytes = await stemStore.readLane(basicInput.resultKey, entry.laneId)
      expect(Array.from(entry.bytes)).toEqual(Array.from(storedBytes))
    }
  })

  test('bare "{stem}.wav" naming when the track has no title', async () => {
    const catalog = new InMemoryCatalog()
    const stemStore = new InMemoryStemStore()
    const lanes = new Map(BASIC_PROFILE.lanes.map((lane) => [lane.laneId, toneStereo(0.2)]))
    await seedReadyTrack(catalog, stemStore, { ...basicInput, title: '' }, lanes)

    const result = await exportTrack('track-basic', { catalog, stemStore })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entries.map((entry) => entry.fileName)).toEqual(
      BASIC_PROFILE.lanes.map((lane) => `${lane.laneId}.wav`),
    )
  })

  test('includes an absent lane like any other lane (real, aligned silence, never skipped)', async () => {
    const catalog = new InMemoryCatalog()
    const stemStore = new InMemoryStemStore()
    const lanes = new Map<string, readonly Float32Array[]>(
      ROCK_PROFILE.lanes.map((lane) => [lane.laneId, lane.roleGroup === 'guitar' ? toneStereo(0) : toneStereo(0.3)]),
    )
    const rockInput: TrackInput = {
      ...basicInput,
      trackId: 'track-rock',
      profileId: ROCK_PROFILE.profileId,
      resultKey: 'stems/track-rock',
    }
    await seedReadyTrack(catalog, stemStore, rockInput, lanes)

    const result = await exportTrack('track-rock', { catalog, stemStore })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entries.map((entry) => entry.laneId)).toEqual(ROCK_PROFILE.lanes.map((lane) => lane.laneId))
    const guitarCenter = result.entries.find((entry) => entry.laneId === 'guitar_center')
    expect(guitarCenter).toBeDefined()
    expect(guitarCenter?.bytes.length).toBeGreaterThan(0)
  })

  test('refuses cleanly (no throw) for an unknown track', async () => {
    const catalog = new InMemoryCatalog()
    const stemStore = new InMemoryStemStore()

    const result = await exportTrack('missing-track', { catalog, stemStore })

    expect(result).toEqual({ ok: false, reason: 'track-not-found' })
  })

  test('refuses cleanly (no throw) when a lane fails to read', async () => {
    const catalog = new InMemoryCatalog()
    const stemStore = new InMemoryStemStore()
    const track = transitionTrack(transitionTrack(createTrack(basicInput), 'processing'), 'ready')
    await catalog.insert(track)
    await stemStore.writeLane(basicInput.resultKey, 'vocals', laneBytes(toneStereo(0.3)))
    // Every other lane is never written -> readLane rejects for them.

    const result = await exportTrack('track-basic', { catalog, stemStore })

    expect(result).toEqual({ ok: false, reason: 'stems-unavailable' })
  })
})
