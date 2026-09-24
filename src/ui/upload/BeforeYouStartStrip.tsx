import type { OnnxProvider } from '../../infrastructure/onnx-worker/onnx-session-manager'
import { formatBytes } from '../format/format-bytes'
import { formatDuration } from '../format/format-duration'

export interface BeforeYouStartStripProps {
  readonly engineProvider: OnnxProvider
  readonly estimateSeconds: number
  /** `null` while the quota headroom hasn't resolved yet. */
  readonly availableBytes: number | null
  readonly modelsLabel: string
}

/** The "before you start" strip: Engine, Estimate, Storage, Models. */
export function BeforeYouStartStrip({
  engineProvider,
  estimateSeconds,
  availableBytes,
  modelsLabel,
}: BeforeYouStartStripProps) {
  return (
    <dl className="before-you-start">
      <div className="before-you-start-field">
        <dt>Engine</dt>
        <dd>{engineProvider === 'webgpu' ? 'WebGPU' : 'WASM'}</dd>
      </div>
      <div className="before-you-start-field">
        <dt>Estimate</dt>
        <dd>~{formatDuration(estimateSeconds)}</dd>
      </div>
      <div className="before-you-start-field">
        <dt>Storage</dt>
        <dd>{availableBytes === null ? '—' : `${formatBytes(availableBytes)} free`}</dd>
      </div>
      <div className="before-you-start-field">
        <dt>Models</dt>
        <dd>{modelsLabel}</dd>
      </div>
    </dl>
  )
}
