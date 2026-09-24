import { afterEach, expect, test, vi } from 'vitest'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { page } from 'vitest/browser'
import { InMemoryCatalog } from '../../../tests/fakes/in-memory-catalog'
import { InMemoryStemStore } from '../../../tests/fakes/in-memory-stem-store'
import { readZip } from '../../../tests/support/independent-zip-reader'
import { encodeFloat32Wav } from '../../domain/audio/float32-wav'
import { BASIC_PROFILE, ROCK_PROFILE } from '../../domain/stem-profile'
import type { Track } from '../../domain/track'
import { formatBytes } from '../format/format-bytes'
import { ExportPage, type ExportPageDeps } from './ExportPage'
import '../tokens.css'

let root: Root
afterEach(() => root.unmount())

const SAMPLE_RATE = 44_100
const FRAME_COUNT = 512

function laneChannel(base: number): Float32Array {
  return Float32Array.from({ length: FRAME_COUNT }, (_unused, index) => base + index / (FRAME_COUNT * 20))
}

function baseTrack(overrides: Partial<Track> = {}): Track {
  return {
    trackId: 'track-1',
    title: 'Komorebi Master Mix',
    artist: 'Yui',
    genre: null,
    durationSeconds: 12,
    bpm: null,
    musicalKey: null,
    createdAtUtc: '2026-09-22T00:00:00.000Z',
    profileId: BASIC_PROFILE.profileId,
    pipelineFingerprint: 'fp',
    resultKey: 'stems/track-1',
    sourceHash: 'hash-1',
    status: 'ready',
    errorDetail: null,
    ...overrides,
  }
}

interface TestDeps {
  readonly deps: ExportPageDeps
  readonly catalog: InMemoryCatalog
  readonly stemStore: InMemoryStemStore
}

async function buildDeps(track: Track, profile = BASIC_PROFILE): Promise<TestDeps> {
  const catalog = new InMemoryCatalog()
  const stemStore = new InMemoryStemStore()
  await catalog.insert(track)

  for (const [index, lane] of profile.lanes.entries()) {
    const channel = laneChannel(0.01 * (index + 1))
    const bytes = encodeFloat32Wav({ sampleRate: SAMPLE_RATE, planar: [channel, channel] })
    await stemStore.writeLane(track.resultKey, lane.laneId, bytes)
  }

  return { deps: { catalog, stemStore }, catalog, stemStore }
}

function renderExportPage(testDeps: TestDeps, trackId = 'track-1'): { onBackToMixer: number } {
  const calls = { onBackToMixer: 0 }
  const container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
  flushSync(() => root.render(
    <ExportPage
      deps={testDeps.deps}
      trackId={trackId}
      onBackToMixer={() => { calls.onBackToMixer += 1 }}
    />,
  ))
  return calls
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function rowsRendered(): NodeListOf<Element> {
  return document.querySelectorAll('.export-stem-row')
}

function clickButton(selector: string): void {
  const button = document.querySelector<HTMLButtonElement>(selector)
  if (button === null) throw new Error(`button not found: ${selector}`)
  flushSync(() => button.click())
}

function clickCheckbox(selector: string): void {
  const checkbox = document.querySelector<HTMLInputElement>(selector)
  if (checkbox === null) throw new Error(`checkbox not found: ${selector}`)
  flushSync(() => checkbox.click())
}

/**
 * Spies on `URL.createObjectURL` to capture every Blob a triggered
 * `<a download>` actually carries, since a headless test can't observe a
 * completed OS-level file download — this is the standard technique for
 * asserting on `<a download>` payloads without one. Real bytes, from a real
 * Blob the component really constructed and would have handed the browser.
 */
function spyCreateObjectURL(): { blobs: Blob[]; restore: () => void } {
  const blobs: Blob[] = []
  const original = URL.createObjectURL.bind(URL)
  URL.createObjectURL = ((blob: Blob) => {
    blobs.push(blob)
    return original(blob)
  }) as typeof URL.createObjectURL
  return { blobs, restore: () => { URL.createObjectURL = original } }
}

test('renders the stem checklist with the fetched per-row copy format and the summary line', async () => {
  const testDeps = await buildDeps(baseTrack())
  renderExportPage(testDeps)
  await waitFor(() => rowsRendered().length === BASIC_PROFILE.lanes.length)

  const vocalsRow = document.querySelector('.export-stem-row[data-lane-id="vocals"]')
  const expectedBytes = await testDeps.stemStore.readLane('stems/track-1', 'vocals')
  expect(vocalsRow?.querySelector('.export-stem-name')?.textContent).toBe('Vocals')
  expect(vocalsRow?.querySelector('.export-stem-spec')?.textContent).toBe(
    `${formatBytes(expectedBytes.length)} · WAV 32-bit float · 44.1 kHz`,
  )

  expect(document.querySelector('.export-summary')?.textContent).toBe(
    `${BASIC_PROFILE.lanes.length} files · ${formatBytes(expectedBytes.length * BASIC_PROFILE.lanes.length)}`,
  )
  expect(document.querySelector('.export-track-meta')?.textContent).toBe(
    `Komorebi Master Mix · Yui · 0:12 · ${BASIC_PROFILE.displayName.toUpperCase()} · ${BASIC_PROFILE.lanes.length} STEMS`,
  )
})

test('separates Export title, real track metadata, and browser-storage panel', async () => {
  const testDeps = await buildDeps(baseTrack())
  renderExportPage(testDeps)
  await waitFor(() => rowsRendered().length === BASIC_PROFILE.lanes.length)

  expect(document.querySelector('.export-track-title')?.textContent).toBe('Export stems')
  expect(document.querySelector('.export-track-meta')?.textContent).toContain('Komorebi Master Mix · Yui · 0:12')
  expect(document.querySelector('.export-storage-panel h2')?.textContent).toBe('Browser storage')
  expect(getComputedStyle(document.querySelector('.export-content-grid')!).display).toBe('grid')
  expect(document.querySelector('.export-download-zip')?.textContent).toBe(
    `Download ZIP · ${formatBytes((await testDeps.stemStore.readLane('stems/track-1', 'vocals')).length * BASIC_PROFILE.lanes.length)}`,
  )
})

test('Export expands across a maximized workspace and preserves compact stacking', async () => {
  await page.viewport(1920, 1000)
  const testDeps = await buildDeps(baseTrack())
  renderExportPage(testDeps)
  await waitFor(() => rowsRendered().length === BASIC_PROFILE.lanes.length)

  const exportPage = document.querySelector<HTMLElement>('.export-page')
  const contentGrid = document.querySelector<HTMLElement>('.export-content-grid')
  if (exportPage === null || contentGrid === null) throw new Error('export layout not found')
  expect(exportPage.getBoundingClientRect().width).toBeGreaterThan(1800)
  expect(getComputedStyle(contentGrid).gridTemplateColumns.split(' ')).toHaveLength(2)

  await page.viewport(700, 900)
  expect(getComputedStyle(contentGrid).gridTemplateColumns.split(' ')).toHaveLength(1)
})

test('unchecking a lane excludes it from both "Download selected" and the ZIP', async () => {
  const testDeps = await buildDeps(baseTrack())
  renderExportPage(testDeps)
  await waitFor(() => rowsRendered().length === BASIC_PROFILE.lanes.length)

  clickCheckbox('.export-stem-row[data-lane-id="drums"] .export-stem-checkbox')
  await waitFor(() => document.querySelector('.export-summary')?.textContent?.startsWith('3 files') === true)

  const spy = spyCreateObjectURL()
  try {
    clickButton('.export-download-selected')
    expect(spy.blobs).toHaveLength(3) // every lane except drums
    const downloadedLaneCount = spy.blobs.length
    expect(downloadedLaneCount).toBe(BASIC_PROFILE.lanes.length - 1)

    spy.blobs.length = 0
    clickButton('.export-download-zip')
    expect(spy.blobs).toHaveLength(1)
    const zipBytes = new Uint8Array(await spy.blobs[0].arrayBuffer())
    const entries = readZip(zipBytes)
    expect(entries.map((entry) => entry.fileName).sort()).toEqual(
      BASIC_PROFILE.lanes
        .filter((lane) => lane.laneId !== 'drums')
        .map((lane) => `Komorebi Master Mix-${lane.laneId}.wav`)
        .sort(),
    )
  } finally {
    spy.restore()
  }
})

test('the ZIP built from real stems, parsed back, is byte-identical to what is in the stem store', async () => {
  const testDeps = await buildDeps(baseTrack({ profileId: ROCK_PROFILE.profileId, resultKey: 'stems/track-1' }), ROCK_PROFILE)
  renderExportPage(testDeps)
  await waitFor(() => rowsRendered().length === ROCK_PROFILE.lanes.length)

  const spy = spyCreateObjectURL()
  try {
    clickButton('.export-download-zip')
    expect(spy.blobs).toHaveLength(1)
    const zipBytes = new Uint8Array(await spy.blobs[0].arrayBuffer())
    const entries = readZip(zipBytes)
    expect(entries).toHaveLength(ROCK_PROFILE.lanes.length)

    for (const lane of ROCK_PROFILE.lanes) {
      const expectedBytes = await testDeps.stemStore.readLane('stems/track-1', lane.laneId)
      const entry = entries.find((candidate) => candidate.fileName === `Komorebi Master Mix-${lane.laneId}.wav`)
      expect(entry).toBeDefined()
      expect(Array.from(entry!.bytes)).toEqual(Array.from(expectedBytes))
    }
  } finally {
    spy.restore()
  }
})

test('"Download selected" downloads real, byte-identical bytes per checked lane', async () => {
  const testDeps = await buildDeps(baseTrack())
  renderExportPage(testDeps)
  await waitFor(() => rowsRendered().length === BASIC_PROFILE.lanes.length)

  const spy = spyCreateObjectURL()
  try {
    clickButton('.export-download-selected')
    expect(spy.blobs).toHaveLength(BASIC_PROFILE.lanes.length)
    for (const [index, lane] of BASIC_PROFILE.lanes.entries()) {
      const expectedBytes = await testDeps.stemStore.readLane('stems/track-1', lane.laneId)
      const downloaded = new Uint8Array(await spy.blobs[index].arrayBuffer())
      expect(Array.from(downloaded)).toEqual(Array.from(expectedBytes))
    }
  } finally {
    spy.restore()
  }
})

test('a failed lane is omitted from the visible checklist and both download actions', async () => {
  const testDeps = await buildDeps(baseTrack())
  const vocals = await testDeps.stemStore.readLane('stems/track-1', 'vocals')
  const bass = await testDeps.stemStore.readLane('stems/track-1', 'bass')
  await testDeps.stemStore.delete('stems/track-1')
  await testDeps.stemStore.writeLane('stems/track-1', 'vocals', vocals)
  await testDeps.stemStore.writeLane('stems/track-1', 'bass', bass)

  renderExportPage(testDeps)
  await waitFor(() => rowsRendered().length === 2)
  expect(Array.from(rowsRendered(), (row) => row.getAttribute('data-lane-id'))).toEqual(['vocals', 'bass'])
  expect(document.querySelectorAll('.export-stem-checkbox:checked')).toHaveLength(2)
  expect(document.querySelector('.export-summary')?.textContent).toBe(`2 files · ${formatBytes(vocals.length + bass.length)}`)

  const spy = spyCreateObjectURL()
  try {
    clickButton('.export-download-selected')
    expect(spy.blobs).toHaveLength(2)
    expect(new Uint8Array(await spy.blobs[0].arrayBuffer())).toEqual(vocals)
    expect(new Uint8Array(await spy.blobs[1].arrayBuffer())).toEqual(bass)

    spy.blobs.length = 0
    clickButton('.export-download-zip')
    expect(spy.blobs).toHaveLength(1)
    const zipEntries = readZip(new Uint8Array(await spy.blobs[0].arrayBuffer()))
    expect(zipEntries.map(({ fileName, bytes }) => ({ fileName, bytes }))).toEqual([
      { fileName: 'Komorebi Master Mix-vocals.wav', bytes: vocals },
      { fileName: 'Komorebi Master Mix-bass.wav', bytes: bass },
    ])
  } finally {
    spy.restore()
  }
})

test('"What you get" card and the storage notice show the exact fetched copy', async () => {
  const testDeps = await buildDeps(baseTrack())
  renderExportPage(testDeps)
  await waitFor(() => rowsRendered().length === BASIC_PROFILE.lanes.length)

  const card = document.querySelector('.export-what-you-get')
  expect(card?.querySelectorAll('p')[0]?.textContent).toBe('Exactly the stems the separator produced, byte for byte.')
  expect(card?.querySelectorAll('p')[1]?.textContent).toBe('Same sample rate and length as the source.')
  expect(card?.querySelector('.export-naming-pattern')?.textContent).toBe('<track> - <stem>.wav')

  expect(document.querySelector('.export-storage-notice')?.textContent).toBe(
    'These stems live only in this browser. Safari deletes site data after 7 days without a visit; '
    + 'other browsers may evict it under disk pressure. Download what you want to keep.',
  )
})

test('"Select all" defaults to checked, unchecks every lane, and re-checks them all', async () => {
  const testDeps = await buildDeps(baseTrack())
  renderExportPage(testDeps)
  await waitFor(() => rowsRendered().length === BASIC_PROFILE.lanes.length)

  const selectAll = document.querySelector<HTMLInputElement>('.export-select-all-checkbox')
  if (selectAll === null) throw new Error('select-all checkbox not found')
  expect(selectAll.checked).toBe(true)
  expect(document.querySelectorAll('.export-stem-checkbox:checked')).toHaveLength(BASIC_PROFILE.lanes.length)

  clickCheckbox('.export-select-all-checkbox')
  expect(document.querySelectorAll('.export-stem-checkbox:checked')).toHaveLength(0)
  expect(document.querySelector('.export-summary')?.textContent).toMatch(/^0 files/)

  clickCheckbox('.export-select-all-checkbox')
  expect(document.querySelectorAll('.export-stem-checkbox:checked')).toHaveLength(BASIC_PROFILE.lanes.length)
})

test('"Back to mixer" only navigates', async () => {
  const testDeps = await buildDeps(baseTrack())
  const calls = renderExportPage(testDeps)
  await waitFor(() => rowsRendered().length === BASIC_PROFILE.lanes.length)

  clickButton('.export-back-to-mixer')
  expect(calls.onBackToMixer).toBe(1)
})

test('an unknown track refuses cleanly with no stem list and no throw', async () => {
  const catalog = new InMemoryCatalog()
  const stemStore = new InMemoryStemStore()
  renderExportPage({ deps: { catalog, stemStore }, catalog, stemStore }, 'missing-track')

  await waitFor(() => document.querySelector('.export-load-error') !== null)
  expect(rowsRendered()).toHaveLength(0)
})

test('a rejected catalog read exits loading and shows the existing error alert', async () => {
  const testDeps = await buildDeps(baseTrack())
  vi.spyOn(testDeps.catalog, 'getById').mockRejectedValue(new Error('catalog unavailable'))
  renderExportPage(testDeps)

  await waitFor(() => document.querySelector('.export-load-error') !== null)
  expect(document.querySelector('.export-loading')).toBeNull()
  expect(rowsRendered()).toHaveLength(0)
})

test('a rejected stale load cannot replace a newer track', async () => {
  const testDeps = await buildDeps(baseTrack())
  const newerTrack = baseTrack({ trackId: 'track-2', title: 'Newer Mix' })
  await testDeps.catalog.insert(newerTrack)
  const getById = testDeps.catalog.getById.bind(testDeps.catalog)
  let rejectOldLoad: (reason: Error) => void = () => { throw new Error('old load did not start') }
  const oldLoad = new Promise<Track | undefined>((_resolve, reject) => { rejectOldLoad = reject })
  vi.spyOn(testDeps.catalog, 'getById').mockImplementation((id) => (
    id === 'track-1' ? oldLoad : getById(id)
  ))

  renderExportPage(testDeps)
  flushSync(() => root.render(
    <ExportPage deps={testDeps.deps} trackId="track-2" onBackToMixer={() => {}} />,
  ))
  await waitFor(() => document.querySelector('.export-track-meta')?.textContent?.includes('Newer Mix') === true)

  rejectOldLoad(new Error('old catalog unavailable'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(document.querySelector('.export-track-meta')?.textContent).toContain('Newer Mix')
  expect(document.querySelector('.export-load-error')).toBeNull()
  expect(document.querySelector('.export-loading')).toBeNull()
})
