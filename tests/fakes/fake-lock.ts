import type { LockPort } from '../../src/application/ports/lock-port'

/**
 * Serializes callbacks racing for the same key by chaining a promise tail
 * per key; different keys run independently. Records the key of every
 * callback in the order it actually started, for assertions on acquisition
 * order.
 */
export class FakeLock implements LockPort {
  readonly acquisitionOrder: string[] = []

  private readonly tailByKey = new Map<string, Promise<unknown>>()

  withLock<T>(key: string, callback: () => Promise<T>): Promise<T> {
    const previousTail = this.tailByKey.get(key) ?? Promise.resolve()
    const settledPrevious = previousTail.then(
      () => undefined,
      () => undefined,
    )
    const run = settledPrevious.then(() => {
      this.acquisitionOrder.push(key)
      return callback()
    })
    this.tailByKey.set(key, run)
    return run
  }
}
