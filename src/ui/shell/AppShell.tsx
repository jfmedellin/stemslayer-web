import type { ReactNode } from 'react'
import type { OnnxProvider } from '../../infrastructure/onnx-worker/onnx-session-manager'
import { formatBytes } from '../format/format-bytes'

export type NavDestination = 'upload' | 'library' | 'mixer' | 'export'

interface NavDestinationDescriptor {
  readonly id: NavDestination
  readonly label: string
}

const NAV_DESTINATIONS: readonly NavDestinationDescriptor[] = [
  { id: 'upload', label: 'Upload' },
  { id: 'library', label: 'Library' },
  { id: 'mixer', label: 'Mixer' },
  { id: 'export', label: 'Export' },
]

export interface AppShellProps {
  readonly activeDestination: NavDestination
  readonly onNavigate: (destination: NavDestination) => void
  readonly engineProvider: OnnxProvider
  /** `null` while the quota headroom hasn't resolved yet. */
  readonly availableBytes: number | null
  readonly children: ReactNode
}

/**
 * The real app shell: header with the WebGPU/WASM pill, left nav across the
 * four destinations, and the storage meter. `QuotaPort` only exposes the
 * origin's free headroom (`quota - usage`), not `quota`/`usage` separately,
 * so the meter reads "free", not the mockup's literal "X GB / Y GB" split.
 */
export function AppShell({ activeDestination, onNavigate, engineProvider, availableBytes, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <span className="wordmark">Stemslayer</span>
          <span className="brand-badge">STUDIO</span>
        </div>
        <span className="engine-pill" data-provider={engineProvider} aria-label="Inference engine">
          {engineProvider === 'webgpu' ? 'WebGPU' : 'WASM'}
        </span>
      </header>

      <nav className="app-nav" aria-label="Destinations">
        <div>
          <p className="nav-heading">Workspace</p>
          <ul className="nav-list">
            {NAV_DESTINATIONS.map((destination) => (
              <li key={destination.id}>
                <button
                  type="button"
                  className="nav-item"
                  data-destination={destination.id}
                  aria-label={destination.label}
                  aria-current={activeDestination === destination.id ? 'page' : undefined}
                  onClick={() => onNavigate(destination.id)}
                >
                  {destination.label}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="storage-meter" aria-label="Browser storage">
          <p className="storage-meter-label">Browser storage</p>
          <p className="storage-meter-value">
            {availableBytes === null ? 'Checking…' : `${formatBytes(availableBytes)} free`}
          </p>
          <p className="storage-meter-note">Results live in this browser only.</p>
        </div>
      </nav>

      <main className="workspace" aria-label="Workspace">
        {children}
      </main>
    </div>
  )
}
