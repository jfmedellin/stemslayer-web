import { afterEach, expect, test } from 'vitest'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import {
  buildFakeAppDependencies,
  settleStartupSweep,
  type FakeAppDependencies,
} from '../../tests/fakes/build-fake-app-dependencies'
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
