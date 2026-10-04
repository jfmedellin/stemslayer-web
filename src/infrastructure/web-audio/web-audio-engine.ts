import { MAX_MIXER_LANES, type LoopRange } from '../../domain/mixer/mixer'
import type {
  AudioEnginePort,
  MixerPlaybackProgress,
  MixerSession,
  MixerFrameBlock,
} from '../../application/ports/audio-engine-port'
import {
  MIXER_PROCESSOR_NAME,
  laneGainParamName,
  MIXER_PREFETCH_CHUNK_FRAMES,
  MIXER_PREFETCH_SLOT_COUNT,
  type MixerWorkletInboundMessage,
  type MixerWorkletLane,
  type MixerWorkletOutboundMessage,
} from './protocol'
import processorUrl from './mixer-processor.ts?worker&url'

function defaultProcessorUrl(): URL {
  return new URL(processorUrl, import.meta.url)
}

function workletFailure(message: string): Error {
  return new Error(`web-audio-engine.failed:${message}`)
}

export interface WebAudioEngineOptions {
  /** Injectable for tests (`OfflineAudioContext`) — defaults to a real `AudioContext`. */
  readonly context?: BaseAudioContext
  readonly processorUrl?: string | URL
  /** Module-loader seam for deterministic startup-race tests. */
  readonly loadProcessorModule?: (context: BaseAudioContext, processorUrl: string | URL) => Promise<void>
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
  private readonly loadProcessorModule: (context: BaseAudioContext, processorUrl: string | URL) => Promise<void>
  private moduleLoaded = false
  private moduleLoading: Promise<void> | undefined
  private loadGeneration = 0
  private disposed = false
  private node: AudioWorkletNode | undefined
  private masterGain: GainNode | undefined
  private laneIndexById = new Map<string, number>()
  private readonly progressListeners = new Set<(progress: MixerPlaybackProgress) => void>()
  private playbackRequest = 0
  private streamSession: MixerSession | undefined
  private streamAbort: AbortController | undefined
  private streamGeneration = 0
  private readonly activeChunks = new Set<number>()
  private readonly failedChunks = new Set<number>()
  private nextPrefetchFrame = 0
  private loopRange: LoopRange | null = null

  constructor(options: WebAudioEngineOptions = {}) {
    this.context = options.context ?? new AudioContext()
    this.processorUrl = options.processorUrl ?? defaultProcessorUrl()
    this.loadProcessorModule = options.loadProcessorModule
      ?? ((context, url) => context.audioWorklet.addModule(url))
  }

  async load(session: MixerSession): Promise<void> {
    if (this.disposed) throw workletFailure('disposed')
    const generation = ++this.loadGeneration
    this.playbackRequest += 1
    this.streamAbort?.abort()
    this.streamAbort = undefined
    this.streamSession = undefined
    this.activeChunks.clear()
    this.failedChunks.clear()
    this.loopRange = null
    this.streamGeneration += 1
    if (session.lanes.length === 0 || session.lanes.length > MAX_MIXER_LANES) {
      throw workletFailure(`unsupported_lane_count:${session.lanes.length}`)
    }
    if (session.readFrames === undefined) {
      const invalidLane = session.lanes.find((lane) => lane.channels === undefined
        || lane.channels[0].length !== session.frameCount
        || lane.channels[1].length !== session.frameCount)
      if (invalidLane !== undefined) throw workletFailure(`invalid_lane_pcm:${invalidLane.laneId}`)
    }

    try {
      await this.ensureModuleLoaded()
    } catch (error) {
      if (!this.isCurrentLoad(generation)) return
      throw error
    }
    if (!this.isCurrentLoad(generation)) return

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

    if (session.readFrames !== undefined) {
      const message: MixerWorkletInboundMessage = {
        kind: 'stream-load',
        sampleRate: session.sampleRate,
        frameCount: session.frameCount,
        lanes: session.lanes.map(({ laneId, displayName, absent }) => ({ laneId, displayName, absent })),
      }
      node.port.postMessage(message)
      this.streamSession = session
      await this.startPrefetch(0)
      if (!this.isCurrentLoad(generation)) return
      return
    }

    // Transfer a fresh copy of each channel into the worklet rather than the
    // session's own buffers: compatibility sessions may still be retained by
    // callers, and a `Transferable` transfer detaches the original
    // buffer from its owner. The `postMessage` boundary itself still costs
    // zero extra copies either way (`Transferable` transfer is O(1)
    // regardless of size); only this one explicit `.slice()` pays the
    // unavoidable linear cost of giving the worklet memory nobody else
    // touches concurrently.
    const lanes: MixerWorkletLane[] = session.lanes.map((lane) => ({
      laneId: lane.laneId,
      displayName: lane.displayName,
      channels: [lane.channels![0].slice(), lane.channels![1].slice()] as const,
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

  private ensureModuleLoaded(): Promise<void> {
    if (this.moduleLoaded) return Promise.resolve()
    if (this.moduleLoading !== undefined) return this.moduleLoading

    const loading = this.loadProcessorModule(this.context, this.processorUrl).then(() => {
      this.moduleLoaded = true
    }).finally(() => {
      if (this.moduleLoading === loading) this.moduleLoading = undefined
    })
    this.moduleLoading = loading
    return loading
  }

  private isCurrentLoad(generation: number): boolean {
    return !this.disposed && generation === this.loadGeneration
  }

  cancelPendingReads(): void {
    this.loadGeneration += 1
    this.playbackRequest += 1
    const session = this.streamSession
    this.streamAbort?.abort()
    this.streamAbort = undefined
    this.streamSession = undefined
    this.activeChunks.clear()
    this.failedChunks.clear()
    const node = this.node
    if (node !== undefined) {
      node.port.postMessage({ kind: 'pause' } satisfies MixerWorkletInboundMessage)
      if (session !== undefined) {
        node.port.postMessage({ kind: 'flush', sample: session.frameCount } satisfies MixerWorkletInboundMessage)
      }
    }
  }

  private startPrefetch(startFrame: number): Promise<void> {
    const session = this.streamSession
    const node = this.node
    if (session?.readFrames === undefined || node === undefined) return Promise.resolve()
    this.streamAbort?.abort()
    const abort = new AbortController()
    this.streamAbort = abort
    this.activeChunks.clear()
    this.nextPrefetchFrame = Math.floor(startFrame / MIXER_PREFETCH_CHUNK_FRAMES) * MIXER_PREFETCH_CHUNK_FRAMES
    this.streamGeneration += 1
    return this.pumpPrefetch(session, node, abort, this.streamGeneration)
  }

  private advancePrefetchFrame(startFrame: number): number {
    const nextFrame = startFrame + MIXER_PREFETCH_CHUNK_FRAMES
    if (this.loopRange === null) return nextFrame

    const loopStartFrame = Math.floor(this.loopRange.startSample / MIXER_PREFETCH_CHUNK_FRAMES)
      * MIXER_PREFETCH_CHUNK_FRAMES
    const loopEndFrame = Math.floor((this.loopRange.endSample - 1) / MIXER_PREFETCH_CHUNK_FRAMES)
      * MIXER_PREFETCH_CHUNK_FRAMES
    return nextFrame > loopEndFrame ? loopStartFrame : nextFrame
  }

  private pumpPrefetch(session: MixerSession, node: AudioWorkletNode, abort: AbortController, generation: number): Promise<void> {
    const reads: Promise<void>[] = []
    const visited = new Set<number>()
    while (this.activeChunks.size < MIXER_PREFETCH_SLOT_COUNT && this.nextPrefetchFrame < session.frameCount) {
      const startFrame = this.nextPrefetchFrame
      this.nextPrefetchFrame = this.advancePrefetchFrame(startFrame)
      if (visited.has(startFrame)) break
      visited.add(startFrame)
      if (this.activeChunks.has(startFrame)) continue

      const frameCount = Math.min(MIXER_PREFETCH_CHUNK_FRAMES, session.frameCount - startFrame)
      this.activeChunks.add(startFrame)
      reads.push(session.readFrames!(startFrame, frameCount, abort.signal).then((lanes: MixerFrameBlock) => {
        if (abort.signal.aborted || this.node !== node || generation !== this.streamGeneration) return
        this.failedChunks.delete(startFrame)
        const transfer = lanes.flatMap((lane) => lane.map((channel) => channel.buffer as ArrayBuffer))
        const message: MixerWorkletInboundMessage = { kind: 'chunk', startFrame, lanes }
        node.port.postMessage(message, transfer)
      }).catch(() => {
        if (generation !== this.streamGeneration || abort.signal.aborted || this.node !== node) return
        this.activeChunks.delete(startFrame)
        this.failedChunks.add(startFrame)
        node.port.postMessage({ kind: 'chunk-failed', startFrame } satisfies MixerWorkletInboundMessage)
      }))
    }
    return Promise.all(reads).then(() => undefined)
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
    this.loopRange = range
    if (range !== null && this.streamSession !== undefined && this.node === node) {
      const loopStartFrame = Math.floor(range.startSample / MIXER_PREFETCH_CHUNK_FRAMES)
        * MIXER_PREFETCH_CHUNK_FRAMES
      const loopEndFrame = Math.floor((range.endSample - 1) / MIXER_PREFETCH_CHUNK_FRAMES)
        * MIXER_PREFETCH_CHUNK_FRAMES
      if (this.nextPrefetchFrame > loopEndFrame) {
        this.nextPrefetchFrame = loopStartFrame
      }
      if (this.streamAbort !== undefined) {
        void this.pumpPrefetch(this.streamSession, node, this.streamAbort, this.streamGeneration)
      }
    }
    const message: MixerWorkletInboundMessage = { kind: 'set-loop-range', range }
    node.port.postMessage(message)
  }

  play(): void {
    const node = this.requireNode()
    const failedChunk = this.failedChunks.values().next().value as number | undefined
    if (failedChunk !== undefined) {
      this.failedChunks.clear()
      void this.startPrefetch(failedChunk)
    }
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
    if (this.streamSession !== undefined) {
      const chunkStart = Math.floor(sample / MIXER_PREFETCH_CHUNK_FRAMES) * MIXER_PREFETCH_CHUNK_FRAMES
      if (this.activeChunks.has(chunkStart)) {
        const message: MixerWorkletInboundMessage = { kind: 'seek', sample }
        node.port.postMessage(message)
        return
      }
      const message: MixerWorkletInboundMessage = { kind: 'flush', sample }
      node.port.postMessage(message)
      void this.startPrefetch(sample)
      return
    }
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
    this.disposed = true
    this.loadGeneration += 1
    this.streamAbort?.abort()
    this.streamAbort = undefined
    this.streamSession = undefined
    this.activeChunks.clear()
    this.failedChunks.clear()
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
    if (typeof data !== 'object' || data === null) return
    const message = data as MixerWorkletOutboundMessage
    if (message.kind === 'need-chunk') {
      if (this.failedChunks.has(message.startFrame)) return
      if (!this.activeChunks.has(message.startFrame)) {
        void this.startPrefetch(message.startFrame)
      }
      return
    }
    if (message.kind === 'release-chunk') {
      this.activeChunks.delete(message.startFrame)
      if (this.streamSession !== undefined && this.streamAbort !== undefined && this.node !== undefined) {
        void this.pumpPrefetch(this.streamSession, this.node, this.streamAbort, this.streamGeneration)
      }
      return
    }
    if (message.kind !== 'progress') return
    const progress: MixerPlaybackProgress = {
      currentSample: message.currentSample,
      isPlaying: message.isPlaying,
      ...(message.isBuffering === undefined ? {} : { isBuffering: message.isBuffering }),
      ...(message.rangeError === undefined ? {} : { rangeError: message.rangeError }),
    }
    for (const listener of this.progressListeners) listener(progress)
  }
}
