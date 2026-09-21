import { describe, expect, test } from 'vitest'

import { isWorkerMessage } from '../../../src/infrastructure/onnx-worker/protocol'

describe('isWorkerMessage', () => {
  test.each([
    ['job', { kind: 'job', trackId: 't', profileId: 'p', resultKey: 'r', planarChannels: [] }],
    ['progress', { kind: 'progress', trackId: 't', window: 1, totalWindows: 4 }],
    ['result', { kind: 'result', trackId: 't', laneKeys: ['vocals'] }],
    ['error', { kind: 'error', trackId: 't', message: 'boom', cancelled: false }],
  ])('accepts a well-formed %s message', (_label, message) => {
    expect(isWorkerMessage(message)).toBe(true)
  })

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['a primitive', 'job'],
    ['an array', []],
    ['an object with no kind', { trackId: 't' }],
    ['an object with a non-string kind', { kind: 1 }],
    ['an object with an unknown kind', { kind: 'cancel' }],
  ])('rejects %s', (_label, value) => {
    expect(isWorkerMessage(value)).toBe(false)
  })
})
