import { useEffect, useState } from 'react'
import { createAppDependencies, type AppDependencies } from './app-dependencies'
import { AppShell, type NavDestination } from './shell/AppShell'
import { detectEngineProvider } from './upload/detect-engine-provider'
import { UploadPage } from './upload/UploadPage'

export interface AppProps {
  /** Injectable for tests; defaults to the real infrastructure composition root. */
  readonly dependencies?: AppDependencies
}

interface PlaceholderPaneProps {
  readonly title: string
}

/** Mixer/Export (and, until P8B lands, Library) are navigation targets only in this phase. */
function PlaceholderPane({ title }: PlaceholderPaneProps) {
  const headingId = `${title.toLowerCase()}-page-title`
  return (
    <section aria-labelledby={headingId}>
      <h1 id={headingId}>{title}</h1>
      <p>Coming soon.</p>
    </section>
  )
}

export function App({ dependencies }: AppProps) {
  const [deps] = useState<AppDependencies>(() => dependencies ?? createAppDependencies())
  const [destination, setDestination] = useState<NavDestination>('upload')
  const [availableBytes, setAvailableBytes] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    deps.addToLibraryDeps.quota.availableBytes().then((bytes) => {
      if (!cancelled) setAvailableBytes(bytes)
    })
    return () => {
      cancelled = true
    }
  }, [deps])

  const engineProvider = detectEngineProvider(deps.navigatorRef)

  return (
    <AppShell
      activeDestination={destination}
      onNavigate={setDestination}
      engineProvider={engineProvider}
      availableBytes={availableBytes}
    >
      {destination === 'upload' && (
        <UploadPage deps={deps.addToLibraryDeps} navigatorRef={deps.navigatorRef} />
      )}
      {destination === 'library' && <PlaceholderPane title="Library" />}
      {destination === 'mixer' && <PlaceholderPane title="Mixer" />}
      {destination === 'export' && <PlaceholderPane title="Export" />}
    </AppShell>
  )
}
