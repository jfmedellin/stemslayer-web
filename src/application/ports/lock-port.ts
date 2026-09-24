/**
 * Serializes a read-decide-write sequence across tabs/workers of the origin
 * for a given key. Implemented by P9 (Web Locks adapter:
 * `navigator.locks.request`, `docs/decisions/browser-storage.md` section 1).
 */
export interface LockPort {
  withLock<T>(key: string, callback: () => Promise<T>): Promise<T>
}
