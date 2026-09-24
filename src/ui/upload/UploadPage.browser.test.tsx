import { afterEach, expect, test, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { expectedLaneKeys } from '../../application/separation-lane-keys'
import { BASIC_PROFILE, ROCK_PROFILE } from '../../domain/stem-profile'
import { buildFakeAppDependencies, type FakeAppDependencies } from '../../../tests/fakes/build-fake-app-dependencies'
import { UploadPage } from './UploadPage'
import '../tokens.css'

let root: Root
let container: HTMLDivElement
afterEach(() => root.unmount())

function buildWavFile(name: string, durationSeconds: number): File {
  const sampleRate = 44_100
  const channels = 2
  const bitsPerSample = 16
  const frameCount = Math.round(durationSeconds * sampleRate)
  const dataSize = frameCount * channels * (bitsPerSample / 8)
  const bytes = new Uint8Array(44 + dataSize)
  const view = new DataView(bytes.buffer)
  bytes.set([0x52, 0x49, 0x46, 0x46], 0) // "RIFF"
  view.setUint32(4, 36 + dataSize, true)
  bytes.set([0x57, 0x41, 0x56, 0x45], 8) // "WAVE"
  bytes.set([0x66, 0x6d, 0x74, 0x20], 12) // "fmt "
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true)
  view.setUint16(32, channels * (bitsPerSample / 8), true)
  view.setUint16(34, bitsPerSample, true)
  bytes.set([0x64, 0x61, 0x74, 0x61], 36) // "data"
  view.setUint32(40, dataSize, true)
  return new File([bytes], name, { type: 'audio/wav' })
}

function dropFiles(zone: Element, files: readonly File[]): void {
  const dataTransfer = new DataTransfer()
  for (const file of files) dataTransfer.items.add(file)
  zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
  zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
}

function chooseFilesViaInput(input: HTMLInputElement, files: readonly File[]): void {
  const dataTransfer = new DataTransfer()
  for (const file of files) dataTransfer.items.add(file)
  Object.defineProperty(input, 'files', { value: dataTransfer.files, configurable: true })
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function buildDeps(availableBytes: number): FakeAppDependencies {
  const fake = buildFakeAppDependencies({ availableBytes, gpu: {} })
  fake.modelStore.setFootprint(BASIC_PROFILE.profileId, { cached: true, sizeBytes: 174_266_088 })
  fake.modelStore.setFootprint(ROCK_PROFILE.profileId, { cached: true, sizeBytes: 284_797_240 })
  return fake
}

async function renderUploadPage(availableBytes = 10_000_000_000): Promise<{ testDeps: FakeAppDependencies }> {
  const testDeps = buildDeps(availableBytes)
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
  flushSync(() => root.render(
    <UploadPage
      deps={testDeps.deps.addToLibraryDeps}
      navigatorRef={testDeps.deps.navigatorRef}
      queue={testDeps.deps.separationQueue}
    />,
  ))
  // Let the initial quota/footprint effects settle.
  await new Promise((resolve) => setTimeout(resolve, 0))
  return { testDeps }
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('dropping one file reaches the profile-choice / primary-action state', async () => {
  await renderUploadPage()
  const zone = document.querySelector('.drop-zone')
  if (zone === null) throw new Error('drop zone not found')

  dropFiles(zone, [buildWavFile('Komorebi_Master_Mix.wav', 4)])
  await waitFor(() => document.querySelector('.file-card') !== null)

  expect(document.querySelector('.file-card-name')?.textContent).toBe('Komorebi_Master_Mix.wav')
  expect(document.querySelectorAll('.profile-card')).toHaveLength(2)
  const rockCard = document.querySelector('.profile-card[aria-pressed="true"] .profile-card-name')
  expect(rockCard?.textContent).toBe('Rock')

  const primaryButton = document.querySelector<HTMLButtonElement>('.primary-action')
  expect(primaryButton?.disabled).toBe(false)
  expect(primaryButton?.textContent).toBe('Separate · Rock · 6 stems')
})

test('dropping extra files together with the first ignores the extras and shows a message', async () => {
  await renderUploadPage()
  const zone = document.querySelector('.drop-zone')
  if (zone === null) throw new Error('drop zone not found')

  dropFiles(zone, [buildWavFile('first.wav', 2), buildWavFile('second.wav', 2)])
  await waitFor(() => document.querySelector('.file-card') !== null)

  expect(document.querySelector('.file-card-name')?.textContent).toBe('first.wav')
  expect(document.querySelector('.drop-zone-rejection')?.textContent).toMatch(/one file at a time|only the first/i)
})

test('choosing a file through the browse input loads it the same way as a drop', async () => {
  await renderUploadPage()
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (input === null) throw new Error('file input not found')

  chooseFilesViaInput(input, [buildWavFile('browsed.wav', 3)])
  await waitFor(() => document.querySelector('.file-card') !== null)

  expect(document.querySelector('.file-card-name')?.textContent).toBe('browsed.wav')
})

test('the browse input is outside the interactive drop zone while keyboard browse remains available', async () => {
  await renderUploadPage()
  const zone = document.querySelector<HTMLElement>('.drop-zone')
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (zone === null || input === null) throw new Error('drop zone or file input not found')

  expect(zone.contains(input)).toBe(false)
  const open = vi.spyOn(input, 'click').mockImplementation(() => undefined)
  zone.focus()
  await userEvent.keyboard('{Enter}')
  await userEvent.keyboard(' ')
  zone.click()
  expect(open).toHaveBeenCalledTimes(3)
  open.mockRestore()
})

test('the drop zone accessible name includes the visible file constraints', async () => {
  await renderUploadPage()
  expect(page.getByRole('button', {
    name: /Drop one audio file or browse.*WAV, MP3, FLAC, OGG, M4A.*one file at a time/i,
  }).length).toBe(1)
})

test('the selected-file state keeps the browse drop zone above the file card', async () => {
  await renderUploadPage()
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (input === null) throw new Error('file input not found')
  chooseFilesViaInput(input, [buildWavFile('selected.wav', 2)])
  await waitFor(() => document.querySelector('.file-card') !== null)

  const page = document.querySelector('.upload-page')
  const zone = page?.querySelector('.drop-zone')
  const card = page?.querySelector('.file-card')
  expect(zone).not.toBeNull()
  expect(card).not.toBeNull()
  expect(zone!.compareDocumentPosition(card!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(getComputedStyle(page!.querySelector('.primary-action')!).alignSelf).toBe('center')
})

test('selecting the Basic profile updates the primary action label and pressed state', async () => {
  await renderUploadPage()
  const zone = document.querySelector('.drop-zone')
  if (zone === null) throw new Error('drop zone not found')
  dropFiles(zone, [buildWavFile('song.wav', 4)])
  await waitFor(() => document.querySelector('.file-card') !== null)

  const basicCard = [...document.querySelectorAll('.profile-card')]
    .find((card) => card.querySelector('.profile-card-name')?.textContent === 'Basic')
  if (basicCard === undefined) throw new Error('Basic profile card not found')
  ;(basicCard as HTMLButtonElement).click()

  await waitFor(() => document.querySelector('.primary-action')?.textContent === 'Separate · Basic · 4 stems')
  expect(basicCard.getAttribute('aria-pressed')).toBe('true')
})

test('the primary action calls addToLibrary with the selected profile and shows a queued state on claim', async () => {
  const { testDeps } = await renderUploadPage()
  const zone = document.querySelector('.drop-zone')
  if (zone === null) throw new Error('drop zone not found')
  dropFiles(zone, [buildWavFile('song.wav', 4)])
  await waitFor(() => document.querySelector('.file-card') !== null)

  document.querySelector<HTMLButtonElement>('.primary-action')?.click()

  await waitFor(() => document.querySelector('.submission-status') !== null)
  expect(document.querySelector('.submission-status')?.getAttribute('data-tone')).toBe('success')

  const rows = await testDeps.catalog.listAll()
  expect(rows).toHaveLength(1)
  expect(rows[0]?.profileId).toBe(ROCK_PROFILE.profileId)
})

test('a claimed decision actually enqueues a real job into the shared queue, which reaches ready', async () => {
  const { testDeps } = await renderUploadPage()
  const zone = document.querySelector('.drop-zone')
  if (zone === null) throw new Error('drop zone not found')
  dropFiles(zone, [buildWavFile('song.wav', 4)])
  await waitFor(() => document.querySelector('.file-card') !== null)

  // Deterministic first-generated id from buildFakeAppDependencies's counter.
  const trackId = 'track-0'
  const laneKeys = ROCK_PROFILE.lanes.map((lane) => `stems/${trackId}/${lane.laneId}`)
  testDeps.inference.scriptSuccess(trackId, laneKeys)

  document.querySelector<HTMLButtonElement>('.primary-action')?.click()
  await waitFor(() => document.querySelector('.submission-status') !== null)

  await waitFor(async () => (await testDeps.catalog.getById(trackId))?.status === 'ready')
  const track = await testDeps.catalog.getById(trackId)
  expect(track?.status).toBe('ready')
  expect(expectedLaneKeys(track!).every((key) => testDeps.stemStore.has(key))).toBe(true)
})

test('a quota-refused decision is shown inline instead of navigating away', async () => {
  const { testDeps } = await renderUploadPage(1_000)
  const zone = document.querySelector('.drop-zone')
  if (zone === null) throw new Error('drop zone not found')
  dropFiles(zone, [buildWavFile('song.wav', 4)])
  await waitFor(() => document.querySelector('.file-card') !== null)

  document.querySelector<HTMLButtonElement>('.primary-action')?.click()

  await waitFor(() => document.querySelector('.submission-status') !== null)
  const status = document.querySelector('.submission-status')
  expect(status?.getAttribute('data-tone')).toBe('refused')
  expect(status?.textContent).toMatch(/storage/i)
  // Never routed away: the file card and profile cards are still present.
  expect(document.querySelector('.file-card')).not.toBeNull()
  expect(await testDeps.catalog.listAll()).toHaveLength(0)
})
