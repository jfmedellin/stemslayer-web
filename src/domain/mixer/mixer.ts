import { BASIC_PROFILE, type StemLane } from '../stem-profile'

/**
 * Pure mixer domain: gain math, mute/solo resolution, loop-range cursor
 * wrapping, skip/seek clamping, lane-layout guards, and the async-load
 * generation guard. No browser APIs — matches `domain/track.ts` and
 * `domain/stem-profile.ts`'s style. Ports the exact desktop rules cited in
 * `docs/decisions/feature-parity.md`'s Mixer section.
 */

export class MixerDomainError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'MixerDomainError'
  }
}

const reject = (code: string): never => {
  throw new MixerDomainError(code)
}

/** Exact desktop skip/seek constant (`gui.py:121`, `SKIP_SECONDS = 10.0`). */
export const SKIP_SECONDS = 10.0

/**
 * The largest published profile's lane count (Rock, 6 lanes) — sizes the
 * AudioWorklet's fixed `parameterDescriptors` slots for per-lane gain.
 */
export const MAX_MIXER_LANES = 6

/** Suffix appended to an absentable lane's label instead of hiding it (`gui.py:100`, `ABSENT_LANE_SUFFIX`). */
export const ABSENT_LANE_SUFFIX = ' · NOT IN THIS TRACK'

/**
 * The 4-lane Basic layout, reused as the error placeholder a failed session
 * load falls back to (`mixer_controller.py:658-671`).
 */
export const FALLBACK_MIXER_PROFILE = BASIC_PROFILE

/**
 * Per-lane 0-100% volume control mapped linearly to 0.0-1.0
 * (`engine/mixer.py:7-15`, `gain_from_percent`). Takes `unknown` (not
 * `number`) because the desktop contract explicitly rejects non-numeric and
 * boolean input at the boundary rather than relying on a static type to rule
 * it out — this function is the runtime guard. Rejects non-finite,
 * out-of-range, boolean, or non-numeric input with `mixer.invalid_volume`.
 */
export function gainFromPercent(percent: unknown): number {
  if (
    typeof percent !== 'number'
    || !Number.isFinite(percent)
    || percent < 0
    || percent > 100
  ) {
    reject('mixer.invalid_volume')
  }
  return (percent as number) / 100
}

/**
 * Master gain is a separate 0-100% control applied after the per-lane mix
 * sum, before the output clip (`engine/playback.py:143-146,375-377`).
 * Unlike `gainFromPercent`, out-of-range values are clamped, not refused
 * (`mixer_controller.set_master_percent`); a non-finite value is treated as
 * silence rather than thrown.
 */
export function masterGainFromPercent(percent: number): number {
  const value = Number.isFinite(percent) ? percent : 0
  const clamped = Math.min(100, Math.max(0, value))
  return clamped / 100
}

export interface MixerLaneState {
  readonly laneId: string
  readonly gainPercent: number
  readonly muted: boolean
  readonly solo: boolean
}

/**
 * Exact multi-solo rule (`engine/mixer.py:49-57`, `effective_gains`):
 * `muted OR (anySolo AND NOT thisLane.solo) -> 0`. `anySolo` is computed
 * once across the whole lane set and passed in so callers can batch-resolve
 * without recomputing it per lane.
 */
export function effectiveGain(
  lane: Pick<MixerLaneState, 'gainPercent' | 'muted' | 'solo'>,
  anySolo: boolean,
): number {
  if (lane.muted || (anySolo && !lane.solo)) return 0
  return gainFromPercent(lane.gainPercent)
}

/** Resolves every lane's effective gain against the same multi-solo rule in one pass. */
export function resolveEffectiveGains(lanes: readonly MixerLaneState[]): ReadonlyMap<string, number> {
  const anySolo = lanes.some((lane) => lane.solo)
  return new Map(lanes.map((lane) => [lane.laneId, effectiveGain(lane, anySolo)]))
}

/** Clamps a sample position into `[0, frameCount]`. */
export function clampSample(sample: number, frameCount: number): number {
  return Math.min(frameCount, Math.max(0, sample))
}

/**
 * Skip/seek: jumps exactly `SKIP_SECONDS` (10.0 s) forward/back, clamped to
 * `[0, frameCount]` (`gui.py:121`; `mixer_controller.py:368-382`, `nudge`).
 */
export function nudgeSample(
  currentSample: number,
  direction: 1 | -1,
  sampleRate: number,
  frameCount: number,
): number {
  const delta = Math.round(SKIP_SECONDS * sampleRate) * direction
  return clampSample(currentSample + delta, frameCount)
}

export interface LoopRange {
  readonly startSample: number
  readonly endSample: number
}

/**
 * A nullable start/end sample pair. `null` means no looping (playback stops
 * at `frameCount`); a region loops the shared cursor within
 * `[startSample, endSample)` — a whole-track loop is simply
 * `{startSample: 0, endSample: frameCount}` (design reconciliation in
 * `odd/tasks/p9-mixer.md`: the accepted A/B-region superset of
 * `feature-parity.md`'s baseline whole-track-loop-to-0 behavior).
 */
export function createLoopRange(startSample: number, endSample: number, frameCount: number): LoopRange {
  if (
    !Number.isFinite(startSample)
    || !Number.isFinite(endSample)
    || startSample < 0
    || endSample > frameCount
    || startSample >= endSample
  ) {
    reject('mixer.invalid_loop_range')
  }
  return Object.freeze({ startSample, endSample })
}

/**
 * Advances the shared sample cursor by one sample. With a loop range, wraps
 * from the region's end back to its start (`engine/playback.py:322-341`:
 * "the seam between passes stays inaudible" — ported here as the worklet's
 * shared-cursor wrap instead of the desktop's reader-reseek mechanism, since
 * one worklet node already drives every lane from one cursor). With no loop
 * range, holds at `frameCount` once reached instead of wrapping.
 */
export function advanceCursor(cursor: number, frameCount: number, loopRange: LoopRange | null): number {
  const next = cursor + 1
  if (loopRange !== null) {
    return next >= loopRange.endSample ? loopRange.startSample : next
  }
  return next >= frameCount ? frameCount : next
}

export interface LaneIdentity {
  readonly laneId: string
  readonly displayName: string
  readonly known: boolean
}

/**
 * An unrecognized lane name (future/unknown profile) still renders with a
 * readable fallback label instead of erroring (`gui.py:97-99,151-164`).
 * Defensive/forward-compat behavior kept even though only 2 fixed web
 * profiles currently exist.
 */
export function describeLane(laneId: string, lanes: readonly StemLane[]): LaneIdentity {
  const known = lanes.find((lane) => lane.laneId === laneId)
  if (known !== undefined) return { laneId, displayName: known.displayName, known: true }
  return { laneId, displayName: laneId.toUpperCase(), known: false }
}

/**
 * A lane name outside the currently published layout is refused by every
 * mixer command (`mixer_controller.py:559-569`, `_stem_index`) — unlike
 * `describeLane`'s render-time fallback, a command against an unknown lane
 * is a programming error, not a display concern.
 */
export function assertLaneInLayout(laneId: string, lanes: readonly StemLane[]): void {
  if (!lanes.some((lane) => lane.laneId === laneId)) reject('mixer.lane_outside_layout')
}

/** Peak/waveform envelope bin count per lane (`engine/stem_session.py:30`, `PEAK_BIN_COUNT`). */
export const PEAK_BIN_COUNT = 2000

/**
 * Downsamples a lane's decoded planar stereo PCM into `binCount` max-abs
 * bins for the waveform strip (`feature-parity.md`'s Mixer "Peak/waveform
 * envelope" row: "2000 max-abs bins per lane, computed once when the
 * session loads"). Combines both channels into one envelope per lane (the
 * strip draws one waveform per lane, not per channel) by taking, in each
 * bin, whichever channel has the greater max-abs sample — the simplest
 * reduction that still reflects true peak loudness in either channel,
 * equally correct to a left-only or mid/side reduction for a purely visual
 * envelope (writer's call, per the task's own explicit permission to choose).
 */
export function computePeakEnvelope(
  channels: readonly [Float32Array, Float32Array],
  binCount: number = PEAK_BIN_COUNT,
): Float32Array {
  const frameCount = channels[0].length
  const peaks = new Float32Array(binCount)
  if (frameCount === 0 || binCount === 0) return peaks

  for (let bin = 0; bin < binCount; bin += 1) {
    const start = Math.floor((bin * frameCount) / binCount)
    const end = Math.max(start + 1, Math.floor(((bin + 1) * frameCount) / binCount))
    let max = 0
    for (let frame = start; frame < end && frame < frameCount; frame += 1) {
      const left = Math.abs(channels[0][frame])
      const right = Math.abs(channels[1][frame])
      const value = left > right ? left : right
      if (value > max) max = value
    }
    peaks[bin] = max
  }
  return peaks
}

/**
 * Async load generation token: `openInMixer`/the loading caller takes a
 * token via `next()` before starting an async load and checks `isStale()`
 * once it resolves, so a superseded load's result is discarded rather than
 * applied (`mixer_controller.py:175-236`).
 */
export class MixerLoadGeneration {
  private current = 0

  next(): number {
    this.current += 1
    return this.current
  }

  isStale(token: number): boolean {
    return token !== this.current
  }
}
