import type { QuotaPort } from '../../application/ports/quota-port'

/**
 * `QuotaPort` over `navigator.storage.estimate()`
 * (`docs/decisions/browser-storage.md` section 4): headroom is
 * `quota - usage`, 0 when either is undefined (a browser that does not
 * report one of them). Also exposes `requestPersistence`/`isPersisted`
 * over `navigator.storage.persist()`/`persisted()`, beyond `QuotaPort`
 * itself (recommendation: request persistence once, right after the first
 * successful separation, not on page load).
 */
export class NavigatorStorageQuota implements QuotaPort {
  private readonly storageManager: StorageManager

  constructor(storageManager?: StorageManager) {
    this.storageManager = storageManager ?? navigator.storage
  }

  async availableBytes(): Promise<number> {
    const { quota, usage } = await this.storageManager.estimate()
    if (quota === undefined || usage === undefined) return 0
    return quota - usage
  }

  async requestPersistence(): Promise<boolean> {
    return this.storageManager.persist()
  }

  async isPersisted(): Promise<boolean> {
    return this.storageManager.persisted()
  }
}
