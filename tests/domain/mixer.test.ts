import { describe, expect, test } from 'vitest'

import { BASIC_PROFILE } from '../../src/domain/stem-profile'
import {
  FALLBACK_MIXER_PROFILE,
  MAX_MIXER_LANES,
  MixerDomainError,
  MixerLoadGeneration,
  PEAK_BIN_COUNT,
  SKIP_SECONDS,
  advanceCursor,
  assertLaneInLayout,
  clampSample,
  computePeakEnvelope,
  createLoopRange,
  describeLane,
  effectiveGain,
  gainFromPercent,
  masterGainFromPercent,
  nudgeSample,
  resolveEffectiveGains,
  type MixerLaneState,
} from '../../src/domain/mixer/mixer'

// Translated from `test_audio_publication.test_volume_percent_maps_only_to_attenuation`
// (`engine/mixer.py:7-15`, `gain_from_percent`).
describe('gainFromPercent', () => {
  test('maps 0-100% linearly to 0.0-1.0', () => {
    expect(gainFromPercent(0)).toBe(0)
    expect(gainFromPercent(50)).toBe(0.5)
    expect(gainFromPercent(100)).toBe(1)
  })

  test.each([
    ['non-finite', Number.NaN],
    ['non-finite infinity', Number.POSITIVE_INFINITY],
    ['out-of-range below', -1],
    ['out-of-range above', 101],
    ['boolean', true],
    ['non-numeric string', '50'],
    ['non-numeric null', null],
    ['non-numeric undefined', undefined],
  ] satisfies ReadonlyArray<readonly [string, unknown]>)(
    'rejects %s with mixer.invalid_volume',
    (_label, value) => {
      expect(() => gainFromPercent(value)).toThrowError(MixerDomainError)
      try {
        gainFromPercent(value)
      } catch (error) {
        expect(error).toMatchObject({ code: 'mixer.invalid_volume' })
      }
    },
  )
})

// Translated from
// `test_audio_publication.test_effective_gains_apply_volume_mute_and_multiple_solo`
// (`engine/mixer.py:49-57`, `effective_gains`). Exact rule:
// `muted OR (anySolo AND NOT thisLane.solo) -> 0`.
describe('effectiveGain / resolveEffectiveGains', () => {
  test('a muted lane is silent even when nothing is soloed', () => {
    const lane: MixerLaneState = { laneId: 'vocals', gainPercent: 80, muted: true, solo: false }
    expect(effectiveGain(lane, false)).toBe(0)
  })

  test('an unmuted, unsoloed lane keeps its own gain when no lane is soloed', () => {
    const lane: MixerLaneState = { laneId: 'vocals', gainPercent: 80, muted: false, solo: false }
    expect(effectiveGain(lane, false)).toBe(0.8)
  })

  test('when any lane is soloed, a non-soloed lane is silenced even if unmuted', () => {
    const lane: MixerLaneState = { laneId: 'drums', gainPercent: 100, muted: false, solo: false }
    expect(effectiveGain(lane, true)).toBe(0)
  })

  test('a soloed lane keeps its own gain even while other lanes are also soloed (multi-solo)', () => {
    const lane: MixerLaneState = { laneId: 'drums', gainPercent: 60, muted: false, solo: true }
    expect(effectiveGain(lane, true)).toBe(0.6)
  })

  test('muted always wins over solo', () => {
    const lane: MixerLaneState = { laneId: 'bass', gainPercent: 100, muted: true, solo: true }
    expect(effectiveGain(lane, true)).toBe(0)
  })

  test('resolves a full lane set with multiple simultaneous solos', () => {
    const lanes: readonly MixerLaneState[] = [
      { laneId: 'vocals', gainPercent: 100, muted: false, solo: true },
      { laneId: 'drums', gainPercent: 100, muted: false, solo: true },
      { laneId: 'bass', gainPercent: 100, muted: false, solo: false },
      { laneId: 'other', gainPercent: 100, muted: true, solo: true },
    ]
    const gains = resolveEffectiveGains(lanes)
    expect(gains.get('vocals')).toBe(1)
    expect(gains.get('drums')).toBe(1)
    expect(gains.get('bass')).toBe(0)
    expect(gains.get('other')).toBe(0)
  })
})

// Translated from `test_playback.test_the_master_gain_rides_in_front_of_the_output_clip`
// (`engine/playback.py:143-146,375-377`) — clamped, not refused
// (`mixer_controller.set_master_percent`).
describe('masterGainFromPercent', () => {
  test('maps 0-100% linearly to 0.0-1.0', () => {
    expect(masterGainFromPercent(0)).toBe(0)
    expect(masterGainFromPercent(75)).toBe(0.75)
    expect(masterGainFromPercent(100)).toBe(1)
  })

  test('clamps out-of-range values instead of refusing them', () => {
    expect(masterGainFromPercent(-20)).toBe(0)
    expect(masterGainFromPercent(150)).toBe(1)
  })

  test('treats a non-finite value as silence rather than throwing', () => {
    expect(masterGainFromPercent(Number.NaN)).toBe(0)
  })
})

// Translated from `test_mixer_controller.TransportTests.test_nudging_clamps_at_both_ends_of_the_track`
// (`gui.py:121`, `SKIP_SECONDS = 10.0`; `mixer_controller.py:368-382`, `nudge`).
describe('nudgeSample', () => {
  const sampleRate = 44_100
  const frameCount = 20 * sampleRate // 20 s track

  test('nudges forward by exactly 10.0 seconds', () => {
    expect(nudgeSample(0, 1, sampleRate, frameCount)).toBe(SKIP_SECONDS * sampleRate)
  })

  test('nudges backward by exactly 10.0 seconds', () => {
    const start = 15 * sampleRate
    expect(nudgeSample(start, -1, sampleRate, frameCount)).toBe(start - SKIP_SECONDS * sampleRate)
  })

  test('clamps at the start of the track', () => {
    expect(nudgeSample(3 * sampleRate, -1, sampleRate, frameCount)).toBe(0)
  })

  test('clamps at the end of the track', () => {
    expect(nudgeSample(frameCount - 2 * sampleRate, 1, sampleRate, frameCount)).toBe(frameCount)
  })
})

describe('clampSample', () => {
  test('clamps into [0, frameCount]', () => {
    expect(clampSample(-5, 100)).toBe(0)
    expect(clampSample(150, 100)).toBe(100)
    expect(clampSample(50, 100)).toBe(50)
  })
})

// Loop range: a nullable {startSample, endSample} pair; a region loop
// degenerates to a whole-track loop when start=0/end=frameCount (design
// reconciliation in `odd/tasks/p9-mixer.md`).
describe('loop range', () => {
  const frameCount = 1_000

  test('creates a valid region', () => {
    expect(createLoopRange(100, 900, frameCount)).toEqual({ startSample: 100, endSample: 900 })
  })

  test('rejects an inverted or out-of-bounds region', () => {
    expect(() => createLoopRange(900, 100, frameCount)).toThrowError(MixerDomainError)
    expect(() => createLoopRange(-1, 900, frameCount)).toThrowError(MixerDomainError)
    expect(() => createLoopRange(0, frameCount + 1, frameCount)).toThrowError(MixerDomainError)
  })

  // Translated from `test_playback.test_looping_restarts_the_track_instead_of_stopping`
  // (`engine/playback.py:322-341`) — ported as the worklet's shared-cursor wrap.
  test('advanceCursor wraps at the loop region end back to its start', () => {
    const range = createLoopRange(10, 20, frameCount)
    expect(advanceCursor(19, frameCount, range)).toBe(10)
  })

  test('advanceCursor holds at frameCount with no loop range instead of wrapping', () => {
    expect(advanceCursor(frameCount - 1, frameCount, null)).toBe(frameCount)
    expect(advanceCursor(frameCount, frameCount, null)).toBe(frameCount)
  })

  test('a whole-track loop range (0..frameCount) wraps back to 0', () => {
    const range = createLoopRange(0, frameCount, frameCount)
    expect(advanceCursor(frameCount - 1, frameCount, range)).toBe(0)
  })
})

// Translated from `test_gui_view_state.ProfileLaneViewModelTests.test_an_unknown_lane_still_renders_readably`
// (`gui.py:97-99,151-164`).
describe('describeLane', () => {
  test('a known lane resolves its display name', () => {
    expect(describeLane('vocals', BASIC_PROFILE.lanes)).toEqual({
      laneId: 'vocals', displayName: 'Vocals', known: true,
    })
  })

  test('an unrecognized lane still renders readably instead of throwing', () => {
    expect(describeLane('future-lane', BASIC_PROFILE.lanes)).toEqual({
      laneId: 'future-lane', displayName: 'FUTURE-LANE', known: false,
    })
  })
})

// Translated from `test_mixer_controller.ProfileLaneMixerTests.test_a_lane_outside_the_published_layout_is_refused`
// (`mixer_controller.py:559-569`, `_stem_index`).
describe('assertLaneInLayout', () => {
  test('accepts a lane published by the current layout', () => {
    expect(() => assertLaneInLayout('vocals', BASIC_PROFILE.lanes)).not.toThrow()
  })

  test('refuses a lane outside the published layout', () => {
    expect(() => assertLaneInLayout('future-lane', BASIC_PROFILE.lanes)).toThrowError(MixerDomainError)
    try {
      assertLaneInLayout('future-lane', BASIC_PROFILE.lanes)
    } catch (error) {
      expect(error).toMatchObject({ code: 'mixer.lane_outside_layout' })
    }
  })
})

// Translated from `test_mixer_controller.test_a_failed_load_falls_back_to_the_legacy_layout`
// (`mixer_controller.py:658-671`).
describe('FALLBACK_MIXER_PROFILE', () => {
  test('is the 4-lane Basic layout', () => {
    expect(FALLBACK_MIXER_PROFILE).toBe(BASIC_PROFILE)
    expect(FALLBACK_MIXER_PROFILE.lanes).toHaveLength(4)
  })
})

describe('MAX_MIXER_LANES', () => {
  test('matches the largest published profile\'s lane count (Rock, 6)', () => {
    expect(MAX_MIXER_LANES).toBe(6)
  })
})

// Waveform envelope for the Mixer UI's lane strip (`feature-parity.md`'s
// Mixer "Peak/waveform envelope" row): a pure downsampling max-abs
// reduction, no browser API.
describe('computePeakEnvelope', () => {
  test('produces exactly PEAK_BIN_COUNT bins by default', () => {
    const channel = new Float32Array(10_000)
    const peaks = computePeakEnvelope([channel, channel])
    expect(peaks).toHaveLength(PEAK_BIN_COUNT)
  })

  test('each bin holds the greater of either channel\'s max-abs sample in its range', () => {
    const left = Float32Array.from([0, 0.2, 0, 0, -0.9, 0, 0, 0, 0, 0])
    const right = Float32Array.from([0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0])
    const peaks = computePeakEnvelope([left, right], 2)
    // Bin 0 covers frames [0,5): max-abs across both channels is 0.9 (left[4]).
    expect(peaks[0]).toBeCloseTo(0.9, 6)
    // Bin 1 covers frames [5,10): all zero.
    expect(peaks[1]).toBe(0)
  })

  test('an all-silent lane produces an all-zero envelope', () => {
    const channel = new Float32Array(500)
    const peaks = computePeakEnvelope([channel, channel], 10)
    expect([...peaks].every((value) => value === 0)).toBe(true)
  })

  test('handles a lane shorter than the requested bin count without throwing', () => {
    const channel = Float32Array.from([0.1, 0.2, 0.3])
    expect(() => computePeakEnvelope([channel, channel], PEAK_BIN_COUNT)).not.toThrow()
  })
})

// Translated from `test_mixer_controller.test_load_is_async_and_stale_result_is_rejected`
// (`mixer_controller.py:175-236`).
describe('MixerLoadGeneration', () => {
  test('a stale generation token is rejected once a newer load has started', () => {
    const generation = new MixerLoadGeneration()
    const first = generation.next()
    const second = generation.next()

    expect(generation.isStale(first)).toBe(true)
    expect(generation.isStale(second)).toBe(false)
  })

  test('the very first load is not stale until superseded', () => {
    const generation = new MixerLoadGeneration()
    const token = generation.next()
    expect(generation.isStale(token)).toBe(false)
  })
})
