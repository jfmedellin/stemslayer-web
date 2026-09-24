import { describe, expect, test } from 'vitest'

import { FakeLock } from './fake-lock'

describe('FakeLock', () => {
  test('serializes callbacks racing for the same key in call order', async () => {
    const lock = new FakeLock()
    const events: string[] = []

    const first = lock.withLock('identity', async () => {
      events.push('first:start')
      await Promise.resolve()
      events.push('first:end')
      return 'first'
    })
    const second = lock.withLock('identity', async () => {
      events.push('second:start')
      return 'second'
    })

    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second'])
    expect(events).toEqual(['first:start', 'first:end', 'second:start'])
    expect(lock.acquisitionOrder).toEqual(['identity', 'identity'])
  })

  test('does not serialize callbacks for different keys', async () => {
    const lock = new FakeLock()
    const events: string[] = []

    const a = lock.withLock('key-a', async () => {
      events.push('a:start')
      return 'a'
    })
    const b = lock.withLock('key-b', async () => {
      events.push('b:start')
      return 'b'
    })

    await expect(Promise.all([a, b])).resolves.toEqual(['a', 'b'])
    expect(lock.acquisitionOrder).toEqual(['key-a', 'key-b'])
  })

  test('a rejecting callback still releases the key for the next caller', async () => {
    const lock = new FakeLock()

    await expect(lock.withLock('identity', async () => {
      throw new Error('boom')
    })).rejects.toThrow('boom')

    await expect(lock.withLock('identity', async () => 'after-failure')).resolves.toBe('after-failure')
    expect(lock.acquisitionOrder).toEqual(['identity', 'identity'])
  })
})
