import { transitionTrack, updateTrackMetadata, type Track } from '../domain/track'
import type { CatalogPort } from './ports/catalog-port'
import { InferenceCancelled, type InferenceHandle, type InferencePort } from './ports/inference-port'
import type { ModelStorePort } from './ports/model-store-port'
import type { StemStorePort } from './ports/stem-store-port'
import { resolveStemProfile } from './resolve-stem-profile'
import { CANCELLED_ERROR_DETAIL, failureErrorDetail } from './separation-copy'
import { expectedLaneKeys } from './separation-lane-keys'

export type SeparateProgressEvent =
  | Readonly<{ phase: 'preparing'; detail: string }>
  | Readonly<{ phase: 'processing'; window: number; totalWindows: number }>

export interface SeparateDeps {
  readonly catalog: CatalogPort
  readonly stemStore: StemStorePort
  readonly modelStore: ModelStorePort
  readonly inference: InferencePort
  readonly onProgress?: (event: SeparateProgressEvent) => void
}

export type SeparateResult =
  | Readonly<{ ok: true; track: Track }>
  | Readonly<{ ok: false; reason: 'not-preparing' }>
  | Readonly<{ ok: false; reason: 'failed' | 'interrupted'; track: Track }>

export interface SeparateHandle {
  readonly result: Promise<SeparateResult>
  /** Aborts the run at whatever phase it is in; the pending `result` lands on `interrupted`. */
  terminate(): void
}

function preparingDetail(displayName: string, receivedBytes: number, totalBytes: number): string {
  const percent = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 100
  return `Preparing ${displayName}: ${percent}%`
}

async function settleFailure(
  track: Track,
  error: unknown,
  laneKeys: readonly string[],
  deps: SeparateDeps,
): Promise<SeparateResult> {
  await Promise.all(laneKeys.map((key) => deps.stemStore.delete(key)))

  if (error instanceof InferenceCancelled) {
    const interrupted = updateTrackMetadata(transitionTrack(track, 'interrupted'), {
      errorDetail: CANCELLED_ERROR_DETAIL,
    })
    await deps.catalog.update(interrupted)
    return Object.freeze({ ok: false, reason: 'interrupted', track: interrupted })
  }

  const cause = error instanceof Error ? error.message : String(error)
  const failed = updateTrackMetadata(transitionTrack(track, 'failed'), {
    errorDetail: failureErrorDetail(cause),
  })
  await deps.catalog.update(failed)
  return Object.freeze({ ok: false, reason: 'failed', track: failed })
}

/**
 * Runs a `preparing` track through model ensure, inference, and an
 * all-or-nothing publish (`docs/decisions/browser-storage.md` section 7,
 * `publish_atomic`): the catalog only flips to `ready` once every lane key
 * the profile expects has actually been written.
 *
 * Returns a handle rather than a bare promise so a caller (the
 * `SeparationQueue`) can cancel this run uniformly whether it is still
 * downloading the model or already inferring: `terminate()` before the
 * inference handle exists sets a flag checked right after `ensure()`
 * resolves (mirroring desktop's `commit_if_active`'s "flag checked
 * immediately before the final commit"); once inference has started,
 * `terminate()` forwards to `InferenceHandle.terminate()`.
 */
export function separate(trackId: string, source: Uint8Array, deps: SeparateDeps): SeparateHandle {
  let terminated = false
  let inferenceHandle: InferenceHandle | undefined

  const result = (async (): Promise<SeparateResult> => {
    const track = await deps.catalog.getById(trackId)
    if (track === undefined || track.status !== 'preparing') {
      return Object.freeze({ ok: false, reason: 'not-preparing' })
    }

    const profile = resolveStemProfile(track.profileId)
    const laneKeys = expectedLaneKeys(track)

    deps.onProgress?.({ phase: 'preparing', detail: preparingDetail(profile.displayName, 0, 1) })
    try {
      await deps.modelStore.ensure(profile.profileId, (progress) => {
        deps.onProgress?.({
          phase: 'preparing',
          detail: preparingDetail(profile.displayName, progress.receivedBytes, progress.totalBytes),
        })
      })
    } catch (error) {
      return settleFailure(track, error, laneKeys, deps)
    }

    if (terminated) {
      return settleFailure(track, new InferenceCancelled(), laneKeys, deps)
    }

    const processing = transitionTrack(track, 'processing')
    await deps.catalog.update(processing)

    inferenceHandle = deps.inference.run(
      { trackId, profile, source, resultKey: track.resultKey },
      (progress) => deps.onProgress?.({ phase: 'processing', ...progress }),
    )
    if (terminated) inferenceHandle.terminate()

    let writtenLaneKeys: readonly string[]
    try {
      writtenLaneKeys = await inferenceHandle.result
    } catch (error) {
      return settleFailure(processing, error, laneKeys, deps)
    }

    const allPresent = laneKeys.every((key) => writtenLaneKeys.includes(key))
    if (!allPresent) {
      return settleFailure(
        processing,
        new Error('separation.incomplete_publish The separation finished without every stem lane.'),
        laneKeys,
        deps,
      )
    }

    const ready = transitionTrack(processing, 'ready')
    await deps.catalog.update(ready)
    return Object.freeze({ ok: true, track: ready })
  })()

  return {
    result,
    terminate: () => {
      terminated = true
      inferenceHandle?.terminate()
    },
  }
}
