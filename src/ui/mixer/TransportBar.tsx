import { formatGainDb } from '../format/format-db'
import { formatDuration } from '../format/format-duration'

export interface TransportBarProps {
  readonly isPlaying: boolean
  readonly canPlay: boolean
  readonly currentSample: number
  readonly frameCount: number
  readonly sampleRate: number
  readonly masterGainPercent: number
  readonly onTogglePlayback: () => void
  readonly onSkipBack: () => void
  readonly onSkipForward: () => void
  readonly onMasterGainChange: (percent: number) => void
  readonly onSetLoopA: () => void
  readonly onSetLoopB: () => void
  readonly onClearLoop: () => void
  readonly hasPendingLoopStart: boolean
  readonly hasLoopRange: boolean
}

/**
 * Transport bar: play/pause, exact ±10 s skip, `MM:SS / MM:SS` time readout,
 * A/B loop controls, master gain with its dB readout, and the keyboard-hint
 * copy fetched from the redrawn Mixer mockup.
 */
export function TransportBar({
  isPlaying, canPlay, currentSample, frameCount, sampleRate, masterGainPercent,
  onTogglePlayback, onSkipBack, onSkipForward, onMasterGainChange,
  onSetLoopA, onSetLoopB, onClearLoop, hasPendingLoopStart, hasLoopRange,
}: TransportBarProps) {
  return (
    <div className="mixer-transport">
      <div className="mixer-transport-buttons">
        <button type="button" className="mixer-skip-back" onClick={onSkipBack} disabled={!canPlay}>
          −10 S
        </button>
        <button
          type="button"
          className="mixer-play-pause"
          onClick={onTogglePlayback}
          disabled={!canPlay}
          aria-pressed={isPlaying}
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="mixer-skip-forward" onClick={onSkipForward} disabled={!canPlay}>
          +10 S
        </button>
      </div>

      <p className="mixer-time-readout">
        {formatDuration(currentSample / sampleRate)} / {formatDuration(frameCount / sampleRate)}
      </p>

      <div className="mixer-loop-controls">
        <button type="button" className="mixer-set-loop-a" onClick={onSetLoopA} disabled={!canPlay}>
          Set A
        </button>
        <button
          type="button"
          className="mixer-set-loop-b"
          onClick={onSetLoopB}
          disabled={!canPlay || !hasPendingLoopStart}
        >
          Set B
        </button>
        <button
          type="button"
          className="mixer-clear-loop"
          onClick={onClearLoop}
          disabled={!hasLoopRange && !hasPendingLoopStart}
        >
          Clear loop
        </button>
      </div>

      <div className="mixer-master-gain">
        <label htmlFor="mixer-master-gain-fader" className="mixer-master-gain-label">Master</label>
        <input
          id="mixer-master-gain-fader"
          type="range"
          className="mixer-master-gain-fader"
          min={0}
          max={100}
          value={masterGainPercent}
          onChange={(event) => onMasterGainChange(Number(event.target.value))}
        />
        <span className="mixer-master-gain-readout">{formatGainDb(masterGainPercent)}</span>
      </div>

      <p className="mixer-keyboard-hints">SPACE PLAY/PAUSE · ← → ±10 S · L LOOP</p>
    </div>
  )
}
