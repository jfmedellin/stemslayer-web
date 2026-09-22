import { afterEach, expect, test } from 'vitest'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import type { SeparateProgressEvent } from '../../application/separate'
import { expectedLaneKeys } from '../../application/separation-lane-keys'
import type { Track } from '../../domain/track'
import {
  buildFakeAppDependencies,
  settleStartupSweep,
  type FakeAppDependencies,
} from '../../../tests/fakes/build-fake-app-dependencies'
import { FakeHash } from '../../../tests/fakes/fake-hash'
import { LibraryPage, type LibraryPageDeps } from './LibraryPage'

let root: Root
let container: HTMLDivElement
afterEach(() => root.unmount())

function baseTrack(overrides: Partial<Track>): Track {
  return {
    trackId: 'track-1',
    title: 'Komorebi Master Mix',
    artist: 'Yui',
    genre: null,
    durationSeconds: 240,
    bpm: null,
    musicalKey: null,
    createdAtUtc: '2026-09-22T00:00:00.000Z',
    profileId: 'metal-stereo-six-stem',
    pipelineFingerprint: 'fp',
    resultKey: `stems/${overrides.trackId ?? 'track-1'}`,
    sourceHash: 'hash-1',
    status: 'ready',
    errorDetail: null,
    ...overrides,
  }
}

// Most tests want a settled app (its one startup sweep already done, as it
// always is by the time a real user could interact) before their own
// fixtures exist, so those fixtures are never mistaken for sweep targets.
async function buildSettledDeps(): Promise<FakeAppDependencies> {
  const testDeps = buildFakeAppDependencies()
  await settleStartupSweep(testDeps)
  return testDeps
}

function libraryDepsOf(testDeps: FakeAppDependencies): LibraryPageDeps {
  return {
    catalog: testDeps.deps.addToLibraryDeps.catalog,
    stemStore: testDeps.deps.stemStore,
    hash: testDeps.deps.addToLibraryDeps.hash,
    lock: testDeps.deps.addToLibraryDeps.lock,
  }
}

/**
 * Renders `LibraryPage` wired the same way `App.tsx` wires it: subscribed to
 * the shared queue's `progressHub` so a real enqueued job's live progress
 * re-renders the page, exactly as it would from the real composition root.
 */
function renderLibrary(testDeps: FakeAppDependencies): { mixerRequests: number; exportedTrackId: string | null } {
  const state: { mixerRequests: number; exportedTrackId: string | null } = { mixerRequests: 0, exportedTrackId: null }
  let progressByTrackId: Record<string, SeparateProgressEvent> = {}
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)

  function draw(): void {
    flushSync(() => root.render(
      <LibraryPage
        deps={libraryDepsOf(testDeps)}
        queue={testDeps.deps.separationQueue}
        progressByTrackId={progressByTrackId}
        onOpenInMixer={() => { state.mixerRequests += 1 }}
        onExport={(trackId) => { state.exportedTrackId = trackId }}
        startupSweepGuard={testDeps.deps.startupSweepGuard}
      />,
    ))
  }

  testDeps.deps.progressHub.subscribe((trackId, event) => {
    progressByTrackId = { ...progressByTrackId, [trackId]: event }
    draw()
  })
  draw()
  return state
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function rowFor(trackId: string): HTMLElement | null {
  return document.querySelector(`.track-row[data-track-id="${trackId}"]`)
}

function clickButton(scope: Element | Document, selector: string): void {
  const button = scope.querySelector<HTMLButtonElement>(selector)
  if (button === null) throw new Error(`button not found: ${selector}`)
  flushSync(() => button.click())
}

test('renders all six row statuses with their designed copy and actions', async () => {
  const testDeps = await buildSettledDeps()
  await testDeps.catalog.insert(baseTrack({ trackId: 'ready-1', status: 'ready' }))
  await testDeps.catalog.insert(baseTrack({ trackId: 'preparing-1', status: 'preparing', errorDetail: null }))
  await testDeps.catalog.insert(baseTrack({ trackId: 'processing-1', status: 'processing' }))
  await testDeps.catalog.insert(baseTrack({
    trackId: 'failed-1', status: 'failed', errorDetail: 'onnx-worker-inference.failed:boom Retry from the original audio.',
  }))
  await testDeps.catalog.insert(baseTrack({ trackId: 'interrupted-1', status: 'interrupted', errorDetail: 'job.cancelled …' }))
  await testDeps.catalog.insert(baseTrack({ trackId: 'unavailable-1', status: 'unavailable', errorDetail: 'Stored stems are unavailable: … ' }))

  renderLibrary(testDeps)
  await waitFor(() => document.querySelectorAll('.track-row').length === 6)

  const ready = rowFor('ready-1')
  expect(ready?.querySelector('.track-row-status')?.textContent).toBe('Ready')
  expect(ready?.querySelector('.track-row-open-mixer')).not.toBeNull()
  expect(ready?.querySelector('.track-row-export')).not.toBeNull()
  expect(ready?.querySelector('.track-row-cancel')).toBeNull()
  expect(ready?.querySelector('.track-row-retry')).toBeNull()

  const preparing = rowFor('preparing-1')
  expect(preparing?.querySelector('.track-row-status')?.textContent).toBe('Queued for separation.')
  expect(preparing?.querySelector('.track-row-cancel')).not.toBeNull()

  const processing = rowFor('processing-1')
  expect(processing?.querySelector('.track-row-status')?.textContent).toBe('Separating…')
  expect(processing?.querySelector('.track-row-cancel')).not.toBeNull()

  const failed = rowFor('failed-1')
  expect(failed?.querySelector('.track-row-status')?.textContent)
    .toBe('onnx-worker-inference.failed:boom Retry from the original audio.')
  expect(failed?.querySelector('.track-row-retry')).not.toBeNull()
  expect(failed?.querySelector('.track-row-remove')).not.toBeNull()

  const interrupted = rowFor('interrupted-1')
  expect(interrupted?.querySelector('.track-row-status')?.textContent).toBe('Cancelled before it finished.')
  expect(interrupted?.querySelector('.track-row-retry')).not.toBeNull()

  const unavailable = rowFor('unavailable-1')
  expect(unavailable?.querySelector('.track-row-status')?.textContent)
    .toBe('Stems were removed by the browser. Separate again from the original file.')
  expect(unavailable?.querySelector('.track-row-retry')).not.toBeNull()
})

test('processing/preparing rows reflect live queue progress', async () => {
  const testDeps = await buildSettledDeps()
  await testDeps.catalog.insert(baseTrack({ trackId: 'preparing-1', status: 'preparing' }))
  await testDeps.catalog.insert(baseTrack({ trackId: 'processing-1', status: 'processing' }))

  renderLibrary(testDeps)
  await waitFor(() => document.querySelectorAll('.track-row').length === 2)

  flushSync(() => testDeps.deps.progressHub.emit('preparing-1', { phase: 'preparing', detail: 'Preparing Rock: 73%' }))
  flushSync(() => testDeps.deps.progressHub.emit('processing-1', { phase: 'processing', window: 2, totalWindows: 8 }))

  expect(rowFor('preparing-1')?.querySelector('.track-row-status')?.textContent).toBe('Preparing Rock: 73%')
  expect(rowFor('processing-1')?.querySelector('.track-row-status')?.textContent)
    .toBe('Separating · window 2 of 8 · 25%')
})

test('search filters client-side by title/artist substring', async () => {
  const testDeps = await buildSettledDeps()
  await testDeps.catalog.insert(baseTrack({ trackId: 'a', title: 'Komorebi Master Mix', artist: 'Yui' }))
  await testDeps.catalog.insert(baseTrack({ trackId: 'b', title: 'Second Song', artist: 'Ren' }))

  renderLibrary(testDeps)
  await waitFor(() => document.querySelectorAll('.track-row').length === 2)

  const search = document.querySelector<HTMLInputElement>('.library-search')
  if (search === null) throw new Error('search box not found')
  // React tracks a controlled input's "last known value" internally; a plain
  // `search.value = …` assignment bypasses that tracker, so the synthetic
  // `onChange` never fires. Go through the native setter, matching the
  // standard React-without-RTL workaround.
  const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  flushSync(() => {
    nativeValueSetter?.call(search, 'ren')
    search.dispatchEvent(new Event('input', { bubbles: true }))
  })

  expect(document.querySelectorAll('.track-row')).toHaveLength(1)
  expect(rowFor('b')).not.toBeNull()
})

test('the three sorts reorder rows correctly', async () => {
  const testDeps = await buildSettledDeps()
  await testDeps.catalog.insert(baseTrack({
    trackId: 'old', title: 'Banana', durationSeconds: 300, createdAtUtc: '2026-01-01T00:00:00.000Z',
  }))
  await testDeps.catalog.insert(baseTrack({
    trackId: 'new', title: 'Apple', durationSeconds: 30, createdAtUtc: '2026-06-01T00:00:00.000Z',
  }))

  renderLibrary(testDeps)
  await waitFor(() => document.querySelectorAll('.track-row').length === 2)

  function orderedIds(): string[] {
    return [...document.querySelectorAll('.track-row')].map((row) => row.getAttribute('data-track-id') ?? '')
  }

  expect(orderedIds()).toEqual(['new', 'old']) // newest default

  const sort = document.querySelector<HTMLSelectElement>('.library-sort')
  if (sort === null) throw new Error('sort control not found')

  flushSync(() => {
    sort.value = 'title'
    sort.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(orderedIds()).toEqual(['new', 'old']) // Apple < Banana

  flushSync(() => {
    sort.value = 'duration'
    sort.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(orderedIds()).toEqual(['new', 'old']) // 30 < 300
})

test('cancel shows the exact confirm-dialog copy and only cancels on "Cancel job"', async () => {
  const testDeps = await buildSettledDeps()
  const track = baseTrack({ trackId: 'preparing-1', status: 'preparing' })
  await testDeps.catalog.insert(track)
  // A real pending/running job in the queue, the way UploadPage's fix actually enqueues one.
  testDeps.deps.separationQueue.enqueue('preparing-1', new Uint8Array([1, 2, 3]))

  renderLibrary(testDeps)
  await waitFor(() => document.querySelectorAll('.track-row').length === 1)

  clickButton(document, '.track-row-cancel')
  expect(document.querySelector('.cancel-confirm-dialog h2')?.textContent).toBe('Cancel this separation?')
  expect(document.querySelector('.cancel-confirm-dialog p')?.textContent).toBe(
    'This stops the job right now. The work in progress is lost and cannot be resumed.',
  )

  clickButton(document, '.dialog-secondary') // "Keep running"
  expect(document.querySelector('.cancel-confirm-dialog')).toBeNull()
  // Not cancelled: still actively preparing/processing (the fake inference
  // hangs unscripted), never interrupted, by "Keep running" alone.
  expect((await testDeps.catalog.getById('preparing-1'))?.status).not.toBe('interrupted')

  clickButton(document, '.track-row-cancel')
  clickButton(document, '.dialog-primary') // "Cancel job"

  await waitFor(async () => (await testDeps.catalog.getById('preparing-1'))?.status === 'interrupted')
})

test('retry re-prompts for the file, then retries and enqueues into the shared queue, reaching ready', async () => {
  const testDeps = await buildSettledDeps()
  const bytes = new Uint8Array([9, 9, 9, 9])
  const sourceHash = await new FakeHash().sha256(bytes)
  const track = baseTrack({
    trackId: 'failed-1', status: 'failed', errorDetail: 'boom Retry from the original audio.', sourceHash,
  })
  await testDeps.catalog.insert(track)

  const laneKeys = expectedLaneKeys(track)
  testDeps.inference.scriptSuccess('failed-1', laneKeys)

  renderLibrary(testDeps)
  await waitFor(() => document.querySelectorAll('.track-row').length === 1)

  clickButton(document, '.track-row-retry')
  const input = document.querySelector<HTMLInputElement>('.retry-reupload-input')
  if (input === null) throw new Error('retry file input not found')

  const dataTransfer = new DataTransfer()
  dataTransfer.items.add(new File([bytes], 'song.wav', { type: 'audio/wav' }))
  Object.defineProperty(input, 'files', { value: dataTransfer.files, configurable: true })
  input.dispatchEvent(new Event('change', { bubbles: true }))

  await waitFor(async () => (await testDeps.catalog.getById('failed-1'))?.status === 'ready')
  expect(laneKeys.every((key) => testDeps.stemStore.has(key))).toBe(true)
})

test('retry shows the identity-owned refusal inline instead of silently failing', async () => {
  const testDeps = await buildSettledDeps()
  const ownerBytes = new Uint8Array([1, 1, 1])
  const ownerHash = await new FakeHash().sha256(ownerBytes)
  const owner = baseTrack({ trackId: 'owner-1', status: 'ready', sourceHash: ownerHash, resultKey: 'stems/owner-1' })
  const failedTrack = baseTrack({
    trackId: 'failed-1', status: 'failed', sourceHash: 'different-hash', resultKey: 'stems/failed-1',
  })
  await testDeps.catalog.insert(owner)
  await testDeps.catalog.insert(failedTrack)

  renderLibrary(testDeps)
  await waitFor(() => document.querySelectorAll('.track-row').length === 2)

  clickButton(rowFor('failed-1')!, '.track-row-retry')
  const input = rowFor('failed-1')!.querySelector<HTMLInputElement>('.retry-reupload-input')
  if (input === null) throw new Error('retry file input not found')
  const dataTransfer = new DataTransfer()
  dataTransfer.items.add(new File([ownerBytes], 'song.wav', { type: 'audio/wav' }))
  Object.defineProperty(input, 'files', { value: dataTransfer.files, configurable: true })
  input.dispatchEvent(new Event('change', { bubbles: true }))

  await waitFor(() => rowFor('failed-1')?.querySelector('.track-row-error') !== null)
  expect(rowFor('failed-1')?.querySelector('.track-row-error')?.textContent).toMatch(/owner-1/)
})

test('remove shows a destructive confirm first, then calls removeTrack and clears the row', async () => {
  const testDeps = await buildSettledDeps()
  await testDeps.catalog.insert(baseTrack({ trackId: 'failed-1', status: 'failed' }))

  renderLibrary(testDeps)
  await waitFor(() => document.querySelectorAll('.track-row').length === 1)

  clickButton(document, '.track-row-remove')
  expect(document.querySelector('.remove-confirm-dialog h2')?.textContent).toBe('Remove this track?')

  clickButton(document, '.dialog-secondary') // "Keep track"
  expect(document.querySelector('.remove-confirm-dialog')).toBeNull()
  expect(await testDeps.catalog.getById('failed-1')).not.toBeUndefined()

  clickButton(document, '.track-row-remove')
  clickButton(document, '.dialog-primary') // "Remove track"

  await waitFor(async () => (await testDeps.catalog.getById('failed-1')) === undefined)
})

test('remove reflects an unavailable refusal when the stem-store delete fails', async () => {
  const testDeps = await buildSettledDeps()
  const track = baseTrack({ trackId: 'failed-1', status: 'failed', resultKey: 'stems/failed-1' })
  await testDeps.catalog.insert(track)
  testDeps.stemStore.failNextDeleteFor('stems/failed-1')

  renderLibrary(testDeps)
  await waitFor(() => document.querySelectorAll('.track-row').length === 1)

  clickButton(document, '.track-row-remove')
  clickButton(document, '.dialog-primary')

  await waitFor(() => document.querySelector('.track-row-error') !== null)
  expect(document.querySelector('.track-row-error')?.textContent).toMatch(/could not remove/i)
  expect(await testDeps.catalog.getById('failed-1')).not.toBeUndefined()
})

test('runStartupSweeps runs once on mount before the first list read: a stale preparing row flips to interrupted', async () => {
  // Simulates a row genuinely left behind by a crashed *previous* session:
  // the sweep must not have run yet when this fixture is inserted.
  const testDeps = buildFakeAppDependencies({ autoStartupSweep: false })
  await testDeps.catalog.insert(baseTrack({ trackId: 'stale-1', status: 'preparing' }))

  renderLibrary(testDeps)
  await waitFor(() => rowFor('stale-1')?.getAttribute('data-status') === 'interrupted')
  expect(rowFor('stale-1')?.querySelector('.track-row-status')?.textContent).toBe('Cancelled before it finished.')
})

test('"Open in mixer" navigates only, no mixer UI rendered here', async () => {
  const testDeps = await buildSettledDeps()
  await testDeps.catalog.insert(baseTrack({ trackId: 'ready-1', status: 'ready' }))

  const state = renderLibrary(testDeps)
  await waitFor(() => document.querySelectorAll('.track-row').length === 1)

  clickButton(document, '.track-row-open-mixer')
  expect(state.mixerRequests).toBe(1)
})

test('"Export" carries the exact clicked row\'s trackId, not just a navigation signal', async () => {
  const testDeps = await buildSettledDeps()
  await testDeps.catalog.insert(baseTrack({ trackId: 'ready-a', status: 'ready' }))
  await testDeps.catalog.insert(baseTrack({ trackId: 'ready-b', status: 'ready' }))

  const state = renderLibrary(testDeps)
  await waitFor(() => document.querySelectorAll('.track-row').length === 2)

  clickButton(rowFor('ready-b')!, '.track-row-export')
  expect(state.exportedTrackId).toBe('ready-b')
})
