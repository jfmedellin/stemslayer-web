import { MAX_MIXER_LANES } from '../../domain/mixer/mixer'

/**
 * The `AudioWorkletNode` <-> `AudioWorkletProcessor` message/parameter
 * protocol for the Mixer (mirrors `infrastructure/onnx-worker/protocol.ts`'s
 * precedent: a typed, documented contract written before the processor body
 * that consumes it).
 *
 * Two delivery mechanisms, chosen per concern:
 *
 * - **Per-lane gain: `AudioParam`s**, not `port.postMessage`. Every render
 *   quantum, `AudioWorkletProcessor.process` receives the *current* value of
 *   every registered `AudioParam` with no queue to drain and no ordering to
 *   reason about — the audio graph's own automation timeline is the source
 *   of truth. A `postMessage` gain update is asynchronous relative to
 *   `process()`: it can arrive mid-quantum, be reordered against other
 *   pending messages, or (worse, under load) be delayed enough to render a
 *   handful of quanta at a stale gain — exactly the kind of glitch the
 *   mute/solo formula (`domain/mixer/mixer.ts`'s `effectiveGain`) needs to
 *   avoid, since a mute/solo toggle is expected to be inaudible-fast and
 *   deterministic. `parameterDescriptors` is a static class member, so it is
 *   sized for the largest published profile's lane count
 *   (`MAX_MIXER_LANES`, Rock's 6) rather than however many lanes the
 *   current session actually has; unused slots simply stay at their default
 *   gain of 0 and are never read because `load` also carries the session's
 *   real lane count and order.
 * - **Load/play/pause/seek/loop-region: `port.postMessage`.** These are
 *   discrete, structured commands (a seek carries a sample position and
 *   possibly a stop-then-restart; a loop-region update carries two values
 *   that must apply atomically together), not a single continuously-varying
 *   number — `AudioParam` automation has no natural fit for "jump the
 *   shared cursor to sample N right now" or "these two numbers must land as
 *   one loop region, never a torn read of the old start with the new end".
 *   `postMessage` delivers these as one atomic object each.
 *
 * Master gain never crosses this protocol at all: it is a separate native
 * `GainNode` positioned after the worklet node's output
 * (`docs/decisions/architecture.md`'s Runtime topology), set directly via
 * `GainNode.gain.value` on the main thread like any other Web Audio node.
 */

/** One lane's planar stereo PCM plus display metadata, transferred (not copied) into the worklet on `load`. */
export interface MixerWorkletLane {
  readonly laneId: string
  readonly displayName: string
  readonly channels: readonly [Float32Array, Float32Array]
  readonly absent: boolean
}

export interface MixerWorkletLoadMessage {
  readonly kind: 'load'
  readonly sampleRate: number
  readonly frameCount: number
  readonly lanes: readonly MixerWorkletLane[]
}

export interface MixerWorkletPlayMessage {
  readonly kind: 'play'
}

export interface MixerWorkletPauseMessage {
  readonly kind: 'pause'
}

export interface MixerWorkletSeekMessage {
  readonly kind: 'seek'
  readonly sample: number
}

export interface MixerWorkletLoopRangeMessage {
  readonly kind: 'set-loop-range'
  readonly range: Readonly<{ startSample: number; endSample: number }> | null
}

export type MixerWorkletInboundMessage =
  | MixerWorkletLoadMessage
  | MixerWorkletPlayMessage
  | MixerWorkletPauseMessage
  | MixerWorkletSeekMessage
  | MixerWorkletLoopRangeMessage

/**
 * Batched playhead/time-readout update, posted roughly every
 * `PROGRESS_INTERVAL_SECONDS` of rendered audio rather than every ~2.9 ms
 * render quantum (128 samples @ 44.1kHz) — posting every quantum would
 * flood the main thread with ~344 messages/second for no consumer benefit
 * and cost audio-thread cycles better spent mixing.
 */
export interface MixerWorkletProgressMessage {
  readonly kind: 'progress'
  readonly currentSample: number
  readonly isPlaying: boolean
}

export type MixerWorkletOutboundMessage = MixerWorkletProgressMessage

/** ~20 ms of batching between progress posts, independent of sample rate. */
export const PROGRESS_INTERVAL_SECONDS = 0.02

/**
 * The registered processor name, shared between `mixer-processor.ts`
 * (`registerProcessor` call, inside the worklet realm) and
 * `web-audio-engine.ts` (`new AudioWorkletNode(context, name, …)`, on the
 * main thread). Lives here rather than being imported from
 * `mixer-processor.ts` itself: that file's top-level `registerProcessor`
 * call only works inside `AudioWorkletGlobalScope` (loaded exclusively via
 * `audioContext.audioWorklet.addModule`), so nothing outside the worklet may
 * import it directly — doing so would run that side effect against the
 * ambient-only `AudioWorkletProcessor`/`registerProcessor` declarations on
 * the main thread, where they don't actually exist at runtime.
 */
export const MIXER_PROCESSOR_NAME = 'stemslayer-mixer'

/** The fixed `AudioParam` name for a given lane slot index (`0 <= index < MAX_MIXER_LANES`). */
export function laneGainParamName(index: number): string {
  return `lane${index}Gain`
}

export const LANE_GAIN_PARAM_NAMES: readonly string[] =
  Array.from({ length: MAX_MIXER_LANES }, (_unused, index) => laneGainParamName(index))

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function finiteNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
}

function stereoChannels(value: unknown): value is readonly [Float32Array, Float32Array] {
  return Array.isArray(value)
    && value.length === 2
    && value[0] instanceof Float32Array
    && value[1] instanceof Float32Array
    && value[0].length === value[1].length
}

function isLane(value: unknown): value is MixerWorkletLane {
  const lane = record(value)
  return lane !== undefined
    && nonEmptyString(lane.laneId)
    && nonEmptyString(lane.displayName)
    && stereoChannels(lane.channels)
    && typeof lane.absent === 'boolean'
}

export function isMixerWorkletLoadMessage(value: unknown): value is MixerWorkletLoadMessage {
  const message = record(value)
  return message !== undefined
    && message.kind === 'load'
    && finiteNonNegativeInteger(message.sampleRate)
    && finiteNonNegativeInteger(message.frameCount)
    && Array.isArray(message.lanes)
    && message.lanes.length > 0
    && message.lanes.length <= MAX_MIXER_LANES
    && message.lanes.every(isLane)
}

export function isMixerWorkletSeekMessage(value: unknown): value is MixerWorkletSeekMessage {
  const message = record(value)
  return message !== undefined && message.kind === 'seek' && finiteNonNegativeInteger(message.sample)
}

export function isMixerWorkletLoopRangeMessage(value: unknown): value is MixerWorkletLoopRangeMessage {
  const message = record(value)
  if (message === undefined || message.kind !== 'set-loop-range') return false
  if (message.range === null) return true
  const range = record(message.range)
  return range !== undefined
    && finiteNonNegativeInteger(range.startSample)
    && finiteNonNegativeInteger(range.endSample)
}

export function isMixerWorkletInboundMessage(value: unknown): value is MixerWorkletInboundMessage {
  const message = record(value)
  if (message === undefined) return false
  if (message.kind === 'play' || message.kind === 'pause') return true
  if (message.kind === 'load') return isMixerWorkletLoadMessage(value)
  if (message.kind === 'seek') return isMixerWorkletSeekMessage(value)
  if (message.kind === 'set-loop-range') return isMixerWorkletLoopRangeMessage(value)
  return false
}
