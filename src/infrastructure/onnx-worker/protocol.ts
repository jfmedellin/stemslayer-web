import { MODEL_WINDOW_STRIDE } from './windowing'

/** Transferable main-thread -> inference Worker job. */
export interface WorkerJobMessage {
  readonly kind: 'job'
  readonly trackId: string
  readonly resultKey: string
  readonly profileId: string
  readonly source?: Blob
  readonly sourceFormat?: 'MP3' | 'WAV'
  readonly sampleRate?: number
  readonly modelBytes: Uint8Array
  readonly planarChannels?: readonly [Float32Array, Float32Array]
}

export interface WorkerProgressMessage {
  readonly kind: 'progress'
  readonly trackId: string
  readonly resultKey: string
  readonly window: number
  readonly totalWindows: number
}

export interface WorkerLaneChunkMessage {
  readonly laneId: string
  readonly channels: readonly [Float32Array, Float32Array]
}

export interface WorkerChunkMessage {
  readonly kind: 'chunk'
  readonly trackId: string
  readonly resultKey: string
  readonly sampleRate?: number
  readonly frameCount: number | null
  readonly chunkIndex: number
  readonly offset: number
  readonly lanes: readonly WorkerLaneChunkMessage[]
}

export interface WorkerCompleteMessage {
  readonly kind: 'complete'
  readonly trackId: string
  readonly resultKey: string
  readonly sampleRate: number
  readonly frameCount: number
  readonly lanes: readonly string[]
}

export interface WorkerAckMessage {
  readonly kind: 'ack'
  readonly trackId: string
  readonly resultKey: string
  readonly chunkIndex: number
}

export interface WorkerErrorMessage {
  readonly kind: 'error'
  readonly trackId: string
  readonly resultKey: string
  readonly message: string
  readonly cancelled: boolean
}

export type WorkerOutboundMessage = WorkerProgressMessage | WorkerChunkMessage | WorkerCompleteMessage | WorkerErrorMessage
export type WorkerMessage = WorkerJobMessage | WorkerAckMessage | WorkerOutboundMessage

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
    && message.modelBytes instanceof Uint8Array
    && message.modelBytes.byteLength > 0
    && ((message.source instanceof Blob
      && (message.sourceFormat === 'MP3' || message.sourceFormat === 'WAV')
      && message.sampleRate === undefined
      && message.planarChannels === undefined)
      || (positiveInteger(message.sampleRate)
        && stereo(message.planarChannels)
        && message.source === undefined
        && message.sourceFormat === undefined))
}

function isProgress(message: UnknownRecord): boolean {
  return message.kind === 'progress'
    && correlation(message)
    && positiveInteger(message.window)
    && positiveInteger(message.totalWindows)
    && message.window <= message.totalWindows
}

function isLaneChunk(value: unknown): value is WorkerLaneChunkMessage {
  const lane = record(value)
  return lane !== undefined && nonEmptyString(lane.laneId) && stereo(lane.channels)
}

export function isWorkerAckMessage(value: unknown): value is WorkerAckMessage {
  const message = record(value)
  return message !== undefined
    && message.kind === 'ack'
    && correlation(message)
    && Number.isSafeInteger(message.chunkIndex)
    && (message.chunkIndex as number) >= 0
}

function isChunk(message: UnknownRecord): boolean {
  if (
    message.kind !== 'chunk'
    || !correlation(message)
    || !positiveInteger(message.sampleRate)
    || !(message.frameCount === null || positiveInteger(message.frameCount))
    || !Number.isSafeInteger(message.chunkIndex)
    || (message.chunkIndex as number) < 0
    || !Number.isSafeInteger(message.offset)
    || (message.offset as number) < 0
    || !Array.isArray(message.lanes)
    || message.lanes.length === 0
    || !message.lanes.every(isLaneChunk)
  ) return false
  const ids = message.lanes.map(({ laneId }) => laneId)
  const length = (message.lanes[0] as WorkerLaneChunkMessage).channels[0].length
  return length > 0
    && length <= MODEL_WINDOW_STRIDE
    && (message.frameCount === null || (message.offset as number) + length <= (message.frameCount as number))
    && message.lanes.every((lane) => lane.channels[0].length === length)
    && new Set(ids).size === ids.length
}

function isComplete(message: UnknownRecord): boolean {
  return message.kind === 'complete'
    && correlation(message)
    && positiveInteger(message.sampleRate)
    && positiveInteger(message.frameCount)
    && Array.isArray(message.lanes)
    && message.lanes.length > 0
    && message.lanes.every(nonEmptyString)
    && new Set(message.lanes).size === message.lanes.length
}

function isError(message: UnknownRecord): boolean {
  return message.kind === 'error'
    && correlation(message)
    && nonEmptyString(message.message)
    && typeof message.cancelled === 'boolean'
}

export function isWorkerOutboundMessage(value: unknown): value is WorkerOutboundMessage {
  const message = record(value)
  return message !== undefined && (
    isProgress(message) || isChunk(message) || isComplete(message) || isError(message)
  )
}

/** Deep-validates every field crossing the Worker trust boundary. */
export function isWorkerMessage(value: unknown): value is WorkerMessage {
  return isWorkerJobMessage(value) || isWorkerAckMessage(value) || isWorkerOutboundMessage(value)
}
