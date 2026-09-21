import { expect, test } from 'vitest'
import { UnsupportedLockEnvironmentError, WebLocksLock } from './web-locks-lock'

test('serializes two callbacks racing for the same key', async () => {
  const lock = new WebLocksLock()
  const events: string[] = []
  let releaseFirst: (() => void) | undefined
  let firstStarted: (() => void) | undefined
  const firstStartedPromise = new Promise<void>((resolve) => {
    firstStarted = resolve
  })

  const first = lock.withLock('race-key', async () => {
    events.push('first-start')
    firstStarted?.()
    await new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    events.push('first-end')
    return 'first'
  })

  // Wait for the first callback to actually be running (deterministic
  // signal) before racing the second, instead of an arbitrary delay.
  await firstStartedPromise
  const second = lock.withLock('race-key', async () => {
    events.push('second-start')
    return 'second'
  })

  expect(events).toEqual(['first-start'])
  releaseFirst?.()

  await expect(first).resolves.toBe('first')
  await expect(second).resolves.toBe('second')
  expect(events).toEqual(['first-start', 'first-end', 'second-start'])
})

test('releases the lock after a rejecting callback so the next caller still runs', async () => {
  const lock = new WebLocksLock()
  const key = `release-on-rejection-${Math.random().toString(36).slice(2)}`

  const rejecting = lock.withLock(key, async () => {
    throw new Error('boom')
  })
  await expect(rejecting).rejects.toThrow('boom')

  const following = lock.withLock(key, async () => 'ran-after-rejection')
  await expect(following).resolves.toBe('ran-after-rejection')
})

test('throws a typed error when the Locks API is unavailable', () => {
  Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
  try {
    expect(() => new WebLocksLock()).toThrow(UnsupportedLockEnvironmentError)
  } finally {
    delete (navigator as unknown as { locks?: unknown }).locks
  }
})
