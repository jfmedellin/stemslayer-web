import type { KeyboardEvent, MouseEvent } from 'react'
import type { MixerSessionLane } from '../../application/ports/audio-engine-port'
import type { LoopRange } from '../../domain/mixer/mixer'
import { formatDuration } from '../format/format-duration'
import { LaneRow, type LaneRowState } from './LaneRow'

export interface MixerStripProps {
  readonly lanes: readonly MixerSessionLane[]
  readonly laneStates: Readonly<Record<string, LaneRowState>>
  readonly peaksByLaneId: Readonly<Record<string, Float32Array>>
  readonly frameCount: number
  readonly sampleRate: number
  readonly currentSample: number
  readonly loopRange: LoopRange | null
  /** The unfinalized loop start captured by "Set A", shown as a marker before "Set B" confirms the region. */
  readonly pendingLoopStart: number | null
  readonly onSeekTo: (sample: number) => void
  readonly onMuteToggle: (laneId: string) => void
  readonly onSoloToggle: (laneId: string) => void
  readonly onGainChange: (laneId: string, gainPercent: number) => void
}

const DEFAULT_LANE_STATE: LaneRowState = { gainPercent: 100, muted: false, solo: false }

function percentOf(sample: number, frameCount: number): number {
  return frameCount <= 0 ? 0 : Math.min(100, Math.max(0, (sample / frameCount) * 100))
}

/**
 * The shared lane strip: a pointer- and keyboard-seekable timeline ruler carrying the A/B
 * loop markers, the stacked lane rows, and one continuous playhead — a
 * single absolutely-positioned element spanning the whole strip, not drawn
 * per lane (ports `test_the_playhead_is_one_line_that_crosses_the_whole_strip`).
 */
export function MixerStrip({
  lanes, laneStates, peaksByLaneId, frameCount, sampleRate, currentSample, loopRange, pendingLoopStart,
  onSeekTo, onMuteToggle, onSoloToggle, onGainChange,
}: MixerStripProps) {
  function handleTimelineClick(event: MouseEvent<HTMLDivElement>): void {
    const rect = event.currentTarget.getBoundingClientRect()
    const fraction = rect.width === 0 ? 0 : (event.clientX - rect.left) / rect.width
    onSeekTo(Math.round(fraction * frameCount))
  }

  function handleTimelineKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const step = Math.max(1, Math.round(sampleRate))
    let next: number
    switch (event.key) {
      case 'ArrowLeft':
        next = currentSample - step
        break
      case 'ArrowRight':
        next = currentSample + step
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = frameCount
        break
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation() // The document shortcut otherwise seeks by ten seconds.
    onSeekTo(Math.min(frameCount, Math.max(0, next)))
  }

  return (
    <div className="mixer-strip">
      <div className="mixer-strip-caption">
        <span>Stems ({lanes.length})</span>
        <span>Timeline</span>
      </div>
      <div
        className="mixer-timeline-ruler"
        role="slider"
        tabIndex={0}
        aria-label="Track position"
        aria-valuemin={0}
        aria-valuemax={frameCount}
        aria-valuenow={currentSample}
        aria-valuetext={`${formatDuration(currentSample / sampleRate)} of ${formatDuration(frameCount / sampleRate)}`}
        onClick={handleTimelineClick}
        onKeyDown={handleTimelineKeyDown}
      >
        <div className="mixer-timeline-ticks" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <span key={index} className="mixer-timeline-tick">
              {formatDuration((frameCount / sampleRate) * index / 4)}
            </span>
          ))}
        </div>
        {pendingLoopStart !== null && loopRange === null && (
          <div
            className="mixer-loop-marker mixer-loop-marker-pending"
            style={{ left: `${percentOf(pendingLoopStart, frameCount)}%` }}
          >
            A {formatDuration(pendingLoopStart / sampleRate)}
          </div>
        )}
        {loopRange !== null && (
          <>
            <div
              className="mixer-loop-marker mixer-loop-marker-start"
              style={{ left: `${percentOf(loopRange.startSample, frameCount)}%` }}
            >
              A {formatDuration(loopRange.startSample / sampleRate)}
            </div>
            <div
              className="mixer-loop-marker mixer-loop-marker-end"
              style={{ left: `${percentOf(loopRange.endSample, frameCount)}%` }}
            >
              B {formatDuration(loopRange.endSample / sampleRate)}
            </div>
          </>
        )}
      </div>

      <div className="mixer-lanes">
        {lanes.map((lane) => (
          <LaneRow
            key={lane.laneId}
            lane={lane}
            state={laneStates[lane.laneId] ?? DEFAULT_LANE_STATE}
            peaks={peaksByLaneId[lane.laneId]}
            onMuteToggle={() => onMuteToggle(lane.laneId)}
            onSoloToggle={() => onSoloToggle(lane.laneId)}
            onGainChange={(gainPercent) => onGainChange(lane.laneId, gainPercent)}
          />
        ))}
        <div className="mixer-waveform-overlay" aria-hidden="true">
          <div className="mixer-playhead" style={{ left: `${percentOf(currentSample, frameCount)}%` }} />
        </div>
      </div>
    </div>
  )
}
