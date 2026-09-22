import { decodeFloat32Wav } from '../domain/audio/float32-wav'
import { FALLBACK_MIXER_PROFILE } from '../domain/mixer/mixer'
import type { Track } from '../domain/track'
import type {
  AudioEnginePort,
  MixerSession,
  MixerSessionLane,
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

function isAllZero(channel: Float32Array): boolean {
  for (const sample of channel) {
    if (sample !== 0) return false
  }
  return true
}

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

async function decodeLane(
  track: Track,
  laneId: string,
  displayName: string,
  absentable: boolean,
  stemStore: StemStorePort,
): Promise<MixerSessionLane & { readonly sampleRate: number }> {
  const bytes = await stemStore.readLane(track.resultKey, laneId)
  const decoded = decodeFloat32Wav(bytes)
  if (decoded.planar.length !== 2) {
    throw new Error(`open-in-mixer.unsupported_channel_count:${decoded.planar.length}`)
  }
  const [left, right] = decoded.planar
  // An absentable role lane (Rock's guitar_center/guitar_sides) with no
  // detectable energy is still included as real, aligned, controllable
  // silence rather than hidden (`feature-parity.md`'s Mixer "Absent lane"
  // row) — "no detectable energy" is defined here as every decoded sample
  // being exactly 0, the simplest and equally-correct reading of the
  // residual math the writer's task explicitly allowed choosing between.
  const absent = absentable && isAllZero(left) && isAllZero(right)
  return {
    laneId,
    displayName,
    channels: [left, right] as const,
    absent,
    sampleRate: decoded.sampleRate,
  }
}

/**
 * Loads a track's stored stem lanes into a `MixerSession` and hands it to
 * the `AudioEnginePort`. Reuses `resolveStemProfile` (the same lane-set
 * derivation `separate.ts` already uses) rather than re-deriving lane ids,
 * and decodes each lane with the exact byte-identical `decodeFloat32Wav`
 * codec — never `AudioContext.decodeAudioData`, which would risk
 * resample/drift on already-exact stored PCM
 * (`docs/decisions/architecture.md`, Runtime topology).
 *
 * A track that can't be found, or whose stems fail to load/decode or
 * disagree on sample rate, still calls `AudioEnginePort.load` — with the
 * 4-lane Basic-layout error placeholder session instead of throwing,
 * matching the domain's failed-load fallback rule.
 */
export async function openInMixer(trackId: string, deps: OpenInMixerDeps): Promise<OpenInMixerResult> {
  const track = await deps.catalog.getById(trackId)
  if (track === undefined) {
    const session = fallbackSession(trackId)
    await deps.audioEngine.load(session)
    return Object.freeze({ ok: false, reason: 'track-not-found', session })
  }

  try {
    const profile = resolveStemProfile(track.profileId)
    const decodedLanes = await Promise.all(
      profile.lanes.map((lane) =>
        decodeLane(track, lane.laneId, lane.displayName, lane.absentable, deps.stemStore)),
    )

    const sampleRate = decodedLanes[0]?.sampleRate ?? FALLBACK_SAMPLE_RATE
    if (decodedLanes.some((lane) => lane.sampleRate !== sampleRate)) {
      throw new Error('open-in-mixer.sample_rate_mismatch')
    }
    const frameCount = decodedLanes[0]?.channels[0].length ?? 0
    if (decodedLanes.some((lane) => lane.channels[0].length !== frameCount || lane.channels[1].length !== frameCount)) {
      throw new Error('open-in-mixer.lane_length_mismatch')
    }

    const session: MixerSession = Object.freeze({
      trackId,
      sampleRate,
      frameCount,
      lanes: Object.freeze(decodedLanes.map(({ laneId, displayName, channels, absent }) => Object.freeze({
        laneId, displayName, channels, absent,
      }))),
      fallback: false,
    })
    await deps.audioEngine.load(session)
    return Object.freeze({ ok: true, session })
  } catch {
    const session = fallbackSession(trackId)
    await deps.audioEngine.load(session)
    return Object.freeze({ ok: false, reason: 'stems-unavailable', session })
  }
}
