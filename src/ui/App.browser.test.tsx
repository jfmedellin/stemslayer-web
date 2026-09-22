import { afterEach, expect, test } from 'vitest'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import {
  buildFakeAppDependencies,
  settleStartupSweep,
  type FakeAppDependencies,
} from '../../tests/fakes/build-fake-app-dependencies'
import { encodeFloat32Wav } from '../domain/audio/float32-wav'
import { BASIC_PROFILE } from '../domain/stem-profile'
import type { Track } from '../domain/track'
import { App } from './App.tsx'

let root: Root
afterEach(() => root.unmount())

function renderApp(availableBytes = 5_000_000_000): FakeAppDependencies {
  const testDeps = buildFakeAppDependencies({ availableBytes })
  root = createRoot(document.body.appendChild(document.createElement('div')))
  flushSync(() => root.render(<App dependencies={testDeps.deps} />))
  return testDeps
}

function clickNav(label: string): void {
  const item = [...document.querySelectorAll('.nav-item')].find((el) => el.textContent === label)
  flushSync(() => (item as HTMLButtonElement).click())
}

test('renders the real four-destination shell with the Upload page active by default', () => {
  renderApp()
  expect([...document.querySelectorAll('.nav-item')].map((el) => el.textContent))
    .toEqual(['Upload', 'Library', 'Mixer', 'Export'])
  expect(document.querySelector('[aria-current="page"]')?.textContent).toBe('Upload')
  expect(document.querySelector('.drop-zone')).not.toBeNull()
  expect(document.querySelector('.engine-pill')?.textContent).toBe('WASM')
})

test('navigating to Library renders the real Library page, not a placeholder', () => {
  renderApp()
  clickNav('Library')
  expect(document.querySelector('[aria-current="page"]')?.textContent).toBe('Library')
  expect(document.querySelector('.drop-zone')).toBeNull()
  expect(document.querySelector('.library-search')).not.toBeNull()
  expect(document.querySelector('.library-empty')?.textContent).toBe('No tracks yet.')
})

test('a job enqueued from Upload is visible, with live progress, from Library after navigating', async () => {
  const testDeps = buildFakeAppDependencies({ availableBytes: 5_000_000_000 })
  await settleStartupSweep(testDeps) // the app has already booted before this "job" is created
  root = createRoot(document.body.appendChild(document.createElement('div')))
  flushSync(() => root.render(<App dependencies={testDeps.deps} />))

  // Seed a track directly in `preparing` (bypassing the drop-zone flow, already
  // covered by UploadPage's own tests) and feed the queue's onProgress the way
  // a real running job would, to prove App owns progress across the nav switch.
  const track = {
    trackId: 'track-a',
    title: 'song',
    artist: 'Unknown artist',
    genre: null,
    durationSeconds: 10,
    bpm: null,
    musicalKey: null,
    createdAtUtc: '2026-09-22T00:00:00.000Z',
    profileId: 'metal-stereo-six-stem',
    pipelineFingerprint: 'fp',
    resultKey: 'stems/track-a',
    sourceHash: 'hash-a',
    status: 'preparing' as const,
    errorDetail: null,
  }
  await testDeps.catalog.insert(track)
  flushSync(() => testDeps.deps.progressHub.emit('track-a', { phase: 'preparing', detail: 'Preparing Rock: 50%' }))

  clickNav('Library')
  await new Promise((resolve) => setTimeout(resolve, 250))

  const row = document.querySelector('.track-row[data-status="preparing"]')
  expect(row?.querySelector('.track-row-status')?.textContent).toBe('Preparing Rock: 50%')
})

function readyTrack(overrides: Partial<Track>): Track {
  return {
    trackId: 'track-1',
    title: 'Untitled',
    artist: 'Unknown artist',
    genre: null,
    durationSeconds: 1,
    bpm: null,
    musicalKey: null,
    createdAtUtc: '2026-09-22T00:00:00.000Z',
    profileId: BASIC_PROFILE.profileId,
    pipelineFingerprint: 'fp',
    resultKey: `stems/${overrides.trackId ?? 'track-1'}`,
    sourceHash: `hash-${overrides.trackId ?? 'track-1'}`,
    status: 'ready',
    errorDetail: null,
    ...overrides,
  }
}

async function seedStems(testDeps: FakeAppDependencies, track: Track): Promise<void> {
  for (const lane of BASIC_PROFILE.lanes) {
    const channel = Float32Array.from({ length: 100 }, (_unused, index) => (index / 1000) + 0.01)
    const bytes = encodeFloat32Wav({ sampleRate: 8_000, planar: [channel, channel] })
    await testDeps.stemStore.writeLane(track.resultKey, lane.laneId, bytes)
  }
}

// This proves the P9B trackId-threading fix end to end: before this fix,
// `LibraryPage`'s `onOpenInMixer` navigated to the Mixer destination with no
// track id, so Mixer had no way to know which track to load.
test('"Open in mixer" from a specific Library row opens the mixer with that exact track', async () => {
  const testDeps = buildFakeAppDependencies({ availableBytes: 5_000_000_000 })
  await settleStartupSweep(testDeps)

  const trackA = readyTrack({ trackId: 'track-a', title: 'First Song', artist: 'Artist A' })
  const trackB = readyTrack({ trackId: 'track-b', title: 'Second Song', artist: 'Artist B' })
  await testDeps.catalog.insert(trackA)
  await testDeps.catalog.insert(trackB)
  await seedStems(testDeps, trackA)
  await seedStems(testDeps, trackB)

  root = createRoot(document.body.appendChild(document.createElement('div')))
  flushSync(() => root.render(<App dependencies={testDeps.deps} />))

  clickNav('Library')
  await new Promise((resolve) => setTimeout(resolve, 50))

  const rowB = document.querySelector('.track-row[data-track-id="track-b"] .track-row-open-mixer')
  if (rowB === null) throw new Error('track-b open-in-mixer button not found')
  flushSync(() => (rowB as HTMLButtonElement).click())

  await new Promise((resolve, reject) => {
    const start = Date.now()
    const poll = setInterval(() => {
      const title = document.querySelector('.mixer-track-title')?.textContent
      if (title === 'Second Song') {
        clearInterval(poll)
        resolve(undefined)
      } else if (Date.now() - start > 2000) {
        clearInterval(poll)
        reject(new Error(`timed out waiting for mixer title, last seen: ${title}`))
      }
    }, 10)
  })

  expect(document.querySelector('.mixer-track-artist')?.textContent).toBe('Artist B')
  expect(document.querySelector('.mixer-track-title')?.textContent).not.toBe('First Song')
})

// Proves this task's own trackId-threading fix end to end: before it,
// neither `TrackHeader`'s "Export stems" nor Library's (new) "Export"
// action carried a trackId anywhere, so Export had no way to know which
// track to show (the same bug class P9B's own `onOpenInMixer` fix and
// P9C's `R3-mixer-stale-load-race` finding already caught elsewhere).
test('Library\'s "Export" action opens the Export page for that exact row\'s track', async () => {
  const testDeps = buildFakeAppDependencies({ availableBytes: 5_000_000_000 })
  await settleStartupSweep(testDeps)

  const trackA = readyTrack({ trackId: 'track-a', title: 'First Song', artist: 'Artist A' })
  const trackB = readyTrack({ trackId: 'track-b', title: 'Second Song', artist: 'Artist B' })
  await testDeps.catalog.insert(trackA)
  await testDeps.catalog.insert(trackB)
  await seedStems(testDeps, trackA)
  await seedStems(testDeps, trackB)

  root = createRoot(document.body.appendChild(document.createElement('div')))
  flushSync(() => root.render(<App dependencies={testDeps.deps} />))

  clickNav('Library')
  await new Promise((resolve) => setTimeout(resolve, 50))

  const rowBExport = document.querySelector('.track-row[data-track-id="track-b"] .track-row-export')
  if (rowBExport === null) throw new Error('track-b export button not found')
  flushSync(() => (rowBExport as HTMLButtonElement).click())

  await new Promise((resolve, reject) => {
    const start = Date.now()
    const poll = setInterval(() => {
      const title = document.querySelector('.export-track-title')?.textContent
      if (title?.startsWith('Second Song') === true) {
        clearInterval(poll)
        resolve(undefined)
      } else if (Date.now() - start > 2000) {
        clearInterval(poll)
        reject(new Error(`timed out waiting for export title, last seen: ${title}`))
      }
    }, 10)
  })

  expect(document.querySelector('.export-track-title')?.textContent).not.toContain('First Song')
})

// Same proof from Mixer's own entry point: "Export stems" must carry the
// track actually loaded in the mixer, not a stale or absent id.
test('Mixer\'s "Export stems" opens the Export page for the track that is actually loaded', async () => {
  const testDeps = buildFakeAppDependencies({ availableBytes: 5_000_000_000 })
  await settleStartupSweep(testDeps)

  const track = readyTrack({ trackId: 'track-only', title: 'Only Song', artist: 'Solo Artist' })
  await testDeps.catalog.insert(track)
  await seedStems(testDeps, track)

  root = createRoot(document.body.appendChild(document.createElement('div')))
  flushSync(() => root.render(<App dependencies={testDeps.deps} />))

  clickNav('Library')
  await new Promise((resolve) => setTimeout(resolve, 50))
  const openMixer = document.querySelector('.track-row[data-track-id="track-only"] .track-row-open-mixer')
  if (openMixer === null) throw new Error('open-in-mixer button not found')
  flushSync(() => (openMixer as HTMLButtonElement).click())

  await new Promise((resolve, reject) => {
    const start = Date.now()
    const poll = setInterval(() => {
      const title = document.querySelector('.mixer-track-title')?.textContent
      if (title === 'Only Song') {
        clearInterval(poll)
        resolve(undefined)
      } else if (Date.now() - start > 2000) {
        clearInterval(poll)
        reject(new Error(`timed out waiting for mixer title, last seen: ${title}`))
      }
    }, 10)
  })

  const exportButton = document.querySelector('.mixer-export-stems')
  if (exportButton === null) throw new Error('export-stems button not found')
  flushSync(() => (exportButton as HTMLButtonElement).click())

  await new Promise((resolve, reject) => {
    const start = Date.now()
    const poll = setInterval(() => {
      const title = document.querySelector('.export-track-title')?.textContent
      if (title?.startsWith('Only Song') === true) {
        clearInterval(poll)
        resolve(undefined)
      } else if (Date.now() - start > 2000) {
        clearInterval(poll)
        reject(new Error(`timed out waiting for export title, last seen: ${title}`))
      }
    }, 10)
  })

  expect(document.querySelector('.export-track-title')?.textContent).toContain('Solo Artist')
})
