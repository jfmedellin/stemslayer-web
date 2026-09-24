import type { MixerSessionLane } from '../../application/ports/audio-engine-port'
import { ABSENT_LANE_SUFFIX } from '../../domain/mixer/mixer'
import { formatGainDb } from '../format/format-db'
import { laneColorVar } from './lane-color'
import { buildWaveformPath } from './waveform-path'

export interface LaneRowState {
  readonly gainPercent: number
  readonly muted: boolean
  readonly solo: boolean
}

export interface LaneRowProps {
  readonly lane: MixerSessionLane
  readonly state: LaneRowState
  /** `undefined` only for the one render before the peak envelope finishes computing. */
  readonly peaks: Float32Array | undefined
  readonly onMuteToggle: () => void
  readonly onSoloToggle: () => void
  readonly onGainChange: (gainPercent: number) => void
}

const WAVEFORM_WIDTH = 1000
const WAVEFORM_HEIGHT = 48

/**
 * One lane strip row: color ribbon, waveform, mute (`M`)/solo (`S`) pills,
 * and a gain fader with its dB readout. An absent lane (Rock's
 * `guitar_center`/`guitar_sides` with no detectable energy) still renders
 * fully controllable, labeled with `ABSENT_LANE_SUFFIX` rather than hidden.
 */
export function LaneRow({ lane, state, peaks, onMuteToggle, onSoloToggle, onGainChange }: LaneRowProps) {
  const label = lane.absent ? `${lane.displayName}${ABSENT_LANE_SUFFIX}` : lane.displayName

  return (
    <div className="mixer-lane-row" data-lane-id={lane.laneId} data-absent={lane.absent}>
      <div className="mixer-lane-ribbon" style={{ background: `var(${laneColorVar(lane.laneId)})` }} />

      <div className="mixer-lane-info">
        <div className="mixer-lane-heading">
          <button
            type="button"
            className="mixer-lane-pill mixer-lane-mute"
            aria-pressed={state.muted}
            aria-label={`Mute ${lane.displayName}`}
            onClick={onMuteToggle}
          >
            M
          </button>
          <button
            type="button"
            className="mixer-lane-pill mixer-lane-solo"
            aria-pressed={state.solo}
            aria-label={`Solo ${lane.displayName}`}
            onClick={onSoloToggle}
          >
            S
          </button>
          <p className="mixer-lane-name">{label}</p>
        </div>
        <div className="mixer-lane-gain">
          <input
            type="range"
            className="mixer-lane-gain-fader"
            min={0}
            max={100}
            value={state.gainPercent}
            onChange={(event) => onGainChange(Number(event.target.value))}
            aria-label={`${lane.displayName} gain`}
          />
          <span className="mixer-lane-gain-readout">{formatGainDb(state.gainPercent)}</span>
        </div>
      </div>

      <svg
        className="mixer-lane-waveform"
        viewBox={`0 0 ${WAVEFORM_WIDTH} ${WAVEFORM_HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {peaks !== undefined && <path d={buildWaveformPath(peaks, WAVEFORM_WIDTH, WAVEFORM_HEIGHT)} />}
      </svg>

    </div>
  )
}
