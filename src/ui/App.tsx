import { useEffect, useMemo, useState } from 'react'
import type { SeparateProgressEvent } from '../application/separate'
import { createAppDependencies, type AppDependencies } from './app-dependencies'
import { LibraryPage, type LibraryPageDeps } from './library/LibraryPage'
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

/** Mixer/Export are navigation targets only in this phase. */
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
  const [progressByTrackId, setProgressByTrackId] = useState<Readonly<Record<string, SeparateProgressEvent>>>({})

  useEffect(() => {
    let cancelled = false
    deps.addToLibraryDeps.quota.availableBytes().then((bytes) => {
      if (!cancelled) setAvailableBytes(bytes)
    })
    return () => {
      cancelled = true
    }
  }, [deps])

  // Owns the one place progress state can live, so it survives Upload ->
  // Library navigation within the tab (the queue itself keeps no React state).
  useEffect(() => deps.progressHub.subscribe((trackId, event) => {
    setProgressByTrackId((previous) => ({ ...previous, [trackId]: event }))
  }), [deps])

  const libraryDeps = useMemo<LibraryPageDeps>(() => ({
    catalog: deps.addToLibraryDeps.catalog,
    stemStore: deps.stemStore,
    hash: deps.addToLibraryDeps.hash,
    lock: deps.addToLibraryDeps.lock,
  }), [deps])

  const engineProvider = detectEngineProvider(deps.navigatorRef)

  return (
    <AppShell
      activeDestination={destination}
      onNavigate={setDestination}
      engineProvider={engineProvider}
      availableBytes={availableBytes}
    >
      {destination === 'upload' && (
        <UploadPage deps={deps.addToLibraryDeps} navigatorRef={deps.navigatorRef} queue={deps.separationQueue} />
      )}
      {destination === 'library' && (
        <LibraryPage
          deps={libraryDeps}
          queue={deps.separationQueue}
          progressByTrackId={progressByTrackId}
          onOpenInMixer={() => setDestination('mixer')}
          startupSweepGuard={deps.startupSweepGuard}
        />
      )}
      {destination === 'mixer' && <PlaceholderPane title="Mixer" />}
      {destination === 'export' && <PlaceholderPane title="Export" />}
    </AppShell>
  )
}
