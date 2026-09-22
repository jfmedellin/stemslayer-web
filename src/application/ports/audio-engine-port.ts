/**
 * Loads a track's stem lanes into the mixer for playback
 * (`docs/decisions/architecture.md`, Runtime topology: one `AudioContext`,
 * one `AudioWorkletNode` mixing every lane). Implemented by P9 (Web Audio
 * adapter).
 *
 * The concrete session/lane payload shape is defined when P9 designs the
 * mixer state; no P3a use case calls this port, so it is declared with an
 * `unknown` payload rather than a speculative contract.
 */
export interface AudioEnginePort {
  load(session: unknown): Promise<void>
}
