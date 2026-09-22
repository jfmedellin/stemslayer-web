import type {
  AudioEnginePort,
  MixerSession,
} from '../../src/application/ports/audio-engine-port'

/** Records every `load()` call for assertion; the rest of the port is a no-op. */
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
