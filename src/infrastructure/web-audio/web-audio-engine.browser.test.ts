import { beforeEach, describe, expect, test } from 'vitest'

import { createLoopRange, resolveEffectiveGains, type MixerLaneState } from '../../domain/mixer/mixer'
import type { MixerSession, MixerSessionLane } from '../../application/ports/audio-engine-port'
import { WebAudioEngine } from './web-audio-engine'

const SAMPLE_RATE = 44_100
const FRAME_COUNT = 200

/** A distinct ramp per lane so every sample position has a unique, checkable value. */
function rampChannel(base: number, frameCount = FRAME_COUNT): Float32Array {
  return Float32Array.from({ length: frameCount }, (_unused, index) => base + index / 1_000)
}

function lane(laneId: string, base: number, frameCount = FRAME_COUNT): MixerSessionLane {
  return {
    laneId,
    displayName: laneId,
    channels: [rampChannel(base, frameCount), rampChannel(base, frameCount)],
    absent: false,
  }
}

function makeSession(lanes: readonly MixerSessionLane[], frameCount = FRAME_COUNT): MixerSession {
  return {
    trackId: 'track-1',
    sampleRate: SAMPLE_RATE,
    frameCount,
    lanes,
    fallback: false,
  }
}

/** Lets the worklet's port messages and AudioParam automation land before rendering starts. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 50))
}

async function render(context: OfflineAudioContext): Promise<AudioBuffer> {
  await flushMicrotasks()
  return context.startRendering()
}

function makeContext(length: number): OfflineAudioContext {
  return new OfflineAudioContext(2, length, SAMPLE_RATE)
}

describe('WebAudioEngine against a real AudioWorkletProcessor (OfflineAudioContext, Chromium)', () => {
  let context: OfflineAudioContext
  let engine: WebAudioEngine

  beforeEach(() => {
    context = makeContext(FRAME_COUNT + 100)
    engine = new WebAudioEngine({ context })
  })

  test('mixes two lanes at their set gains, sample-accurately, then stops at the track end', async () => {
    const vocals = lane('vocals', 0.1)
    const drums = lane('drums', 0.2)
    await engine.load(makeSession([vocals, drums]))
    engine.setLaneGain('vocals', 1)
    engine.setLaneGain('drums', 0.5)
    engine.setMasterGain(1)
    engine.play()

    const buffer = await render(context)
    const left = buffer.getChannelData(0)

    for (const sampleIndex of [0, 1, 50, 199]) {
      const expected = vocals.channels[0][sampleIndex] * 1 + drums.channels[0][sampleIndex] * 0.5
      expect(left[sampleIndex]).toBeCloseTo(expected, 6)
    }
    // Stops (silence) once frameCount is reached, rather than repeating or looping.
    expect(left[FRAME_COUNT]).toBe(0)
    expect(left[FRAME_COUNT + 50]).toBe(0)
  })

  test('a paused engine renders silence even though lanes are loaded', async () => {
    await engine.load(makeSession([lane('vocals', 0.3)]))
    engine.setLaneGain('vocals', 1)
    // Never calls play().

    const buffer = await render(context)
    const left = buffer.getChannelData(0)
    expect(left[0]).toBe(0)
    expect(left[50]).toBe(0)
  })

  test('multi-solo: a soloed lane keeps its gain, a non-soloed lane is silenced, wired through the real domain formula', async () => {
    const vocals = lane('vocals', 0.1)
    const drums = lane('drums', 0.2)
    const bass = lane('bass', 0.05)
    await engine.load(makeSession([vocals, drums, bass]))

    // Two lanes soloed (multi-solo), one left alone: exact same
    // `resolveEffectiveGains` the domain test suite covers in
    // `tests/domain/mixer.test.ts` — this proves the engine applies
    // whatever the domain resolves, sample-accurately, not a re-implemented
    // mute/solo rule inside the adapter.
    const laneStates: readonly MixerLaneState[] = [
      { laneId: 'vocals', gainPercent: 100, muted: false, solo: true },
      { laneId: 'drums', gainPercent: 100, muted: false, solo: false },
      { laneId: 'bass', gainPercent: 100, muted: true, solo: true },
    ]
    const gains = resolveEffectiveGains(laneStates)
    for (const [laneId, gain] of gains) engine.setLaneGain(laneId, gain)
    engine.setMasterGain(1)
    engine.play()

    const buffer = await render(context)
    const left = buffer.getChannelData(0)

    const sampleIndex = 25
    const expected = vocals.channels[0][sampleIndex] * 1 // drums silenced, bass muted-over-solo
    expect(left[sampleIndex]).toBeCloseTo(expected, 6)
    expect(gains.get('drums')).toBe(0)
    expect(gains.get('bass')).toBe(0)
  })

  test('master gain applies after the per-lane sum, scaling the whole mix', async () => {
    const vocals = lane('vocals', 0.1)
    const drums = lane('drums', 0.1)
    await engine.load(makeSession([vocals, drums]))
    engine.setLaneGain('vocals', 1)
    engine.setLaneGain('drums', 1)
    engine.setMasterGain(0.25)
    engine.play()

    const buffer = await render(context)
    const left = buffer.getChannelData(0)

    const sampleIndex = 10
    const expected = (vocals.channels[0][sampleIndex] + drums.channels[0][sampleIndex]) * 0.25
    expect(left[sampleIndex]).toBeCloseTo(expected, 6)
  })

  test('a loop region wraps the shared cursor from its end back to its start', async () => {
    const solo = lane('vocals', 0.1)
    await engine.load(makeSession([solo]))
    engine.setLaneGain('vocals', 1)
    engine.setMasterGain(1)
    engine.setLoopRange(createLoopRange(50, 150, FRAME_COUNT))
    engine.play()

    const buffer = await render(context)
    const left = buffer.getChannelData(0)

    // Playback starts at cursor 0 (outside the [50,150) region) and plays
    // straight through, unaffected, until the cursor itself reaches the
    // region's end at source sample 150.
    expect(left[0]).toBeCloseTo(solo.channels[0][0], 6)
    expect(left[149]).toBeCloseTo(solo.channels[0][149], 6)
    // The very next sample wraps: cursor 149 -> next 150 >= endSample(150)
    // -> jumps to startSample(50). Rendered playback sample 150 is source
    // sample 50, not source sample 150.
    expect(left[150]).toBeCloseTo(solo.channels[0][50], 6)
    expect(left[150]).not.toBeCloseTo(solo.channels[0][150], 3)
    expect(left[151]).toBeCloseTo(solo.channels[0][51], 6)
    // The loop repeats every (150-50)=100 samples: it wraps again at
    // playback sample 250 (149 samples into the second pass through the
    // region, same as the first wrap).
    expect(left[250]).toBeCloseTo(solo.channels[0][50], 6)
  })

  test('seek jumps the shared cursor to an exact sample before playback resumes', async () => {
    const solo = lane('vocals', 0.1)
    await engine.load(makeSession([solo]))
    engine.setLaneGain('vocals', 1)
    engine.setMasterGain(1)
    engine.seek(80)
    engine.play()

    const buffer = await render(context)
    const left = buffer.getChannelData(0)

    expect(left[0]).toBeCloseTo(solo.channels[0][80], 6)
    expect(left[19]).toBeCloseTo(solo.channels[0][99], 6)
  })
})
