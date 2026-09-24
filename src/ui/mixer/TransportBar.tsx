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
  readonly onToggleLoop: () => void
  readonly onSkipBack: () => void
  readonly onSkipForward: () => void
  readonly onMasterGainChange: (percent: number) => void
  readonly onSetLoopA: () => void
  readonly onSetLoopB: () => void
  readonly onClearLoop: () => void
  readonly hasPendingLoopStart: boolean
  readonly hasLoopRange: boolean
  readonly isLoopActive: boolean
}

/**
 * Transport bar: play/pause, exact ±10 s skip, `MM:SS / MM:SS` time readout,
 * A/B loop controls, master gain with its dB readout, and the keyboard-hint
 * copy fetched from the redrawn Mixer mockup.
 */
export function TransportBar({
  isPlaying, canPlay, currentSample, frameCount, sampleRate, masterGainPercent, isLoopActive,
  onTogglePlayback, onSkipBack, onSkipForward, onMasterGainChange,
  onToggleLoop, onSetLoopA, onSetLoopB, onClearLoop, hasPendingLoopStart, hasLoopRange,
}: TransportBarProps) {
  return (
    <div className="mixer-transport">
      <div className="mixer-transport-buttons">
        <button type="button" className="mixer-skip-back" onClick={onSkipBack} disabled={!canPlay} aria-label="Seek backward 10 seconds">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M11 5 3 12l8 7V5Zm10 0-8 7 8 7V5Z" />
          </svg>
        </button>
        <button
          type="button"
          className="mixer-play-pause"
          onClick={onTogglePlayback}
          disabled={!canPlay}
          aria-pressed={isPlaying}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying
            ? <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 5h4v14H7zm6 0h4v14h-4z" /></svg>
            : <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m7 4 13 8-13 8V4Z" /></svg>}
        </button>
        <button type="button" className="mixer-skip-forward" onClick={onSkipForward} disabled={!canPlay} aria-label="Seek forward 10 seconds">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="m13 5 8 7-8 7V5ZM3 5l8 7-8 7V5Z" />
          </svg>
        </button>
        <button
          type="button"
          className="mixer-loop-toggle"
          onClick={onToggleLoop}
          disabled={!canPlay}
          aria-pressed={isLoopActive}
          aria-label={isLoopActive ? 'Disable loop' : 'Enable loop'}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M17 2 21 6l-4 4V7H7a3 3 0 0 0-3 3v1H2v-1a5 5 0 0 1 5-5h10V2Zm-10 20-4-4 4-4v3h10a3 3 0 0 0 3-3v-1h2v1a5 5 0 0 1-5 5H7v3Z" />
          </svg>
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
