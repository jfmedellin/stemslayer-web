import type { LoopRange } from '../../domain/mixer/mixer'

/**
 * One lane's metadata loaded into the `AudioEnginePort`, with optional
 * planar PCM retained only for small compatibility/fallback sessions.
 * `absent` marks an absentable lane (Rock's `guitar_center`/`guitar_sides`)
 * whose decoded samples were all exactly 0: it is still included as real,
 * fully controllable, aligned silence rather than hidden
 * (`docs/decisions/feature-parity.md`'s Mixer section, "Absent lane").
 */
export interface MixerSessionLane {
  readonly laneId: string
  readonly displayName: string
  /** Planar stereo PCM for legacy in-memory sessions; absent on range-backed sessions. */
  readonly channels?: readonly [Float32Array, Float32Array]
  readonly absent: boolean
  /** Incrementally calculated waveform, present for OPFS-backed streaming sessions. */
  readonly peaks?: Float32Array
}

export type MixerFrameBlock = readonly (readonly [Float32Array, Float32Array])[]

/**
 * The session `openInMixer` builds and hands to `AudioEnginePort.load`: one
 * `AudioContext`/one `AudioWorkletNode` mixes every lane from one shared
 * cursor, using bounded `readFrames` blocks when the source is OPFS-backed
 * (`docs/decisions/architecture.md`, Runtime
 * topology). `fallback` marks the 4-lane Basic-layout error placeholder a
 * failed load produces instead of throwing
 * (`mixer_controller.py:658-671`).
 */
export interface MixerSession {
  readonly trackId: string
  readonly sampleRate: number
  readonly frameCount: number
  readonly lanes: readonly MixerSessionLane[]
  readonly fallback: boolean
  /** Reads one synchronized range from every lane; omitted only by legacy in-memory sessions. */
  readonly readFrames?: (startFrame: number, frameCount: number, signal?: AbortSignal) => Promise<MixerFrameBlock>
}

/** Playback position/state pushed back on transport changes and a batched interval, not per render quantum. */
export interface MixerPlaybackProgress {
  readonly currentSample: number
  readonly isPlaying: boolean
  readonly isBuffering?: boolean
  /** Stable status code only; storage errors and file details stay private. */
  readonly rangeError?: 'range-read-failed'
}

/**
 * Real-time stem playback, implemented by `src/infrastructure/web-audio/`
 * (an `AudioWorkletNode` mixing every lane's planar Float32 buffers with one
 * shared cursor, `docs/decisions/architecture.md`'s Runtime topology).
 *
 * Per-lane gain is already mute/solo-resolved by the domain
 * (`effectiveGain`/`resolveEffectiveGains` in `src/domain/mixer/mixer.ts`)
 * before it reaches `setLaneGain` — the port only ever receives the final
 * 0.0-1.0 value to apply, never raw percent/mute/solo state.
 */
export interface AudioEnginePort {
  /** Replaces whatever session is currently loaded; stops playback first. */
  load(session: MixerSession): Promise<void>
  /** Stops playback and aborts any in-flight range reads before a track switch. */
  cancelPendingReads(): void
  /** `gain` is the already-resolved effective gain (0.0-1.0), not a raw percent. */
  setLaneGain(laneId: string, gain: number): void
  /** `gain` is `masterGainFromPercent`'s 0.0-1.0 result. */
  setMasterGain(gain: number): void
  /** `null` disables looping; a region loops the shared cursor within it. */
  setLoopRange(range: LoopRange | null): void
  play(): void
  pause(): void
  seek(sample: number): void
  /** Subscribes to transport-change and batched progress updates; returns an unsubscribe function. */
  onProgress(listener: (progress: MixerPlaybackProgress) => void): () => void
  /** Releases the `AudioContext`/worklet node; the port instance is unusable afterward. */
  dispose(): void
}
