import type { AddToLibraryDeps } from '../application/add-to-library'
import type { NavigatorGpuLike } from '../infrastructure/onnx-worker/onnx-session-manager'
import { CacheApiModelStore } from '../infrastructure/cache-api/cache-api-model-store'
import { IndexedDbCatalog } from '../infrastructure/indexeddb/indexeddb-catalog'
import { NavigatorStorageQuota } from '../infrastructure/opfs/navigator-storage-quota'
import { WebCryptoHash } from '../infrastructure/web-crypto/web-crypto-hash'
import { WebLocksLock } from '../infrastructure/web-locks/web-locks-lock'

export interface AppDependencies {
  readonly addToLibraryDeps: AddToLibraryDeps
  readonly navigatorRef: NavigatorGpuLike
}

/**
 * Composition root wiring the real infrastructure adapters (each already
 * covered by its own tests) into the `AddToLibrary` dependency bag the UI
 * layer calls. Deliberately untested on its own: it is plain object
 * construction, exercised end to end once the UI mounts it.
 */
export function createAppDependencies(): AppDependencies {
  return {
    addToLibraryDeps: {
      catalog: new IndexedDbCatalog(),
      modelStore: new CacheApiModelStore(),
      quota: new NavigatorStorageQuota(),
      lock: new WebLocksLock(),
      hash: new WebCryptoHash(),
      generateTrackId: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
    },
    navigatorRef: typeof navigator === 'undefined' ? {} : navigator,
  }
}
