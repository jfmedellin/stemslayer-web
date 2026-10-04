import { describe, expect, test } from 'vitest'

import {
  isWorkerJobMessage,
  isWorkerMessage,
  isWorkerOutboundMessage,
} from '../../../src/infrastructure/onnx-worker/protocol'
import { MODEL_WINDOW_STRIDE } from '../../../src/infrastructure/onnx-worker/windowing'

const channels = (): [Float32Array, Float32Array] => [
  new Float32Array([0.1, 0.2]),
  new Float32Array([-0.1, -0.2]),
]

const job = () => ({
  kind: 'job',
  trackId: 'track-1',
  resultKey: 'stems/track-1',
  profileId: 'legacy-four-stem',
  sampleRate: 44_100,
  modelBytes: Uint8Array.from([1, 2, 3]),
  planarChannels: channels(),
})

describe('Worker protocol deep validation', () => {
  test.each([
    ['job', job()],
    ['ack', { kind: 'ack', trackId: 'track-1', resultKey: 'result', chunkIndex: 0 }],
    ['progress', {
      kind: 'progress', trackId: 'track-1', resultKey: 'result', window: 1, totalWindows: 4,
    }],
    ['chunk', {
      kind: 'chunk', trackId: 'track-1', resultKey: 'result', sampleRate: 44_100,
      frameCount: 4, chunkIndex: 0, offset: 0,
      lanes: [{ laneId: 'vocals', channels: channels() }],
    }],
    ['complete', {
      kind: 'complete', trackId: 'track-1', resultKey: 'result', sampleRate: 44_100,
      frameCount: 4, lanes: ['vocals'],
    }],
    ['error', {
      kind: 'error', trackId: 'track-1', resultKey: 'result', message: 'boom', cancelled: false,
    }],
  ])('accepts a well-formed %s message', (_label, message) => {
    expect(isWorkerMessage(message)).toBe(true)
  })

  test.each([
    ['empty model', { ...job(), modelBytes: new Uint8Array() }],
    ['invalid sample rate', { ...job(), sampleRate: 0 }],
    ['mono PCM', { ...job(), planarChannels: [new Float32Array([1])] }],
    ['unequal PCM frames', { ...job(), planarChannels: [new Float32Array([1]), new Float32Array([1, 2])] }],
    ['non-finite PCM', { ...job(), planarChannels: [new Float32Array([1]), new Float32Array([Number.NaN])] }],
    ['missing correlation', { ...job(), trackId: '' }],
  ])('rejects a malformed job: %s', (_label, message) => {
    expect(isWorkerJobMessage(message)).toBe(false)
  })

  test.each([
    ['progress beyond total', {
      kind: 'progress', trackId: 't', resultKey: 'r', window: 2, totalWindows: 1,
    }],
    ['negative chunk acknowledgement', {
      kind: 'ack', trackId: 't', resultKey: 'r', chunkIndex: -1,
    }],
    ['misaligned chunk lane lengths', {
      kind: 'chunk', trackId: 't', resultKey: 'r', sampleRate: 44_100,
      frameCount: 4, chunkIndex: 0, offset: 0,
      lanes: [{ laneId: 'vocals', channels: [new Float32Array([1]), new Float32Array([1, 2])] }],
    }],
    ['chunk larger than the fixed transport bound', {
      kind: 'chunk', trackId: 't', resultKey: 'r', sampleRate: 44_100,
      frameCount: MODEL_WINDOW_STRIDE + 1, chunkIndex: 0, offset: 0,
      lanes: [{ laneId: 'vocals', channels: [new Float32Array(MODEL_WINDOW_STRIDE + 1), new Float32Array(MODEL_WINDOW_STRIDE + 1)] }],
    }],
    ['completion with duplicate lanes', {
      kind: 'complete', trackId: 't', resultKey: 'r', sampleRate: 44_100,
      frameCount: 4, lanes: ['vocals', 'vocals'],
    }],
    ['malformed chunk samples', {
      kind: 'chunk', trackId: 't', resultKey: 'r', sampleRate: 44_100,
      frameCount: 1, chunkIndex: 0, offset: 0,
      lanes: [{ laneId: 'vocals', channels: [new Float32Array([1]), new Float32Array([Infinity])] }],
    }],
    ['non-boolean cancellation', {
      kind: 'error', trackId: 't', resultKey: 'r', message: 'boom', cancelled: 'no',
    }],
  ])('rejects a malformed outbound message: %s', (_label, message) => {
    expect(isWorkerOutboundMessage(message)).toBe(false)
  })

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a primitive', 'job'],
    ['an array', []],
    ['an object with no kind', { trackId: 't' }],
    ['an object with an unknown kind', { kind: 'cancel' }],
  ])('rejects %s', (_label, value) => {
    expect(isWorkerMessage(value)).toBe(false)
  })
})
