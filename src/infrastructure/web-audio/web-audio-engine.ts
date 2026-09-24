import { MAX_MIXER_LANES, type LoopRange } from '../../domain/mixer/mixer'
import type {
  AudioEnginePort,
  MixerPlaybackProgress,
  MixerSession,
} from '../../application/ports/audio-engine-port'
import {
  MIXER_PROCESSOR_NAME,
  laneGainParamName,
  type MixerWorkletInboundMessage,
  type MixerWorkletLane,
  type MixerWorkletOutboundMessage,
} from './protocol'

function defaultProcessorUrl(): URL {
  return new URL('./mixer-processor.ts', import.meta.url)
}

function workletFailure(message: string): Error {
  return new Error(`web-audio-engine.failed:${message}`)
}

export interface WebAudioEngineOptions {
  /** Injectable for tests (`OfflineAudioContext`) — defaults to a real `AudioContext`. */
  readonly context?: BaseAudioContext
  readonly processorUrl?: string | URL
}

/**
 * Main-thread `AudioEnginePort` adapter: one `AudioContext`
 * (or an injected `OfflineAudioContext` for tests), one `AudioWorkletNode`
 * running `MixerProcessor` (`mixer-processor.ts`), and a native master
 * `GainNode` positioned after the worklet node's output, feeding
 * `context.destination` (`docs/decisions/architecture.md`'s Runtime
 * topology).
 */
export class WebAudioEngine implements AudioEnginePort {
  private readonly context: BaseAudioContext
  private readonly processorUrl: string | URL
  private moduleLoaded = false
  private node: AudioWorkletNode | undefined
  private masterGain: GainNode | undefined
  private laneIndexById = new Map<string, number>()
  private readonly progressListeners = new Set<(progress: MixerPlaybackProgress) => void>()
  private playbackRequest = 0

  constructor(options: WebAudioEngineOptions = {}) {
    this.context = options.context ?? new AudioContext()
    this.processorUrl = options.processorUrl ?? defaultProcessorUrl()
  }

  async load(session: MixerSession): Promise<void> {
    this.playbackRequest += 1
    if (session.lanes.length === 0 || session.lanes.length > MAX_MIXER_LANES) {
      throw workletFailure(`unsupported_lane_count:${session.lanes.length}`)
    }

    if (!this.moduleLoaded) {
      await this.context.audioWorklet.addModule(this.processorUrl)
      this.moduleLoaded = true
    }

    this.node?.disconnect()
    this.masterGain?.disconnect()

    const node = new AudioWorkletNode(this.context, MIXER_PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    })
    const masterGain = this.context.createGain()
    node.connect(masterGain)
    masterGain.connect(this.context.destination)
    node.port.onmessage = (event: MessageEvent<unknown>): void => {
      this.handleWorkletMessage(event.data)
    }
    node.onprocessorerror = (): void => {
      // Surfaced to progress listeners as a stall (isPlaying stays whatever
      // it last was); nothing else can be recovered from inside the port.
    }

    this.node = node
    this.masterGain = masterGain
    this.laneIndexById = new Map(session.lanes.map((lane, index) => [lane.laneId, index]))

    // Transfer a fresh copy of each channel into the worklet rather than the
    // session's own buffers: `openInMixer`'s caller keeps `session` around
    // afterward (e.g. the Mixer UI's waveform envelope reads the same
    // decoded PCM), and a `Transferable` transfer detaches the original
    // buffer from its owner. The `postMessage` boundary itself still costs
    // zero extra copies either way (`Transferable` transfer is O(1)
    // regardless of size); only this one explicit `.slice()` pays the
    // unavoidable linear cost of giving the worklet memory nobody else
    // touches concurrently.
    const lanes: MixerWorkletLane[] = session.lanes.map((lane) => ({
      laneId: lane.laneId,
      displayName: lane.displayName,
      channels: [lane.channels[0].slice(), lane.channels[1].slice()] as const,
      absent: lane.absent,
    }))
    const transfer: Transferable[] = lanes.flatMap(
      (lane) => lane.channels.map((channel) => channel.buffer as ArrayBuffer),
    )
    const message: MixerWorkletInboundMessage = {
      kind: 'load',
      sampleRate: session.sampleRate,
      frameCount: session.frameCount,
      lanes,
    }
    node.port.postMessage(message, transfer)
  }

  private requireNode(): AudioWorkletNode {
    if (this.node === undefined) throw workletFailure('no_session_loaded')
    return this.node
  }

  setLaneGain(laneId: string, gain: number): void {
    const node = this.requireNode()
    const index = this.laneIndexById.get(laneId)
    if (index === undefined) throw workletFailure(`unknown_lane:${laneId}`)
    const param = node.parameters.get(laneGainParamName(index))
    if (param === undefined) throw workletFailure(`missing_gain_param:${laneId}`)
    param.value = gain
  }

  setMasterGain(gain: number): void {
    if (this.masterGain === undefined) throw workletFailure('no_session_loaded')
    this.masterGain.gain.value = gain
  }

  setLoopRange(range: LoopRange | null): void {
    const node = this.requireNode()
    const message: MixerWorkletInboundMessage = { kind: 'set-loop-range', range }
    node.port.postMessage(message)
  }

  play(): void {
    const node = this.requireNode()
    const message: MixerWorkletInboundMessage = { kind: 'play' }
    const request = ++this.playbackRequest
    if (this.context instanceof AudioContext && this.context.state !== 'running') {
      if (this.context.state === 'closed') return
      void this.context.resume().then(() => {
        if (request === this.playbackRequest && this.node === node) node.port.postMessage(message)
      }).catch(() => undefined)
      return
    }
    node.port.postMessage(message)
  }

  pause(): void {
    const node = this.requireNode()
    this.playbackRequest += 1
    const message: MixerWorkletInboundMessage = { kind: 'pause' }
    node.port.postMessage(message)
  }

  seek(sample: number): void {
    const node = this.requireNode()
    const message: MixerWorkletInboundMessage = { kind: 'seek', sample }
    node.port.postMessage(message)
  }

  onProgress(listener: (progress: MixerPlaybackProgress) => void): () => void {
    this.progressListeners.add(listener)
    return () => {
      this.progressListeners.delete(listener)
    }
  }

  dispose(): void {
    this.node?.disconnect()
    this.masterGain?.disconnect()
    this.node = undefined
    this.masterGain = undefined
    this.progressListeners.clear()
    if ('close' in this.context && typeof this.context.close === 'function' && this.context.state !== 'closed') {
      void this.context.close().catch(() => undefined)
    }
  }

  private handleWorkletMessage(data: unknown): void {
    if (!isProgressMessage(data)) return
    const progress: MixerPlaybackProgress = { currentSample: data.currentSample, isPlaying: data.isPlaying }
    for (const listener of this.progressListeners) listener(progress)
  }
}

function isProgressMessage(value: unknown): value is MixerWorkletOutboundMessage {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'progress'
}
