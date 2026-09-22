import type { AddToLibraryDeps } from '../application/add-to-library'
import type { AudioEnginePort } from '../application/ports/audio-engine-port'
import type { InferencePort } from '../application/ports/inference-port'
import type { StemStorePort } from '../application/ports/stem-store-port'
import { runStartupSweeps, type RunStartupSweepsDeps, type StartupSweepCounts } from '../application/run-startup-sweeps'
import type { SeparateProgressEvent } from '../application/separate'
import { SeparationQueue } from '../application/separation-queue'
import { CacheApiModelStore } from '../infrastructure/cache-api/cache-api-model-store'
import { IndexedDbCatalog } from '../infrastructure/indexeddb/indexeddb-catalog'
import { OnnxWorkerInference } from '../infrastructure/onnx-worker/onnx-worker-inference'
import type { NavigatorGpuLike } from '../infrastructure/onnx-worker/onnx-session-manager'
import { NavigatorStorageQuota } from '../infrastructure/opfs/navigator-storage-quota'
import { OpfsStemStore } from '../infrastructure/opfs/opfs-stem-store'
import { WebAudioEngine } from '../infrastructure/web-audio/web-audio-engine'
import { WebCryptoHash } from '../infrastructure/web-crypto/web-crypto-hash'
import { WebLocksLock } from '../infrastructure/web-locks/web-locks-lock'

export type ProgressListener = (trackId: string, event: SeparateProgressEvent) => void

/**
 * Minimal pub-sub so `App.tsx` can own a live `Record<trackId,
 * SeparateProgressEvent>` state fed by the one shared `SeparationQueue`'s
 * `onProgress` callback, without the queue (built here, once) needing to
 * know about React.
 */
export class ProgressHub {
  private readonly listeners = new Set<ProgressListener>()

  emit(trackId: string, event: SeparateProgressEvent): void {
    for (const listener of this.listeners) listener(trackId, event)
  }

  subscribe(listener: ProgressListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

/**
 * `runStartupSweeps` recovers rows an earlier tab/crash left `preparing`/
 * `processing` (`docs/decisions/browser-storage.md` sections 4/7) — but it
 * cannot tell that apart from a row the *current* tab's own `SeparationQueue`
 * has genuinely running right now. Calling it again every time `LibraryPage`
 * happens to remount (e.g. Upload enqueues a job, the user immediately
 * switches to Library to watch it) would wrongly interrupt that live job.
 * This guard runs the sweep exactly once per app session — kicked off as
 * early as `createAppDependencies()` itself, before any user interaction can
 * possibly reach `SeparationQueue.enqueue` — and every later caller
 * (`LibraryPage`'s own mount, per its own contract) just awaits that same
 * single result instead of re-running it.
 */
export class StartupSweepGuard {
  private promise: Promise<StartupSweepCounts> | undefined

  runOnce(deps: RunStartupSweepsDeps): Promise<StartupSweepCounts> {
    this.promise ??= runStartupSweeps(deps)
    return this.promise
  }
}

export interface AppDependencies {
  readonly addToLibraryDeps: AddToLibraryDeps
  readonly navigatorRef: NavigatorGpuLike
  /** P8B: real `StemStorePort`, also handed to `LibraryPage` for sweeps/remove. */
  readonly stemStore: StemStorePort
  readonly inference: InferencePort
  /** The one shared queue: Upload enqueues into it, Library observes/cancels it. */
  readonly separationQueue: SeparationQueue
  readonly progressHub: ProgressHub
  readonly startupSweepGuard: StartupSweepGuard
  /**
   * P9B: the real Mixer playback engine, constructed once for the app's
   * whole lifetime (same pattern as `separationQueue`) — one `AudioContext`
   * shared across every Mixer visit, never disposed on ordinary navigation
   * (see `MixerPage.tsx`'s own comment on why `dispose()` is reserved for a
   * teardown this app never performs).
   */
  readonly audioEngine: AudioEnginePort
}

/**
 * Composition root wiring the real infrastructure adapters (each already
 * covered by its own tests) into the UI layer's dependency bags. P8A wired
 * `AddToLibrary`'s bag; P8B adds `StemStorePort`/`InferencePort` and the one
 * shared `SeparationQueue` so a job enqueued from Upload actually runs
 * end to end, with its progress observable from both Upload and Library.
 */
export function createAppDependencies(): AppDependencies {
  const catalog = new IndexedDbCatalog()
  const modelStore = new CacheApiModelStore()
  const stemStore = new OpfsStemStore()
  const inference = new OnnxWorkerInference({ modelStore, stemStore })
  const progressHub = new ProgressHub()
  const audioEngine = new WebAudioEngine()

  const separationQueue = new SeparationQueue({
    catalog,
    stemStore,
    modelStore,
    inference,
    onProgress: (trackId, event) => progressHub.emit(trackId, event),
  })

  const startupSweepGuard = new StartupSweepGuard()
  // Fire-and-forget, kicked off the instant the composition root exists —
  // well before a real user could possibly have dropped a file and clicked
  // "Separate" yet, so this always wins the race against a genuine enqueue.
  void startupSweepGuard.runOnce({ catalog, stemStore })

  return {
    addToLibraryDeps: {
      catalog,
      modelStore,
      quota: new NavigatorStorageQuota(),
      lock: new WebLocksLock(),
      hash: new WebCryptoHash(),
      generateTrackId: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
    },
    navigatorRef: typeof navigator === 'undefined' ? {} : navigator,
    stemStore,
    inference,
    separationQueue,
    progressHub,
    startupSweepGuard,
    audioEngine,
  }
}
