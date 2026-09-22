/** Transferable main-thread -> inference Worker job. */
export interface WorkerJobMessage {
  readonly kind: 'job'
  readonly trackId: string
  readonly resultKey: string
  readonly profileId: string
  readonly sampleRate: number
  readonly modelBytes: Uint8Array
  readonly planarChannels: readonly [Float32Array, Float32Array]
}

export interface WorkerProgressMessage {
  readonly kind: 'progress'
  readonly trackId: string
  readonly resultKey: string
  readonly window: number
  readonly totalWindows: number
}

export interface WorkerResultLane {
  readonly laneId: string
  readonly channels: readonly [Float32Array, Float32Array]
}

export interface WorkerResultMessage {
  readonly kind: 'result'
  readonly trackId: string
  readonly resultKey: string
  readonly sampleRate: number
  readonly lanes: readonly WorkerResultLane[]
}

export interface WorkerErrorMessage {
  readonly kind: 'error'
  readonly trackId: string
  readonly resultKey: string
  readonly message: string
  readonly cancelled: boolean
}

export type WorkerOutboundMessage = WorkerProgressMessage | WorkerResultMessage | WorkerErrorMessage
export type WorkerMessage = WorkerJobMessage | WorkerOutboundMessage

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function finiteFloat32(value: unknown): value is Float32Array {
  return value instanceof Float32Array && value.length > 0 && value.every(Number.isFinite)
}

function stereo(value: unknown): value is readonly [Float32Array, Float32Array] {
  return Array.isArray(value)
    && value.length === 2
    && finiteFloat32(value[0])
    && finiteFloat32(value[1])
    && value[0].length === value[1].length
}

function correlation(message: UnknownRecord): boolean {
  return nonEmptyString(message.trackId) && nonEmptyString(message.resultKey)
}

export function isWorkerJobMessage(value: unknown): value is WorkerJobMessage {
  const message = record(value)
  return message !== undefined
    && message.kind === 'job'
    && correlation(message)
    && nonEmptyString(message.profileId)
    && positiveInteger(message.sampleRate)
    && message.modelBytes instanceof Uint8Array
    && message.modelBytes.byteLength > 0
    && stereo(message.planarChannels)
}

function isProgress(message: UnknownRecord): boolean {
  return message.kind === 'progress'
    && correlation(message)
    && positiveInteger(message.window)
    && positiveInteger(message.totalWindows)
    && message.window <= message.totalWindows
}

function isResultLane(value: unknown): value is WorkerResultLane {
  const lane = record(value)
  return lane !== undefined && nonEmptyString(lane.laneId) && stereo(lane.channels)
}

function isResult(message: UnknownRecord): boolean {
  if (
    message.kind !== 'result'
    || !correlation(message)
    || !positiveInteger(message.sampleRate)
    || !Array.isArray(message.lanes)
    || message.lanes.length === 0
    || !message.lanes.every(isResultLane)
  ) return false
  const ids = message.lanes.map(({ laneId }) => laneId)
  return new Set(ids).size === ids.length
}

function isError(message: UnknownRecord): boolean {
  return message.kind === 'error'
    && correlation(message)
    && nonEmptyString(message.message)
    && typeof message.cancelled === 'boolean'
}

export function isWorkerOutboundMessage(value: unknown): value is WorkerOutboundMessage {
  const message = record(value)
  return message !== undefined && (isProgress(message) || isResult(message) || isError(message))
}

/** Deep-validates every field crossing the Worker trust boundary. */
export function isWorkerMessage(value: unknown): value is WorkerMessage {
  return isWorkerJobMessage(value) || isWorkerOutboundMessage(value)
}
