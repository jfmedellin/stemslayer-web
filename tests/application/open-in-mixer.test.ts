import { describe, expect, test } from 'vitest'

import { openInMixer } from '../../src/application/open-in-mixer'
import { encodeFloat32Wav } from '../../src/domain/audio/float32-wav'
import { BASIC_PROFILE, ROCK_PROFILE } from '../../src/domain/stem-profile'
import { createTrack, transitionTrack, type TrackInput } from '../../src/domain/track'
import { FakeAudioEngine } from '../fakes/fake-audio-engine'
import { InMemoryCatalog } from '../fakes/in-memory-catalog'
import { InMemoryStemStore } from '../fakes/in-memory-stem-store'

const SAMPLE_RATE = 44_100
const FRAME_COUNT = 8

function silentStereo(frameCount = FRAME_COUNT): [Float32Array, Float32Array] {
  return [new Float32Array(frameCount), new Float32Array(frameCount)]
}

function toneStereo(value: number, frameCount = FRAME_COUNT): [Float32Array, Float32Array] {
  return [
    Float32Array.from({ length: frameCount }, () => value),
    Float32Array.from({ length: frameCount }, () => value),
  ]
}

function laneBytes(planar: readonly Float32Array[], sampleRate = SAMPLE_RATE): Uint8Array {
  return encodeFloat32Wav({ sampleRate, planar })
}

const basicInput: TrackInput = {
  trackId: 'track-basic',
  title: 'Song',
  artist: 'Artist',
  genre: null,
  durationSeconds: 0,
  bpm: null,
  musicalKey: null,
  createdAtUtc: '2026-09-21T12:00:00.000Z',
  profileId: BASIC_PROFILE.profileId,
  pipelineFingerprint: 'pipeline-a',
  resultKey: 'stems/track-basic',
}

const rockInput: TrackInput = {
  ...basicInput,
  trackId: 'track-rock',
  profileId: ROCK_PROFILE.profileId,
  resultKey: 'stems/track-rock',
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

describe('openInMixer', () => {
  test('loads every lane of a real ready track into a working mixer session', async () => {
    const catalog = new InMemoryCatalog()
    const stemStore = new InMemoryStemStore()
    const engine = new FakeAudioEngine()
    const lanes = new Map(
      BASIC_PROFILE.lanes.map((lane, index) => [lane.laneId, toneStereo(0.1 * (index + 1))]),
    )
    await seedReadyTrack(catalog, stemStore, basicInput, lanes)

    const result = await openInMixer('track-basic', { catalog, stemStore, audioEngine: engine })

    expect(result.ok).toBe(true)
    expect(engine.loadedSessions).toHaveLength(1)
    const session = engine.loadedSessions[0]
    expect(session.trackId).toBe('track-basic')
    expect(session.sampleRate).toBe(SAMPLE_RATE)
    expect(session.frameCount).toBe(FRAME_COUNT)
    expect(session.fallback).toBe(false)
    expect(session.lanes.map((lane) => lane.laneId)).toEqual(
      BASIC_PROFILE.lanes.map((lane) => lane.laneId),
    )
    for (const lane of session.lanes) {
      expect(lane.absent).toBe(false)
      expect(lane.channels[0]).toHaveLength(FRAME_COUNT)
      expect(lane.channels[1]).toHaveLength(FRAME_COUNT)
    }
    // Byte-identical decode, not a lossy re-decode: exact tone values survive.
    const vocalsLane = session.lanes.find((lane) => lane.laneId === 'vocals')
    expect(vocalsLane?.channels[0][0]).toBeCloseTo(0.1, 6)
  })

  test('an absentable lane whose decoded samples are all exactly 0 is included as real, controllable, labeled-absent silence', async () => {
    const catalog = new InMemoryCatalog()
    const stemStore = new InMemoryStemStore()
    const engine = new FakeAudioEngine()
    const lanes = new Map<string, readonly Float32Array[]>(
      ROCK_PROFILE.lanes.map((lane) => [
        lane.laneId,
        lane.roleGroup === 'guitar' ? silentStereo() : toneStereo(0.2),
      ]),
    )
    await seedReadyTrack(catalog, stemStore, rockInput, lanes)

    const result = await openInMixer('track-rock', { catalog, stemStore, audioEngine: engine })

    expect(result.ok).toBe(true)
    const session = engine.loadedSessions[0]
    const guitarCenter = session.lanes.find((lane) => lane.laneId === 'guitar_center')
    const guitarSides = session.lanes.find((lane) => lane.laneId === 'guitar_sides')
    const vocals = session.lanes.find((lane) => lane.laneId === 'vocals')
    expect(guitarCenter?.absent).toBe(true)
    expect(guitarSides?.absent).toBe(true)
    expect(vocals?.absent).toBe(false)
    // Still real, aligned, fully-present silence, not hidden or shortened.
    expect(guitarCenter?.channels[0]).toHaveLength(FRAME_COUNT)
    expect(guitarCenter?.channels[0].every((sample) => sample === 0)).toBe(true)
  })

  test('a non-absentable lane that happens to be all-zero is not marked absent', async () => {
    const catalog = new InMemoryCatalog()
    const stemStore = new InMemoryStemStore()
    const engine = new FakeAudioEngine()
    const lanes = new Map(
      BASIC_PROFILE.lanes.map((lane) => [lane.laneId, silentStereo()]),
    )
    await seedReadyTrack(catalog, stemStore, basicInput, lanes)

    const result = await openInMixer('track-basic', { catalog, stemStore, audioEngine: engine })

    expect(result.ok).toBe(true)
    expect(engine.loadedSessions[0].lanes.every((lane) => !lane.absent)).toBe(true)
  })

  test('an unknown track falls back to the 4-lane Basic layout as an error placeholder and still calls load', async () => {
    const catalog = new InMemoryCatalog()
    const stemStore = new InMemoryStemStore()
    const engine = new FakeAudioEngine()

    const result = await openInMixer('missing-track', { catalog, stemStore, audioEngine: engine })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('track-not-found')
    expect(engine.loadedSessions).toHaveLength(1)
    const session = engine.loadedSessions[0]
    expect(session.fallback).toBe(true)
    expect(session.lanes.map((lane) => lane.laneId)).toEqual(
      BASIC_PROFILE.lanes.map((lane) => lane.laneId),
    )
  })

  test('a track whose stems fail to load falls back to the 4-lane Basic layout rather than throwing', async () => {
    const catalog = new InMemoryCatalog()
    const stemStore = new InMemoryStemStore()
    const engine = new FakeAudioEngine()
    // Seed only some lanes: reading the rest rejects.
    const track = transitionTrack(transitionTrack(createTrack(basicInput), 'processing'), 'ready')
    await catalog.insert(track)
    await stemStore.writeLane(basicInput.resultKey, 'vocals', laneBytes(toneStereo(0.3)))

    const result = await openInMixer('track-basic', { catalog, stemStore, audioEngine: engine })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('stems-unavailable')
    expect(engine.loadedSessions).toHaveLength(1)
    expect(engine.loadedSessions[0].fallback).toBe(true)
  })

  test('a superseded call never reaches AudioEnginePort.load, even though it still resolves with a session', async () => {
    const catalog = new InMemoryCatalog()
    const stemStore = new InMemoryStemStore()
    const engine = new FakeAudioEngine()
    const lanes = new Map(
      BASIC_PROFILE.lanes.map((lane, index) => [lane.laneId, toneStereo(0.1 * (index + 1))]),
    )
    await seedReadyTrack(catalog, stemStore, basicInput, lanes)

    const result = await openInMixer(
      'track-basic',
      { catalog, stemStore, audioEngine: engine },
      { isStale: () => true },
    )

    expect(result.ok).toBe(true)
    expect(result.session.trackId).toBe('track-basic')
    // The whole point: a superseded load must never land on the shared
    // engine, or an older track's audio could silently keep playing under a
    // UI that already moved on to a newer one (native review finding
    // R3-mixer-stale-load-race).
    expect(engine.loadedSessions).toHaveLength(0)
  })

  test('a superseded call is also skipped on both fallback paths (unknown track, failed stems)', async () => {
    const catalog = new InMemoryCatalog()
    const stemStore = new InMemoryStemStore()
    const engine = new FakeAudioEngine()

    const missingResult = await openInMixer(
      'missing-track',
      { catalog, stemStore, audioEngine: engine },
      { isStale: () => true },
    )
    expect(missingResult.ok).toBe(false)
    expect(engine.loadedSessions).toHaveLength(0)

    const track = transitionTrack(transitionTrack(createTrack(basicInput), 'processing'), 'ready')
    await catalog.insert(track)
    // No lanes seeded: reading them rejects, forcing the stems-unavailable path.
    const failedResult = await openInMixer(
      'track-basic',
      { catalog, stemStore, audioEngine: engine },
      { isStale: () => true },
    )
    expect(failedResult.ok).toBe(false)
    expect(engine.loadedSessions).toHaveLength(0)
  })

  test('mismatched per-lane sample rates are treated as a failed load rather than silently mixed', async () => {
    const catalog = new InMemoryCatalog()
    const stemStore = new InMemoryStemStore()
    const engine = new FakeAudioEngine()
    const track = transitionTrack(transitionTrack(createTrack(basicInput), 'processing'), 'ready')
    await catalog.insert(track)
    for (const lane of BASIC_PROFILE.lanes) {
      const rate = lane.laneId === 'drums' ? 48_000 : SAMPLE_RATE
      await stemStore.writeLane(basicInput.resultKey, lane.laneId, laneBytes(toneStereo(0.1), rate))
    }

    const result = await openInMixer('track-basic', { catalog, stemStore, audioEngine: engine })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('stems-unavailable')
  })
})
