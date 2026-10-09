import { resolveStemProfile } from '../../application/resolve-stem-profile'
import { BASIC_PROFILE, ROCK_PROFILE } from '../../domain/stem-profile'
import { BASIC_STEM_LANES, runBasicInferenceInputStreaming, runBasicInferenceStreaming } from './basic-inference'
import { OnnxSessionManager } from './onnx-session-manager'
import {
  isWorkerAckMessage,
  isWorkerJobMessage,
  type WorkerErrorMessage,
  type WorkerJobMessage,
  type WorkerOutboundMessage,
  type WorkerChunkMessage,
} from './protocol'
import { ROCK_STEM_LANES, runRockInferenceInputStreaming, runRockInferenceStreaming } from './rock-inference'
import { assembleStemLaneChunks, type NamedRawStem } from './stem-lane-assembler'
import { StreamingAudioDecoder } from './streaming-audio-decoder'

interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  postMessage(message: WorkerOutboundMessage, transfer?: Transferable[]): void
}

const scope = self as unknown as WorkerScope

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function correlation(value: unknown): { trackId: string; resultKey: string } {
  if (typeof value !== 'object' || value === null) return { trackId: 'unknown', resultKey: 'unknown' }
  const candidate = value as { trackId?: unknown; resultKey?: unknown }
  return {
    trackId: typeof candidate.trackId === 'string' && candidate.trackId.length > 0 ? candidate.trackId : 'unknown',
    resultKey: typeof candidate.resultKey === 'string' && candidate.resultKey.length > 0 ? candidate.resultKey : 'unknown',
  }
}

function namedRawStems(names: readonly string[], stems: readonly (readonly Float32Array[])[]): NamedRawStem[] {
  if (stems.length !== names.length) {
    throw new Error(`onnx-worker.raw_stem_count:${names.length}:${stems.length}`)
  }
  return names.map((rawId, index) => ({ rawId, channels: stems[index] }))
}

let pendingAck: { readonly trackId: string; readonly resultKey: string; readonly chunkIndex: number; readonly resolve: () => void } | undefined

async function execute(message: WorkerJobMessage): Promise<void> {
  if (message.sampleRate !== undefined && message.sampleRate !== 44_100) throw new Error(`onnx-worker.unsupported_sample_rate:${message.sampleRate}`)

  const profile = resolveStemProfile(message.profileId)
  const { session } = await new OnnxSessionManager().createSession(message.modelBytes)
  let frameCount = message.planarChannels?.[0].length
  let lastWindow = 0
  let totalWindows: number | undefined
  let chunkIndex = 0
  const streamChunk = async (offset: number, stems: readonly (readonly Float32Array[])[]): Promise<void> => {
    const raw = namedRawStems(profile.profileId === BASIC_PROFILE.profileId ? BASIC_STEM_LANES : ROCK_STEM_LANES, stems)
    const lanes = assembleStemLaneChunks(profile, raw).map(({ laneId, channels }) => ({
      laneId,
      channels: channels as readonly [Float32Array, Float32Array],
    }))
    const currentIndex = chunkIndex++
    const chunk: WorkerChunkMessage = {
      kind: 'chunk',
      trackId: message.trackId,
      resultKey: message.resultKey,
      sampleRate: message.sampleRate ?? 44_100,
      frameCount: frameCount ?? null,
      chunkIndex: currentIndex,
      offset,
      lanes,
    }
    const transfer = lanes.flatMap(({ channels }) => channels.map(({ buffer }) => buffer))
    const acknowledged = new Promise<void>((resolve) => {
      pendingAck = { trackId: message.trackId, resultKey: message.resultKey, chunkIndex: currentIndex, resolve }
    })
    scope.postMessage(chunk, transfer)
    await acknowledged
  }
  const onProgress = ({ window, totalWindows: total }: { window: number; totalWindows: number }): void => {
    if (window < lastWindow || (totalWindows !== undefined && total !== totalWindows)) {
      throw new Error('onnx-worker.non_monotonic_progress')
    }
    lastWindow = window
    totalWindows = total
    scope.postMessage({
      kind: 'progress',
      trackId: message.trackId,
      resultKey: message.resultKey,
      window,
      totalWindows: total,
    })
  }

  try {
    if (message.source instanceof Blob) {
      if (message.sourceFormat !== 'MP3' && message.sourceFormat !== 'WAV') {
        throw new Error('onnx-worker.unsupported_streaming_format')
      }
      const pcm = new StreamingAudioDecoder().decode(message.source, message.sourceFormat)
      const streamed = profile.profileId === BASIC_PROFILE.profileId
        ? await runBasicInferenceInputStreaming(session, pcm, (chunk) => streamChunk(chunk.offset, chunk.stems))
        : profile.profileId === ROCK_PROFILE.profileId
          ? await runRockInferenceInputStreaming(session, pcm, (chunk) => streamChunk(chunk.offset, chunk.stems))
          : (() => { throw new Error(`onnx-worker.unsupported_profile:${profile.profileId}`) })()
      frameCount = streamed.frameCount
    } else if (message.planarChannels !== undefined && message.sampleRate === 44_100) {
      if (profile.profileId === BASIC_PROFILE.profileId) {
        await runBasicInferenceStreaming(session, message.planarChannels, (chunk) => streamChunk(chunk.offset, chunk.stems), onProgress)
      } else if (profile.profileId === ROCK_PROFILE.profileId) {
        await runRockInferenceStreaming(session, message.planarChannels, (chunk) => streamChunk(chunk.offset, chunk.stems), onProgress)
      } else {
        throw new Error(`onnx-worker.unsupported_profile:${profile.profileId}`)
      }
    } else {
      throw new Error('onnx-worker.invalid_audio_source')
    }
  } finally {
    await session.release()
  }
  if (frameCount === undefined) throw new Error('onnx-worker.empty_audio')
  scope.postMessage({
    kind: 'complete',
    trackId: message.trackId,
    resultKey: message.resultKey,
    sampleRate: message.sampleRate ?? 44_100,
    frameCount,
    lanes: profile.lanes.map(({ laneId }) => laneId),
  })
}

scope.onmessage = (event): void => {
  const received = event.data
  if (isWorkerAckMessage(received)) {
    if (
      pendingAck !== undefined
      && received.trackId === pendingAck.trackId
      && received.resultKey === pendingAck.resultKey
      && received.chunkIndex === pendingAck.chunkIndex
    ) {
      const ack = pendingAck
      pendingAck = undefined
      ack.resolve()
    }
    return
  }
  if (!isWorkerJobMessage(received)) {
    const ids = correlation(received)
    const failure: WorkerErrorMessage = {
      kind: 'error',
      ...ids,
      message: 'onnx-worker.malformed_job',
      cancelled: false,
    }
    scope.postMessage(failure)
    return
  }

  void execute(received).catch((error: unknown) => {
    scope.postMessage({
      kind: 'error',
      trackId: received.trackId,
      resultKey: received.resultKey,
      message: errorText(error),
      cancelled: false,
    })
  })
}
