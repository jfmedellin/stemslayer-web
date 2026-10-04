import { FALLBACK_MIXER_PROFILE, MIXER_FRAME_CHUNK_SIZE, PEAK_BIN_COUNT } from '../domain/mixer/mixer'
import type { Track } from '../domain/track'
import type {
  AudioEnginePort,
  MixerSession,
  MixerSessionLane,
  MixerFrameBlock,
} from './ports/audio-engine-port'
import type { CatalogPort } from './ports/catalog-port'
import { resolveStemProfile } from './resolve-stem-profile'
import type { StemStorePort } from './ports/stem-store-port'

export interface OpenInMixerDeps {
  readonly catalog: CatalogPort
  readonly stemStore: StemStorePort
  readonly audioEngine: AudioEnginePort
}

export type OpenInMixerResult =
  | Readonly<{ ok: true; session: MixerSession }>
  | Readonly<{ ok: false; reason: 'track-not-found' | 'stems-unavailable'; session: MixerSession }>

const FALLBACK_FRAME_COUNT = 1
const FALLBACK_SAMPLE_RATE = 44_100

/**
 * The 4-lane Basic layout as a silent error placeholder, used both when the
 * track itself can't be found and when its stems fail to load
 * (`mixer_controller.py:658-671`, "a session that fails to load falls back
 * to the 4-lane legacy layout").
 */
function fallbackSession(trackId: string): MixerSession {
  const lanes: MixerSessionLane[] = FALLBACK_MIXER_PROFILE.lanes.map((lane) => ({
    laneId: lane.laneId,
    displayName: lane.displayName,
    channels: [
      new Float32Array(FALLBACK_FRAME_COUNT),
      new Float32Array(FALLBACK_FRAME_COUNT),
    ] as const,
    absent: false,
  }))
  return Object.freeze({
    trackId,
    sampleRate: FALLBACK_SAMPLE_RATE,
    frameCount: FALLBACK_FRAME_COUNT,
    lanes: Object.freeze(lanes),
    fallback: true,
  })
}

interface LaneScan {
  readonly laneId: string
  readonly displayName: string
  readonly absentable: boolean
  readonly sampleRate: number
  readonly frameCount: number
  readonly peaks: Float32Array
}

async function inspectLanes(
  track: Track,
  profileLanes: readonly { laneId: string; displayName: string; absentable: boolean }[],
  stemStore: StemStorePort,
  signal: AbortSignal,
): Promise<{ readonly lanes: readonly MixerSessionLane[]; readonly sampleRate: number; readonly frameCount: number }> {
  if (stemStore.readLaneInfo === undefined || stemStore.readLaneFrames === undefined) {
    throw new Error('open-in-mixer.range_reads_unsupported')
  }
  const readLaneInfo = stemStore.readLaneInfo.bind(stemStore)
  const readLaneFrames = stemStore.readLaneFrames.bind(stemStore)
  const metadata = await Promise.all(profileLanes.map(async (lane): Promise<LaneScan> => {
    const info = await readLaneInfo(track.resultKey, lane.laneId)
    if (info.frameCount <= 0) throw new Error('open-in-mixer.empty_lane')
    return { ...lane, ...info, peaks: new Float32Array(PEAK_BIN_COUNT) }
  }))
  const sampleRate = metadata[0]?.sampleRate ?? FALLBACK_SAMPLE_RATE
  const frameCount = metadata[0]?.frameCount ?? 0
  if (metadata.some((lane) => lane.sampleRate !== sampleRate)) throw new Error('open-in-mixer.sample_rate_mismatch')
  if (metadata.some((lane) => lane.frameCount !== frameCount)) throw new Error('open-in-mixer.lane_length_mismatch')
  const absentByLane = metadata.map((lane) => lane.absentable)
  for (let start = 0; start < frameCount; start += MIXER_FRAME_CHUNK_SIZE) {
    const count = Math.min(MIXER_FRAME_CHUNK_SIZE, frameCount - start)
    const blocks = await Promise.all(metadata.map((lane) =>
      readLaneFrames(track.resultKey, lane.laneId, start, count, signal)))
    for (let laneIndex = 0; laneIndex < metadata.length; laneIndex += 1) {
      const lane = metadata[laneIndex]
      const [left, right] = blocks[laneIndex]
      for (let offset = 0; offset < count; offset += 1) {
        if (left[offset] !== 0 || right[offset] !== 0) absentByLane[laneIndex] = false
        const bin = Math.min(PEAK_BIN_COUNT - 1, Math.floor(((start + offset) * PEAK_BIN_COUNT) / frameCount))
        const peak = Math.max(Math.abs(left[offset]), Math.abs(right[offset]))
        if (peak > lane.peaks[bin]) lane.peaks[bin] = peak
      }
    }
  }
  return {
    sampleRate,
    frameCount,
    lanes: Object.freeze(metadata.map((lane, index) => Object.freeze({
      laneId: lane.laneId,
      displayName: lane.displayName,
      absent: lane.absentable && absentByLane[index],
      peaks: lane.peaks,
    }))),
  }
}

/**
 * Validates and scans each OPFS lane through bounded frame ranges before
 * handing metadata and a synchronized range reader to the audio engine.
 * (`docs/decisions/architecture.md`, Runtime topology).
 *
 * A track that can't be found, or whose stems fail to validate or
 * disagree on sample rate, still calls `AudioEnginePort.load` — with the
 * 4-lane Basic-layout error placeholder session instead of throwing,
 * matching the domain's failed-load fallback rule.
 *
 * `isStale` (optional) is checked immediately before every
 * `AudioEnginePort.load` call and skips it when true. A caller juggling
 * overlapping loads (e.g. the Mixer UI switching tracks before a previous
 * decode finishes) must pass this so a superseded call's `load()` can never
 * land after a newer one's — the actual engine state is single, shared, and
 * `WebAudioEngine`/`AudioEnginePort` has no concept of "reject an outdated
 * load" on its own. Without this, discarding only the *caller's* stale
 * result (e.g. a UI generation-token check on the returned value) still lets
 * the wrong track's audio silently keep playing underneath a UI that shows
 * the newer track — this function's own `AudioEnginePort.load` calls are the
 * only place that can actually prevent that.
 */
export async function openInMixer(
  trackId: string,
  deps: OpenInMixerDeps,
  options?: { readonly isStale?: () => boolean; readonly signal?: AbortSignal },
): Promise<OpenInMixerResult> {
  const isStale = options?.isStale ?? (() => false)

  const track = await deps.catalog.getById(trackId)
  if (track === undefined) {
    const session = fallbackSession(trackId)
    if (!isStale() && !options?.signal?.aborted) await deps.audioEngine.load(session)
    return Object.freeze({ ok: false, reason: 'track-not-found', session })
  }

  try {
    const profile = resolveStemProfile(track.profileId)
    const scanned = await inspectLanes(track, profile.lanes, deps.stemStore, options?.signal ?? new AbortController().signal)
    const readLaneFrames = deps.stemStore.readLaneFrames
    if (readLaneFrames === undefined) throw new Error('open-in-mixer.range_reads_unsupported')
    const readFrames = async (start: number, count: number, signal?: AbortSignal): Promise<MixerFrameBlock> => {
      if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(count)
        || count <= 0 || count > MIXER_FRAME_CHUNK_SIZE || start + count > scanned.frameCount) {
        throw new Error('open-in-mixer.invalid_frame_range')
      }
      return Promise.all(profile.lanes.map((lane) =>
        readLaneFrames.call(deps.stemStore, track.resultKey, lane.laneId, start, count, signal)))
    }

    const session: MixerSession = Object.freeze({
      trackId,
      sampleRate: scanned.sampleRate,
      frameCount: scanned.frameCount,
      lanes: scanned.lanes,
      readFrames,
      fallback: false,
    })
    if (!isStale() && !options?.signal?.aborted) await deps.audioEngine.load(session)
    return Object.freeze({ ok: true, session })
  } catch {
    const session = fallbackSession(trackId)
    if (!isStale() && !options?.signal?.aborted) await deps.audioEngine.load(session)
    return Object.freeze({ ok: false, reason: 'stems-unavailable', session })
  }
}
