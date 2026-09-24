import { resolveStemProfile } from '../../application/resolve-stem-profile'
import { BASIC_PROFILE, ROCK_PROFILE } from '../../domain/stem-profile'
import { BASIC_STEM_LANES, runBasicInference } from './basic-inference'
import { OnnxSessionManager } from './onnx-session-manager'
import { isWorkerJobMessage, type WorkerErrorMessage, type WorkerJobMessage, type WorkerOutboundMessage, type WorkerResultMessage } from './protocol'
import { ROCK_STEM_LANES, runRockInference } from './rock-inference'
import { assembleStemLanes, type NamedRawStem } from './stem-lane-assembler'

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

async function execute(message: WorkerJobMessage): Promise<WorkerResultMessage> {
  if (message.sampleRate !== 44_100) throw new Error(`onnx-worker.unsupported_sample_rate:${message.sampleRate}`)

  const profile = resolveStemProfile(message.profileId)
  const { session } = await new OnnxSessionManager().createSession(message.modelBytes)
  let lastWindow = 0
  let totalWindows: number | undefined
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
    const raw = profile.profileId === BASIC_PROFILE.profileId
      ? namedRawStems(BASIC_STEM_LANES, (await runBasicInference(session, message.planarChannels, onProgress)).stems)
      : profile.profileId === ROCK_PROFILE.profileId
        ? namedRawStems(ROCK_STEM_LANES, (await runRockInference(session, message.planarChannels, onProgress)).stems)
        : (() => { throw new Error(`onnx-worker.unsupported_profile:${profile.profileId}`) })()
    const lanes = assembleStemLanes(profile, raw).map(({ laneId, channels }) => ({
      laneId,
      channels: channels as readonly [Float32Array, Float32Array],
    }))
    return {
      kind: 'result',
      trackId: message.trackId,
      resultKey: message.resultKey,
      sampleRate: message.sampleRate,
      lanes,
    }
  } finally {
    await session.release()
  }
}

scope.onmessage = (event): void => {
  const received = event.data
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

  void execute(received).then((result) => {
    const transfer = result.lanes.flatMap(({ channels }) => channels.map(({ buffer }) => buffer))
    scope.postMessage(result, transfer)
  }, (error: unknown) => {
    scope.postMessage({
      kind: 'error',
      trackId: received.trackId,
      resultKey: received.resultKey,
      message: errorText(error),
      cancelled: false,
    })
  })
}
