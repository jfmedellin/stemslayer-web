import type { AppDependencies } from '../../src/ui/app-dependencies'
import { ProgressHub, StartupSweepGuard } from '../../src/ui/app-dependencies'
import { SeparationQueue } from '../../src/application/separation-queue'
import { FakeHash } from './fake-hash'
import { FakeInference } from './fake-inference'
import { FakeLock } from './fake-lock'
import { FakeQuota } from './fake-quota'
import { InMemoryCatalog } from './in-memory-catalog'
import { InMemoryModelStore } from './in-memory-model-store'
import { InMemoryStemStore } from './in-memory-stem-store'

export interface FakeAppDependencies {
  readonly deps: AppDependencies
  readonly catalog: InMemoryCatalog
  readonly quota: FakeQuota
  readonly modelStore: InMemoryModelStore
  readonly stemStore: InMemoryStemStore
  readonly inference: FakeInference
}

export interface FakeAppDependenciesOptions {
  readonly availableBytes?: number
  readonly gpu?: object
  /**
   * Defaults to `true`, matching `createAppDependencies`'s real eager
   * kickoff. A test that needs to seed a *pre-existing* `preparing`/
   * `processing` row (simulating one left behind by a crashed previous
   * session, for the startup sweep itself to recover) passes `false` and
   * explicitly triggers `deps.startupSweepGuard.runOnce(...)` itself once
   * its fixtures are already inserted.
   */
  readonly autoStartupSweep?: boolean
}

/**
 * Builds a full `AppDependencies`-shaped bag entirely from the project's
 * fakes, wired the same way `createAppDependencies` wires the real
 * infrastructure adapters: one shared `SeparationQueue` whose `onProgress`
 * feeds the `ProgressHub` `App.tsx` subscribes to. Used by `App`/`UploadPage`/
 * `LibraryPage` browser tests so a job enqueued in a test actually runs
 * through real `SeparationQueue`/`separate()` logic against fakes, not a
 * real Worker/OPFS/Cache API.
 */
export function buildFakeAppDependencies(options: FakeAppDependenciesOptions = {}): FakeAppDependencies {
  const catalog = new InMemoryCatalog()
  const modelStore = new InMemoryModelStore()
  const quota = new FakeQuota(options.availableBytes ?? 10_000_000_000)
  const stemStore = new InMemoryStemStore()
  const inference = new FakeInference(stemStore)
  const progressHub = new ProgressHub()
  let trackIdCounter = 0

  const separationQueue = new SeparationQueue({
    catalog,
    stemStore,
    modelStore,
    inference,
    onProgress: (trackId, event) => progressHub.emit(trackId, event),
  })

  const startupSweepGuard = new StartupSweepGuard()
  if (options.autoStartupSweep ?? true) {
    void startupSweepGuard.runOnce({ catalog, stemStore })
  }

  const deps: AppDependencies = {
    addToLibraryDeps: {
      catalog,
      modelStore,
      quota,
      lock: new FakeLock(),
      hash: new FakeHash(),
      generateTrackId: () => `track-${trackIdCounter++}`,
      now: () => '2026-09-22T00:00:00.000Z',
    },
    navigatorRef: { gpu: options.gpu },
    stemStore,
    inference,
    separationQueue,
    progressHub,
    startupSweepGuard,
  }

  return { deps, catalog, quota, modelStore, stemStore, inference }
}

/**
 * Deterministically awaits the one startup sweep (`StartupSweepGuard`),
 * whether it was auto-kicked-off by `buildFakeAppDependencies` or is being
 * triggered here for the first time (`autoStartupSweep: false`). Tests call
 * this before inserting fixtures they want left untouched by the sweep, or
 * after inserting fixtures they want the sweep to actually recover.
 */
export function settleStartupSweep(testDeps: FakeAppDependencies): Promise<unknown> {
  return testDeps.deps.startupSweepGuard.runOnce({ catalog: testDeps.catalog, stemStore: testDeps.stemStore })
}
