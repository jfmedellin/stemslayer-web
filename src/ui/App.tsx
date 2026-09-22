import { useEffect, useMemo, useState } from 'react'
import type { SeparateProgressEvent } from '../application/separate'
import { createAppDependencies, type AppDependencies } from './app-dependencies'
import { ExportPage, type ExportPageDeps } from './export/ExportPage'
import { LibraryPage, type LibraryPageDeps } from './library/LibraryPage'
import { MixerPage, type MixerPageDeps } from './mixer/MixerPage'
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
  // The track "Open in mixer" was last clicked for; `null` until Library
  // opens one (P9B fix: `onOpenInMixer` now carries the trackId the whole
  // way from `TrackRow` through `LibraryPage` to here, instead of only
  // navigating to the Mixer destination with no track selected).
  const [mixerTrackId, setMixerTrackId] = useState<string | null>(null)
  // The track Export was last opened for; `null` until Mixer's "Export
  // stems" or Library's "Export" action sets one (this task's own
  // trackId-threading fix, mirroring `mixerTrackId`'s P9B pattern exactly).
  const [exportTrackId, setExportTrackId] = useState<string | null>(null)

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

  const mixerDeps = useMemo<MixerPageDeps>(() => ({
    catalog: deps.addToLibraryDeps.catalog,
    stemStore: deps.stemStore,
    audioEngine: deps.audioEngine,
  }), [deps])

  const exportDeps = useMemo<ExportPageDeps>(() => ({
    catalog: deps.addToLibraryDeps.catalog,
    stemStore: deps.stemStore,
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
          onOpenInMixer={(trackId) => {
            setMixerTrackId(trackId)
            setDestination('mixer')
          }}
          onExport={(trackId) => {
            setExportTrackId(trackId)
            setDestination('export')
          }}
          startupSweepGuard={deps.startupSweepGuard}
        />
      )}
      {destination === 'mixer' && (
        mixerTrackId === null
          ? <PlaceholderPane title="Mixer" />
          : (
            <MixerPage
              deps={mixerDeps}
              trackId={mixerTrackId}
              onBackToLibrary={() => setDestination('library')}
              onExport={(trackId) => {
                setExportTrackId(trackId)
                setDestination('export')
              }}
            />
          )
      )}
      {destination === 'export' && (
        exportTrackId === null
          ? <PlaceholderPane title="Export" />
          : (
            <ExportPage
              deps={exportDeps}
              trackId={exportTrackId}
              onBackToMixer={() => {
                // "Back to mixer" always opens the mixer for the track
                // currently being exported, regardless of which entry point
                // (Mixer's "Export stems" or Library's "Export") got here —
                // otherwise a Library-originated Export would land on a
                // stale/absent `mixerTrackId` and show the Mixer placeholder.
                setMixerTrackId(exportTrackId)
                setDestination('mixer')
              }}
            />
          )
      )}
    </AppShell>
  )
}
