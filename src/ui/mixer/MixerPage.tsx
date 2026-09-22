import { useCallback, useEffect, useRef, useState } from 'react'
import { openInMixer, type OpenInMixerDeps } from '../../application/open-in-mixer'
import type { MixerPlaybackProgress, MixerSession } from '../../application/ports/audio-engine-port'
import { resolveStemProfile } from '../../application/resolve-stem-profile'
import type { Track } from '../../domain/track'
import {
  MixerLoadGeneration,
  computePeakEnvelope,
  createLoopRange,
  masterGainFromPercent,
  nudgeSample,
  resolveEffectiveGains,
  type LoopRange,
  type MixerLaneState,
} from '../../domain/mixer/mixer'
import { canTogglePlayback } from './keyboard-guard'
import type { LaneRowState } from './LaneRow'
import { MixerStrip } from './MixerStrip'
import { TrackHeader } from './TrackHeader'
import { TransportBar } from './TransportBar'

export type MixerPageDeps = OpenInMixerDeps

export interface MixerPageProps {
  readonly deps: MixerPageDeps
  readonly trackId: string
  readonly onBackToLibrary: () => void
  readonly onExport: () => void
}

const DEFAULT_LANE_STATE: LaneRowState = { gainPercent: 100, muted: false, solo: false }
const DEFAULT_MASTER_GAIN_PERCENT = 100

function initialLaneStates(session: MixerSession): Readonly<Record<string, LaneRowState>> {
  return Object.fromEntries(session.lanes.map((lane) => [lane.laneId, DEFAULT_LANE_STATE]))
}

/**
 * Container for the Mixer destination: loads `trackId`'s session via
 * `openInMixer` (discarding a stale/superseded load via the domain's
 * `MixerLoadGeneration` guard), owns per-lane mute/solo/gain and master-gain
 * UI state — pushing the domain's resolved effective gain into
 * `AudioEnginePort.setLaneGain` on every change so mute/solo feels instant —
 * owns the loop-range state, subscribes to the engine's batched playback
 * progress for the playhead/time readout, and binds the global transport
 * keyboard shortcuts while mounted.
 */
export function MixerPage({ deps, trackId, onBackToLibrary, onExport }: MixerPageProps) {
  const [track, setTrack] = useState<Track | undefined>(undefined)
  const [session, setSession] = useState<MixerSession | null>(null)
  const [loadOk, setLoadOk] = useState(true)
  const [laneStates, setLaneStates] = useState<Readonly<Record<string, LaneRowState>>>({})
  const [masterGainPercent, setMasterGainPercent] = useState(DEFAULT_MASTER_GAIN_PERCENT)
  const [loopRange, setLoopRangeState] = useState<LoopRange | null>(null)
  const [lastLoopRange, setLastLoopRange] = useState<LoopRange | null>(null)
  const [pendingLoopStart, setPendingLoopStart] = useState<number | null>(null)
  const [progress, setProgress] = useState<MixerPlaybackProgress>({ currentSample: 0, isPlaying: false })
  const [peaksByLaneId, setPeaksByLaneId] = useState<Readonly<Record<string, Float32Array>>>({})

  const depsRef = useRef(deps)
  depsRef.current = deps
  const generationRef = useRef(new MixerLoadGeneration())
  const sessionRef = useRef<MixerSession | null>(null)

  // Loads (or reloads) the track's mixer session whenever `trackId` changes.
  // `openInMixer` calls `AudioEnginePort.load(session)` internally; passing
  // `isStale` makes it skip that call when a newer track switch has already
  // superseded this one, so a superseded load can never land on the engine
  // after a newer one's — checking only the *UI* state below (as this used
  // to do) still let the wrong track's audio keep playing underneath a UI
  // that showed the newer track, since `WebAudioEngine` is one app-lifetime
  // singleton with no concept of "reject an outdated load" on its own
  // (native review finding R3-mixer-stale-load-race, corrected here).
  // `WebAudioEngine.load` already disconnects/replaces the previous worklet
  // node internally for a load that *does* proceed — nothing else needs
  // tearing down here between tracks.
  useEffect(() => {
    const token = generationRef.current.next()
    setSession(null)
    setProgress({ currentSample: 0, isPlaying: false })
    setLoopRangeState(null)
    setLastLoopRange(null)
    setPendingLoopStart(null)
    setMasterGainPercent(DEFAULT_MASTER_GAIN_PERCENT)

    const isStale = (): boolean => generationRef.current.isStale(token)
    void Promise.all([
      depsRef.current.catalog.getById(trackId),
      openInMixer(trackId, depsRef.current, { isStale }),
    ])
      .then(([loadedTrack, result]) => {
        if (isStale()) return
        setTrack(loadedTrack)
        setSession(result.session)
        setLoadOk(result.ok)
        setLaneStates(initialLaneStates(result.session))
        setPeaksByLaneId(Object.fromEntries(
          result.session.lanes.map((lane) => [lane.laneId, computePeakEnvelope(lane.channels)]),
        ))
      })
  }, [trackId])

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  // Batched playhead/time progress from the engine.
  useEffect(() => depsRef.current.audioEngine.onProgress((next) => setProgress(next)), [trackId])

  // Pushes every lane's mute/solo/gain-resolved effective gain on any
  // change, so a mute/solo toggle feels instant.
  useEffect(() => {
    if (session === null) return
    const laneList: readonly MixerLaneState[] = session.lanes.map((lane) => ({
      laneId: lane.laneId,
      ...(laneStates[lane.laneId] ?? DEFAULT_LANE_STATE),
    }))
    const gains = resolveEffectiveGains(laneList)
    for (const [laneId, gain] of gains) depsRef.current.audioEngine.setLaneGain(laneId, gain)
  }, [session, laneStates])

  useEffect(() => {
    if (session === null) return
    depsRef.current.audioEngine.setMasterGain(masterGainFromPercent(masterGainPercent))
  }, [session, masterGainPercent])

  useEffect(() => {
    if (session === null) return
    depsRef.current.audioEngine.setLoopRange(loopRange)
  }, [session, loopRange])

  // Pauses playback on unmount (navigating away, or this container being
  // replaced) — deliberately never `dispose()`. `app-dependencies.ts`
  // constructs exactly one `WebAudioEngine`/`AudioContext` for the app's
  // whole lifetime, shared across every Mixer visit (matching
  // `separationQueue`'s own singleton pattern); `AudioEnginePort.dispose()`
  // makes "the port instance ... unusable afterward", so calling it on
  // ordinary navigate-away would make Mixer permanently unusable after the
  // first visit. Loading a different track already replaces the worklet
  // node cleanly (`WebAudioEngine.load`'s own disconnect-then-reconnect,
  // proven by P9A's own browser tests), so nothing leaks across track
  // switches either — `pause()` here only stops audible playback bleeding
  // into a page the user has already left.
  useEffect(() => () => {
    if (sessionRef.current !== null) depsRef.current.audioEngine.pause()
  }, [])

  const canPlay = session !== null

  const handleTogglePlayback = useCallback(() => {
    if (session === null) return
    if (progress.isPlaying) depsRef.current.audioEngine.pause()
    else depsRef.current.audioEngine.play()
  }, [session, progress.isPlaying])

  const handleSkip = useCallback((direction: 1 | -1) => {
    if (session === null) return
    const next = nudgeSample(progress.currentSample, direction, session.sampleRate, session.frameCount)
    depsRef.current.audioEngine.seek(next)
    setProgress((previous) => ({ ...previous, currentSample: next }))
  }, [session, progress.currentSample])

  const handleSeekTo = useCallback((sample: number) => {
    if (session === null) return
    const clamped = Math.min(session.frameCount, Math.max(0, sample))
    depsRef.current.audioEngine.seek(clamped)
    setProgress((previous) => ({ ...previous, currentSample: clamped }))
  }, [session])

  const handleSetLoopA = useCallback(() => {
    setPendingLoopStart(progress.currentSample)
  }, [progress.currentSample])

  const handleSetLoopB = useCallback(() => {
    if (session === null || pendingLoopStart === null || progress.currentSample <= pendingLoopStart) return
    const range = createLoopRange(pendingLoopStart, progress.currentSample, session.frameCount)
    setLoopRangeState(range)
    setLastLoopRange(range)
    setPendingLoopStart(null)
  }, [session, pendingLoopStart, progress.currentSample])

  const handleClearLoop = useCallback(() => {
    setLoopRangeState(null)
    setPendingLoopStart(null)
  }, [])

  // 'L' toggle semantics (the tracker's own call, no fixed desktop
  // precedent for a settable A/B region): off -> on restores the last
  // confirmed region, or defaults to a whole-track loop if none was ever
  // set; on -> off clears it. The confirmed region itself is left
  // untouched, so toggling back on always restores exactly what was there.
  const handleToggleLoopKey = useCallback(() => {
    if (session === null) return
    if (loopRange !== null) {
      setLoopRangeState(null)
      return
    }
    setLoopRangeState(lastLoopRange ?? createLoopRange(0, session.frameCount, session.frameCount))
  }, [session, loopRange, lastLoopRange])

  const handleMuteToggle = useCallback((laneId: string) => {
    setLaneStates((previous) => {
      const current = previous[laneId] ?? DEFAULT_LANE_STATE
      return { ...previous, [laneId]: { ...current, muted: !current.muted } }
    })
  }, [])

  const handleSoloToggle = useCallback((laneId: string) => {
    setLaneStates((previous) => {
      const current = previous[laneId] ?? DEFAULT_LANE_STATE
      return { ...previous, [laneId]: { ...current, solo: !current.solo } }
    })
  }, [])

  const handleGainChange = useCallback((laneId: string, gainPercent: number) => {
    setLaneStates((previous) => {
      const current = previous[laneId] ?? DEFAULT_LANE_STATE
      return { ...previous, [laneId]: { ...current, gainPercent } }
    })
  }, [])

  // Global transport shortcuts. This listener only exists while `MixerPage`
  // is mounted, which `App.tsx` only does while the Mixer destination is
  // active — the structural equivalent of the desktop's `view === 'mixer'`
  // guard half. Space always `preventDefault()`s while mounted (so it never
  // scrolls the page whenever Mixer is showing, loading or not), but only
  // actually toggles playback when `canTogglePlayback` is also true.
  useEffect(() => {
    function handleKeydown(event: KeyboardEvent): void {
      if (event.code === 'Space') {
        event.preventDefault()
        if (canTogglePlayback('mixer', canPlay)) handleTogglePlayback()
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        handleSkip(1)
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        handleSkip(-1)
        return
      }
      if (event.key === 'l' || event.key === 'L') {
        event.preventDefault()
        handleToggleLoopKey()
      }
    }

    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [canPlay, handleTogglePlayback, handleSkip, handleToggleLoopKey])

  const profileDisplayName = track === undefined ? '' : resolveStemProfile(track.profileId).displayName

  return (
    <section className="mixer-page" aria-labelledby="mixer-page-title">
      {track !== undefined
        ? (
          <TrackHeader
            track={track}
            profileDisplayName={profileDisplayName}
            laneCount={session?.lanes.length ?? 0}
            onBackToLibrary={onBackToLibrary}
            onExport={onExport}
          />
        )
        : <h1 id="mixer-page-title">Mixer</h1>}

      {session === null && <p className="mixer-loading" role="status">Loading…</p>}

      {session !== null && !loadOk && (
        <p className="mixer-load-error" role="alert">
          Could not load this track&apos;s stems — showing a silent fallback layout.
        </p>
      )}

      {session !== null && (
        <>
          <MixerStrip
            lanes={session.lanes}
            laneStates={laneStates}
            peaksByLaneId={peaksByLaneId}
            frameCount={session.frameCount}
            sampleRate={session.sampleRate}
            currentSample={progress.currentSample}
            loopRange={loopRange}
            pendingLoopStart={pendingLoopStart}
            onSeekTo={handleSeekTo}
            onMuteToggle={handleMuteToggle}
            onSoloToggle={handleSoloToggle}
            onGainChange={handleGainChange}
          />

          <TransportBar
            isPlaying={progress.isPlaying}
            canPlay={canPlay}
            currentSample={progress.currentSample}
            frameCount={session.frameCount}
            sampleRate={session.sampleRate}
            masterGainPercent={masterGainPercent}
            onTogglePlayback={handleTogglePlayback}
            onSkipBack={() => handleSkip(-1)}
            onSkipForward={() => handleSkip(1)}
            onMasterGainChange={setMasterGainPercent}
            onSetLoopA={handleSetLoopA}
            onSetLoopB={handleSetLoopB}
            onClearLoop={handleClearLoop}
            hasPendingLoopStart={pendingLoopStart !== null}
            hasLoopRange={loopRange !== null}
          />
        </>
      )}
    </section>
  )
}
