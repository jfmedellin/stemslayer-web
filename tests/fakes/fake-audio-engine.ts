import type {
  AudioEnginePort,
  MixerPlaybackProgress,
  MixerSession,
} from '../../src/application/ports/audio-engine-port'
import type { LoopRange } from '../../src/domain/mixer/mixer'

/**
 * Records every `load()` call for assertion; the rest of the port is a
 * no-op. Used by `tests/application/open-in-mixer.test.ts` (P9A), which only
 * needs to assert what `openInMixer` handed to `AudioEnginePort.load`.
 */
export class FakeAudioEngine implements AudioEnginePort {
  readonly loadedSessions: MixerSession[] = []

  async load(session: MixerSession): Promise<void> {
    this.loadedSessions.push(session)
  }

  setLaneGain(): void {}
  setMasterGain(): void {}
  setLoopRange(): void {}
  play(): void {}
  pause(): void {}
  seek(): void {}

  onProgress(): () => void {
    return () => {}
  }

  dispose(): void {}
}

/**
 * A recording `AudioEnginePort` test double: captures every call instead of
 * touching real Web Audio, so `MixerPage`'s UI/interaction browser tests
 * (P9B) can assert exactly which domain-resolved values the container
 * pushed into the port (mute/solo -> `effectiveGain`, master gain ->
 * `masterGainFromPercent`, skip/seek -> `nudgeSample`-clamped samples, loop
 * region -> the domain's `LoopRange`) without depending on real audio-thread
 * timing. The engine's own `AudioParam`/worklet mixing correctness is
 * already proven end to end by
 * `src/infrastructure/web-audio/web-audio-engine.browser.test.ts`'s real
 * `OfflineAudioContext` renders — re-driving the same worklet code path
 * through a full React-UI round trip here would only re-prove that, not any
 * new logic this layer owns.
 */
export class FakeAudioEnginePort implements AudioEnginePort {
  session: MixerSession | undefined
  readonly laneGainCalls: Array<{ laneId: string; gain: number }> = []
  readonly masterGainCalls: number[] = []
  readonly loopRangeCalls: Array<LoopRange | null> = []
  readonly seekCalls: number[] = []
  playCalls = 0
  pauseCalls = 0
  disposed = false

  private currentSample = 0
  private isPlaying = false
  private readonly listeners = new Set<(progress: MixerPlaybackProgress) => void>()

  async load(session: MixerSession): Promise<void> {
    this.session = session
    this.currentSample = 0
    this.isPlaying = false
  }

  setLaneGain(laneId: string, gain: number): void {
    this.laneGainCalls.push({ laneId, gain })
  }

  setMasterGain(gain: number): void {
    this.masterGainCalls.push(gain)
  }

  setLoopRange(range: LoopRange | null): void {
    this.loopRangeCalls.push(range)
  }

  play(): void {
    this.playCalls += 1
    this.isPlaying = true
    this.emit()
  }

  pause(): void {
    this.pauseCalls += 1
    this.isPlaying = false
    this.emit()
  }

  seek(sample: number): void {
    this.seekCalls.push(sample)
    this.currentSample = sample
    this.emit()
  }

  onProgress(listener: (progress: MixerPlaybackProgress) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  private emit(): void {
    const progress: MixerPlaybackProgress = { currentSample: this.currentSample, isPlaying: this.isPlaying }
    for (const listener of this.listeners) listener(progress)
  }
}
