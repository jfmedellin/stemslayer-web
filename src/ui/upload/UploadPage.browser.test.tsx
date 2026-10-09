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
afterEach(() => {
  root.unmount()
  vi.unstubAllGlobals()
})

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

const MAX_SOURCE_BYTES = 100 * 1024 * 1024
const MAX_DURATION_SECONDS = 5 * 60

function buildControlledFile(
  name: string,
  size: number,
  durationSeconds: number | null,
): { readonly file: File; readonly arrayBuffer: ReturnType<typeof vi.spyOn> } {
  const file = new File([new Uint8Array([1, 2, 3, 4])], name)
  Object.defineProperty(file, 'size', { value: size })
  const arrayBuffer = vi.spyOn(file, 'arrayBuffer').mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer)
  vi.stubGlobal('AudioContext', class {
    async decodeAudioData(): Promise<{ duration: number }> {
      if (durationSeconds === null) throw new Error('decode failed')
      return { duration: durationSeconds }
    }

    async close(): Promise<void> {}
  })
  return { file, arrayBuffer }
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

test('accepts MP3 uploads', async () => {
  await renderUploadPage()
  const zone = document.querySelector('.drop-zone')
  if (zone === null) throw new Error('drop zone not found')
  const file = buildControlledFile('browsed.mp3', 4, 3)

  dropFiles(zone, [file.file])
  await waitFor(() => document.querySelector('.file-card-name')?.textContent === 'browsed.mp3')

  expect(file.arrayBuffer).toHaveBeenCalledOnce()
  expect(document.querySelector('.drop-zone-rejection')).toBeNull()
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
    name: /Drop one audio file or browse.*WAV or MP3.*one file at a time/i,
  }).length).toBe(1)
  expect(document.querySelector<HTMLInputElement>('input[type="file"]')?.accept).toBe('.wav,.mp3')
})

test.each([
  ['below', MAX_SOURCE_BYTES - 1, true],
  ['at', MAX_SOURCE_BYTES, true],
  ['above', MAX_SOURCE_BYTES + 1, false],
])('source byte limit accepts %s-boundary files and rejects above', async (_boundary, size, accepted) => {
  await renderUploadPage()
  const zone = document.querySelector('.drop-zone')
  if (zone === null) throw new Error('drop zone not found')
  const file = buildControlledFile('boundary.wav', size, 2)

  dropFiles(zone, [file.file])
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(file.arrayBuffer).toHaveBeenCalledTimes(accepted ? 1 : 0)
  expect(document.querySelector('.file-card') !== null).toBe(accepted)
  if (!accepted) expect(document.querySelector('.drop-zone-rejection')?.textContent).toMatch(/100 MiB/i)
})

test.each([
  ['below', MAX_DURATION_SECONDS - 1, true],
  ['at', MAX_DURATION_SECONDS, true],
  ['above', MAX_DURATION_SECONDS + 1, false],
])('duration limit accepts %s-boundary media and rejects above', async (_boundary, durationSeconds, accepted) => {
  await renderUploadPage()
  const zone = document.querySelector('.drop-zone')
  if (zone === null) throw new Error('drop zone not found')
  const file = buildControlledFile('duration.wav', 4, durationSeconds)

  dropFiles(zone, [file.file])
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(document.querySelector('.file-card') !== null).toBe(accepted)
  if (!accepted) expect(document.querySelector('.drop-zone-rejection')?.textContent).toMatch(/5 minutes/i)
})

test('loads a real five-minute WAV at the duration cap and keeps the upload UI responsive', async () => {
  await renderUploadPage()
  const zone = document.querySelector('.drop-zone')
  if (zone === null) throw new Error('drop zone not found')
  const file = buildWavFile('five-minute.wav', MAX_DURATION_SECONDS)
  const arrayBuffer = vi.spyOn(file, 'arrayBuffer')

  dropFiles(zone, [file])
  await waitFor(() => document.querySelector('.file-card-name')?.textContent === 'five-minute.wav', 10_000)

  expect(arrayBuffer).toHaveBeenCalledOnce()
  expect(document.querySelector('.file-card-details')?.textContent).toContain('5:00')
  expect(document.querySelector<HTMLButtonElement>('.primary-action')?.disabled).toBe(false)
  await userEvent.click(document.querySelector<HTMLButtonElement>('.profile-card')!)
  expect(document.querySelector('.profile-card[aria-pressed="true"] .profile-card-name')?.textContent).toBe('Basic')
})

test.each([
  ['unsupported.txt', 4, 2, /supported audio format/i],
  ['unsupported.flac', 4, 2, /supported audio format/i],
  ['empty.wav', 0, 2, /empty/i],
  ['malformed.wav', 4, null, /could not be decoded/i],
])('rejects unsupported, empty, or malformed input: %s', async (name, size, durationSeconds, message) => {
  await renderUploadPage()
  const zone = document.querySelector('.drop-zone')
  if (zone === null) throw new Error('drop zone not found')
  const file = buildControlledFile(name, size, durationSeconds)

  dropFiles(zone, [file.file])
  await waitFor(() => document.querySelector('.drop-zone-rejection') !== null
    || document.querySelector('.file-card') !== null)

  expect(file.arrayBuffer).toHaveBeenCalledTimes(
    name === 'unsupported.txt' || name === 'unsupported.flac' || size === 0 ? 0 : 1,
  )
  expect(document.querySelector('.drop-zone-rejection')?.textContent ?? '').toMatch(message)
  expect(document.querySelector('.file-card')).toBeNull()
})

test('rejects empty bytes returned by a non-empty file read', async () => {
  await renderUploadPage()
  const zone = document.querySelector('.drop-zone')
  if (zone === null) throw new Error('drop zone not found')
  const file = new File([new Uint8Array([1])], 'empty-content.wav')
  const read = vi.spyOn(file, 'arrayBuffer').mockResolvedValue(new ArrayBuffer(0))

  dropFiles(zone, [file])
  await waitFor(() => document.querySelector('.drop-zone-rejection') !== null)

  expect(read).toHaveBeenCalledTimes(1)
  expect(document.querySelector('.drop-zone-rejection')?.textContent).toMatch(/empty/i)
  expect(document.querySelector('.file-card')).toBeNull()
})

test('a later selection wins when an earlier file read finishes last', async () => {
  await renderUploadPage()
  const zone = document.querySelector('.drop-zone')
  if (zone === null) throw new Error('drop zone not found')
  let finishFirst: ((buffer: ArrayBuffer) => void) | undefined
  const first = new File([new Uint8Array([1, 2, 3, 4])], 'first.wav')
  vi.spyOn(first, 'arrayBuffer').mockImplementation(() => new Promise<ArrayBuffer>((resolve) => { finishFirst = resolve }))
  const second = buildControlledFile('second.wav', 4, 2)

  dropFiles(zone, [first])
  dropFiles(zone, [second.file])
  await waitFor(() => document.querySelector('.file-card-name')?.textContent === 'second.wav')
  finishFirst?.(new Uint8Array([1, 2, 3, 4]).buffer)
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(document.querySelector('.file-card-name')?.textContent).toBe('second.wav')
})

test('a later selection wins when an earlier metadata decode finishes last', async () => {
  await renderUploadPage()
  const zone = document.querySelector('.drop-zone')
  if (zone === null) throw new Error('drop zone not found')
  let finishFirstDecode: ((metadata: { duration: number }) => void) | undefined
  let decodeCount = 0
  vi.stubGlobal('AudioContext', class {
    decodeAudioData(): Promise<{ duration: number }> {
      decodeCount += 1
      if (decodeCount === 1) {
        return new Promise((resolve) => { finishFirstDecode = resolve })
      }
      return Promise.resolve({ duration: 2 })
    }

    async close(): Promise<void> {}
  })
  const first = new File([new Uint8Array([1, 2, 3, 4])], 'first-decode.wav')
  const second = new File([new Uint8Array([1, 2, 3, 4])], 'second-decode.wav')

  dropFiles(zone, [first])
  await waitFor(() => decodeCount === 1)
  dropFiles(zone, [second])
  await waitFor(() => document.querySelector('.file-card-name')?.textContent === 'second-decode.wav')
  finishFirstDecode?.({ duration: 2 })
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(document.querySelector('.file-card-name')?.textContent).toBe('second-decode.wav')
})

test('an unreadable latest selection reports an error without replacing the loaded file', async () => {
  await renderUploadPage()
  const zone = document.querySelector('.drop-zone')
  if (zone === null) throw new Error('drop zone not found')
  const first = buildControlledFile('loaded.wav', 4, 2)
  dropFiles(zone, [first.file])
  await waitFor(() => document.querySelector('.file-card-name')?.textContent === 'loaded.wav')

  const latest = new File([new Uint8Array([1, 2, 3, 4])], 'broken.wav')
  const readLatest = vi.spyOn(latest, 'arrayBuffer').mockRejectedValue(new Error('read failed'))
  dropFiles(zone, [latest])
  await waitFor(() => document.querySelector('.drop-zone-rejection') !== null)

  expect(readLatest).toHaveBeenCalledTimes(1)
  expect(document.querySelector('.file-card-name')?.textContent).toBe('loaded.wav')
  expect(document.querySelector('.drop-zone-rejection')?.textContent).toMatch(/could not be read/i)
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
