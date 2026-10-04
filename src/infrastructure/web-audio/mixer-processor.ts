import { MAX_MIXER_LANES } from '../../domain/mixer/mixer'
import {
  MIXER_PROCESSOR_NAME,
  PROGRESS_INTERVAL_SECONDS,
  MIXER_PREFETCH_CHUNK_FRAMES,
  isMixerWorkletInboundMessage,
  laneGainParamName,
  type MixerWorkletOutboundMessage,
} from './protocol'

/**
 * The real `AudioWorkletProcessor`: one shared sample cursor mixes every
 * loaded lane's planar Float32 buffers into one stereo output per render
 * quantum (`docs/decisions/architecture.md`'s Runtime topology — one
 * worklet node drives every lane, so there is no per-lane buffer source to
 * desynchronize). Per-lane gain arrives as `AudioParam`s (see
 * `protocol.ts`'s header comment for why); everything else (load, transport,
 * loop region) arrives as `port.postMessage` commands.
 *
 * Runs in `AudioWorkletGlobalScope`, a realm TypeScript's `lib.dom.d.ts`
 * does not describe (it only describes the main-thread-facing
 * `AudioWorkletNode`/`AudioParamDescriptor` surface, which this file reuses
 * from the ambient DOM lib) — the handful of processor-scope globals below
 * are declared locally, the same shape the platform actually provides.
 */

declare const sampleRate: number

interface AudioParamDescriptor {
  readonly name: string
  readonly automationRate?: 'a-rate' | 'k-rate'
  readonly minValue?: number
  readonly maxValue?: number
  readonly defaultValue?: number
}

declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: AudioWorkletNodeOptions)
}

declare function registerProcessor(
  name: string,
  processorCtor: (new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor) & {
    parameterDescriptors?: readonly AudioParamDescriptor[]
  },
): void

interface LoadedLane {
  readonly channels: readonly [Float32Array, Float32Array]
}

interface LoopRange {
  readonly startSample: number
  readonly endSample: number
}

class MixerProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): AudioParamDescriptor[] {
    return Array.from({ length: MAX_MIXER_LANES }, (_unused, index) => ({
      name: laneGainParamName(index),
      defaultValue: 1,
      minValue: 0,
      maxValue: 1,
      automationRate: 'a-rate' as const,
    }))
  }

  private lanes: readonly LoadedLane[] = []
  private readonly chunks = new Map<number, readonly (readonly [Float32Array, Float32Array])[]>()
  private readonly requestedChunks = new Set<number>()
  private streaming = false
  private buffering = false
  private rangeReadFailed = false
  private failedChunkStart: number | undefined
  private frameCount = 0
  private cursor = 0
  private playing = false
  private loopRange: LoopRange | null = null
  private samplesSinceProgress = 0
  private readonly progressIntervalSamples = Math.max(1, Math.round(PROGRESS_INTERVAL_SECONDS * sampleRate))

  constructor(options?: AudioWorkletNodeOptions) {
    super(options)
    this.port.onmessage = (event: MessageEvent<unknown>): void => {
      this.handleMessage(event.data)
    }
  }

  private handleMessage(data: unknown): void {
    if (!isMixerWorkletInboundMessage(data)) return

    if (data.kind === 'load') {
      this.streaming = false
      this.chunks.clear()
      this.requestedChunks.clear()
      this.rangeReadFailed = false
      this.failedChunkStart = undefined
      this.lanes = data.lanes.map(({ channels }) => ({ channels }))
      this.frameCount = data.frameCount
      this.cursor = 0
      this.playing = false
      this.loopRange = null
      return
    }
    if (data.kind === 'stream-load') {
      this.streaming = true
      this.chunks.clear()
      this.requestedChunks.clear()
      this.lanes = data.lanes.map(() => ({ channels: [new Float32Array(0), new Float32Array(0)] }))
      this.frameCount = data.frameCount
      this.cursor = 0
      this.playing = false
      this.buffering = false
      this.rangeReadFailed = false
      this.failedChunkStart = undefined
      this.loopRange = null
      this.requestChunk(0)
      return
    }
    if (data.kind === 'chunk') {
      this.chunks.set(data.startFrame, data.lanes)
      this.requestedChunks.delete(data.startFrame)
      if (data.startFrame === this.failedChunkStart) this.failedChunkStart = undefined
      this.buffering = false
      this.postProgress()
      return
    }
    if (data.kind === 'flush') {
      this.chunks.clear()
      this.requestedChunks.clear()
      this.cursor = Math.min(this.frameCount, data.sample)
      this.buffering = this.cursor < this.frameCount
      this.requestChunk(this.cursor)
      this.postProgress()
      return
    }
    if (data.kind === 'chunk-failed') {
      this.requestedChunks.delete(data.startFrame)
      this.failedChunkStart = data.startFrame
      this.rangeReadFailed = true
      this.playing = false
      this.buffering = false
      this.postProgress()
      return
    }
    if (data.kind === 'play') {
      if (this.rangeReadFailed) {
        this.rangeReadFailed = false
        this.playing = this.frameCount > 0
        this.buffering = true
        this.requestChunk(this.failedChunkStart ?? this.cursor)
        this.postProgress()
        return
      }
      this.playing = this.frameCount > 0
      this.postProgress()
      return
    }
    if (data.kind === 'pause') {
      this.playing = false
      this.postProgress()
      return
    }
    if (data.kind === 'seek') {
      this.cursor = Math.min(this.frameCount, Math.max(0, data.sample))
      return
    }
    // data.kind === 'set-loop-range'
    this.loopRange = data.range
  }

  private requestChunk(sample: number): void {
    const startFrame = Math.floor(sample / MIXER_PREFETCH_CHUNK_FRAMES) * MIXER_PREFETCH_CHUNK_FRAMES
    if (startFrame >= this.frameCount || this.chunks.has(startFrame) || this.requestedChunks.has(startFrame)) return
    for (const [loadedStart] of this.chunks) {
      this.chunks.delete(loadedStart)
      this.port.postMessage({ kind: 'release-chunk', startFrame: loadedStart })
    }
    this.requestedChunks.add(startFrame)
    this.buffering = true
    this.port.postMessage({ kind: 'need-chunk', startFrame })
    this.postProgress()
  }

  /** Wraps at the loop region's end back to its start; with no loop range, stops at `frameCount`. */
  private advanceCursor(): void {
    const next = this.cursor + 1
    if (this.loopRange !== null) {
      this.cursor = next >= this.loopRange.endSample ? this.loopRange.startSample : next
      return
    }
    if (next >= this.frameCount) {
      this.cursor = this.frameCount
      this.playing = false
      return
    }
    this.cursor = next
  }

  private postProgress(): void {
    const message: MixerWorkletOutboundMessage = {
      kind: 'progress',
      currentSample: this.cursor,
      isPlaying: this.playing,
      ...(this.streaming ? { isBuffering: this.buffering } : {}),
      ...(this.rangeReadFailed ? { rangeError: 'range-read-failed' as const } : {}),
    }
    this.port.postMessage(message)
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    void inputs // numberOfInputs is always 0 — nothing is ever connected into this node.
    const output = outputs[0]
    if (output === undefined || output.length < 2) return true
    const frameLength = output[0].length

    for (let sampleIndex = 0; sampleIndex < frameLength; sampleIndex += 1) {
      let left = 0
      let right = 0
      const canRender = this.playing && this.cursor < this.frameCount
      if (canRender) {
        const chunkStart = Math.floor(this.cursor / MIXER_PREFETCH_CHUNK_FRAMES) * MIXER_PREFETCH_CHUNK_FRAMES
        const chunk = this.streaming ? this.chunks.get(chunkStart) : undefined
        if (this.streaming && chunk === undefined) {
          this.requestChunk(this.cursor)
          this.buffering = true
          output[0][sampleIndex] = 0
          output[1][sampleIndex] = 0
          continue
        }
        this.buffering = false
        for (let laneIndex = 0; laneIndex < this.lanes.length; laneIndex += 1) {
          const lane = this.lanes[laneIndex]
          const gainParam = parameters[laneGainParamName(laneIndex)]
          const gain = gainParam.length > 1 ? gainParam[sampleIndex] : gainParam[0]
          const channels = this.streaming ? chunk![laneIndex] : lane.channels
          const frame = this.streaming ? this.cursor - chunkStart : this.cursor
          left += channels[0][frame] * gain
          right += channels[1][frame] * gain
        }
      }
      output[0][sampleIndex] = left
      output[1][sampleIndex] = right

      if (canRender) {
        const previousChunk = Math.floor(this.cursor / MIXER_PREFETCH_CHUNK_FRAMES) * MIXER_PREFETCH_CHUNK_FRAMES
        this.advanceCursor()
        const nextChunk = Math.floor(this.cursor / MIXER_PREFETCH_CHUNK_FRAMES) * MIXER_PREFETCH_CHUNK_FRAMES
        const loopStartChunk = this.loopRange === null ? -1
          : Math.floor(this.loopRange.startSample / MIXER_PREFETCH_CHUNK_FRAMES) * MIXER_PREFETCH_CHUNK_FRAMES
        const loopEndChunk = this.loopRange === null ? -1
          : Math.floor((this.loopRange.endSample - 1) / MIXER_PREFETCH_CHUNK_FRAMES) * MIXER_PREFETCH_CHUNK_FRAMES
        if (this.streaming && previousChunk !== nextChunk
          && previousChunk !== loopStartChunk && previousChunk !== loopEndChunk && this.chunks.delete(previousChunk)) {
          this.port.postMessage({ kind: 'release-chunk', startFrame: previousChunk })
        }
        this.samplesSinceProgress += 1
        if (this.samplesSinceProgress >= this.progressIntervalSamples) {
          this.samplesSinceProgress = 0
          this.postProgress()
        }
      }
    }

    return true
  }
}

registerProcessor(MIXER_PROCESSOR_NAME, MixerProcessor)
