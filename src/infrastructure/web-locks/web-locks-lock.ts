import type { LockPort } from '../../application/ports/lock-port'

/** Thrown at construction when the Web Locks API is not present on `navigator`. */
export class UnsupportedLockEnvironmentError extends Error {
  constructor() {
    super('web-locks.unsupported')
    this.name = 'UnsupportedLockEnvironmentError'
  }
}

/**
 * `LockPort` over `navigator.locks.request`. A rejecting callback still
 * releases the lock, since the Locks API releases on either settlement of
 * the callback's returned promise.
 */
export class WebLocksLock implements LockPort {
  private readonly locks: LockManager

  constructor(locksApi?: LockManager) {
    const resolved = locksApi ?? (typeof navigator === 'undefined' ? undefined : navigator.locks)
    if (resolved === undefined) {
      throw new UnsupportedLockEnvironmentError()
    }
    this.locks = resolved
  }

  withLock<T>(key: string, callback: () => Promise<T>): Promise<T> {
    return this.locks.request(key, { mode: 'exclusive' }, () => callback())
  }
}
