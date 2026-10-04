import { afterEach, expect, test, vi } from 'vitest'
import { commands } from 'vitest/browser'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { ROCK_PROFILE } from '../../domain/stem-profile'
import { buildFakeAppDependencies } from '../../../tests/fakes/build-fake-app-dependencies'
import { ExportPage } from '../export/ExportPage'
import { UploadPage } from '../upload/UploadPage'

declare module 'vitest/browser' {
  interface BrowserCommands {
    startPrivacyNetworkCapture: () => Promise<void>
    stopPrivacyNetworkCapture: () => Promise<readonly {
      readonly url: string
      readonly method: string
      readonly bodyHex: string | null
    }[]>
  }
}

const SOURCE_SENTINEL = 'REL07_SOURCE_AUDIO_SENTINEL_4d91'
const STEM_SENTINEL = 'REL07_DERIVED_STEM_SENTINEL_b602'
const TELEMETRY_PROBE = 'REL07_CAPTURE_PROBE'

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function containsBytes(bodyHex: string | null, bytes: Uint8Array): boolean {
  if (bodyHex === null) return false
  const sequenceHex = toHex(bytes)
  for (let offset = 0; offset <= bodyHex.length - sequenceHex.length; offset += 2) {
    if (bodyHex.startsWith(sequenceHex, offset)) return true
  }
  return false
}

let root: Root

afterEach(() => {
  root.unmount()
  vi.unstubAllGlobals()
})

function buildWavBytes(payloadText: string): Uint8Array {
  const payload = new TextEncoder().encode(payloadText)
  const bytes = new Uint8Array(44 + payload.length)
  const view = new DataView(bytes.buffer)
  bytes.set([0x52, 0x49, 0x46, 0x46], 0)
  view.setUint32(4, 36 + payload.length, true)
  bytes.set([0x57, 0x41, 0x56, 0x45], 8)
  bytes.set([0x66, 0x6d, 0x74, 0x20], 12)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 44_100, true)
  view.setUint32(28, 44_100, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  bytes.set([0x64, 0x61, 0x74, 0x61], 36)
  view.setUint32(40, payload.length, true)
  bytes.set(payload, 44)
  return bytes
}

function buildAudioFile(): File {
  return new File([buildWavBytes(SOURCE_SENTINEL).buffer as ArrayBuffer], 'synthetic-source.wav', { type: 'audio/wav' })
}

test('upload, locally stubbed separation, and export keep source and stem bytes out of requests', async () => {
  await commands.startPrivacyNetworkCapture()

  const fake = buildFakeAppDependencies({ availableBytes: 5_000_000_000 })
  fake.modelStore.setFootprint(ROCK_PROFILE.profileId, { cached: true, sizeBytes: 1 })
  fake.inference.scriptSuccess('track-0', ROCK_PROFILE.lanes.map(({ laneId }) => `stems/track-0/${laneId}`))
  vi.stubGlobal('AudioContext', class {
    async decodeAudioData(): Promise<{ duration: number }> { return { duration: 1 } }
    async close(): Promise<void> {}
  })

  root = createRoot(document.body.appendChild(document.createElement('div')))
  flushSync(() => root.render(
    <UploadPage
      deps={fake.deps.addToLibraryDeps}
      navigatorRef={fake.deps.navigatorRef}
      queue={fake.deps.separationQueue}
    />,
  ))
  await new Promise((resolve) => setTimeout(resolve, 0))

  const privacyNotice = document.querySelector('.upload-privacy-notice')?.textContent ?? ''
  expect(privacyNotice).toMatch(/processing happens in this browser/i)
  expect(privacyNotice).toMatch(/source audio is held temporarily .*not saved to your library/i)
  expect(privacyNotice).toMatch(/track details and saved stems .*browser storage/i)
  expect(privacyNotice).toMatch(/nothing in this flow is uploaded to Stemslayer/i)
  expect(privacyNotice).toMatch(/model weights download from Hugging Face and its CDN/i)
  expect(privacyNotice).toMatch(/may be cleared or evicted/i)
  expect(privacyNotice).toMatch(/Safari may delete site data/i)
  expect(privacyNotice).toMatch(/browser profile on this site/i)
  expect(privacyNotice).toMatch(/other browsers, devices, and site origins have separate storage/i)

  const file = buildAudioFile()
  const zone = document.querySelector('.drop-zone')
  if (zone === null) throw new Error('drop zone not found')
  const transfer = new DataTransfer()
  transfer.items.add(file)
  zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))

  await waitFor(() => document.querySelector('.file-card') !== null)
  document.querySelector<HTMLButtonElement>('.primary-action')?.click()
  await waitFor(async () => (await fake.catalog.getById('track-0'))?.status === 'ready')

  const track = await fake.catalog.getById('track-0')
  if (track === undefined) throw new Error('separated track not found')
  const stemBytes = buildWavBytes(STEM_SENTINEL)
  await Promise.all(ROCK_PROFILE.lanes.map(({ laneId }) => fake.stemStore.writeLane(track.resultKey, laneId, stemBytes)))
  flushSync(() => root.render(
    <ExportPage
      deps={{ catalog: fake.catalog, stemStore: fake.stemStore }}
      trackId={track.trackId}
      onBackToMixer={() => undefined}
    />,
  ))
  await waitFor(() => document.querySelectorAll('.export-stem-row').length === ROCK_PROFILE.lanes.length)
  document.querySelector<HTMLButtonElement>('.export-download-selected')?.click()

  const sourceBytes = new Uint8Array(await file.arrayBuffer())
  const telemetryPrefix = new TextEncoder().encode(`${TELEMETRY_PROBE}\u0000\u0001`)
  const separator = sourceBytes.byteLength % 2 === 1 ? [0x00] : []
  const unalignedProbeBytes = new Uint8Array([
    ...telemetryPrefix,
    ...sourceBytes,
    ...separator,
    ...stemBytes,
  ])
  const probeResponse = await fetch('/__privacy_telemetry_probe__', {
    method: 'POST',
    body: unalignedProbeBytes,
  }).catch(() => undefined)
  expect(probeResponse === undefined || probeResponse.status >= 400).toBe(true)

  const requests = await commands.stopPrivacyNetworkCapture()
  const telemetryProbeUrl = new URL('/__privacy_telemetry_probe__', location.href).href
  expect(requests.some((request) => request.url === telemetryProbeUrl)).toBe(true)
  const probe = requests.find((request) => request.url === telemetryProbeUrl)
  expect(probe?.method).toBe('POST')
  expect(containsBytes(probe?.bodyHex ?? null, new TextEncoder().encode(TELEMETRY_PROBE))).toBe(true)
  expect(probe?.bodyHex).toBe(toHex(unalignedProbeBytes))
  expect(containsBytes(probe?.bodyHex ?? null, sourceBytes)).toBe(true)
  expect(containsBytes(probe?.bodyHex ?? null, stemBytes)).toBe(true)
  const sourceOffset = probe?.bodyHex?.indexOf(toHex(sourceBytes))
  const stemOffset = probe?.bodyHex?.indexOf(toHex(stemBytes))
  expect(sourceOffset).toBeGreaterThanOrEqual(0)
  expect((sourceOffset ?? 0) / 2 % 2).toBe(1)
  expect(stemOffset).toBeGreaterThanOrEqual(0)
  expect((stemOffset ?? 0) / 2 % 2).toBe(1)
  const appRequests = requests.filter((request) => (
    request.url !== telemetryProbeUrl || request.method !== 'POST'
  ))
  expect(appRequests).toEqual([])

  expect(requests.every((request) => new URL(request.url).origin === location.origin)).toBe(true)
  expect(appRequests.some((request) => request.url.includes(SOURCE_SENTINEL))).toBe(false)
  expect(appRequests.some((request) => containsBytes(request.bodyHex, sourceBytes))).toBe(false)
  expect(appRequests.some((request) => request.url.includes(STEM_SENTINEL))).toBe(false)
  expect(appRequests.some((request) => containsBytes(request.bodyHex, stemBytes))).toBe(false)
})

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const start = Date.now()
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
