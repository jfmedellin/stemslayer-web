import { afterEach, expect, test } from 'vitest'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { page, userEvent } from 'vitest/browser'
import { FakeAudioEnginePort } from '../../../tests/fakes/fake-audio-engine'
import { InMemoryCatalog } from '../../../tests/fakes/in-memory-catalog'
import { InMemoryStemStore } from '../../../tests/fakes/in-memory-stem-store'
import { encodeFloat32Wav } from '../../domain/audio/float32-wav'
import { SKIP_SECONDS } from '../../domain/mixer/mixer'
import { ROCK_PROFILE } from '../../domain/stem-profile'
import type { Track } from '../../domain/track'
import { formatGainDb } from '../format/format-db'
import { MixerPage, type MixerPageDeps } from './MixerPage'
import '../tokens.css'

let root: Root
afterEach(() => root.unmount())

// A 30 s / 8 kHz fixture: long enough that a 10 s (`SKIP_SECONDS`) skip
// moves the exact number of samples without clamping in the middle of the
// track, while still short enough to reach and demonstrate both clamp
// boundaries in a handful of clicks.
const SAMPLE_RATE = 8_000
const DURATION_SECONDS = 30
const FRAME_COUNT = SAMPLE_RATE * DURATION_SECONDS
const SKIP_SAMPLES = Math.round(SKIP_SECONDS * SAMPLE_RATE)

function rampChannel(base: number): Float32Array {
  return Float32Array.from({ length: FRAME_COUNT }, (_unused, index) => base + index / (FRAME_COUNT * 20))
}

function baseTrack(overrides: Partial<Track> = {}): Track {
  return {
    trackId: 'track-1',
    title: 'Komorebi Master Mix',
    artist: 'Yui',
    genre: null,
    durationSeconds: DURATION_SECONDS,
    bpm: null,
    musicalKey: null,
    createdAtUtc: new Date(Date.now() - 5 * 60_000).toISOString(),
    profileId: ROCK_PROFILE.profileId,
    pipelineFingerprint: 'fp',
    resultKey: 'stems/track-1',
    sourceHash: 'hash-1',
    status: 'ready',
    errorDetail: null,
    ...overrides,
  }
}

interface TestDeps {
  readonly deps: MixerPageDeps
  readonly catalog: InMemoryCatalog
  readonly stemStore: InMemoryStemStore
  readonly audioEngine: FakeAudioEnginePort
}

async function buildDeps(track: Track, options: { absentGuitarCenter?: boolean } = {}): Promise<TestDeps> {
  const catalog = new InMemoryCatalog()
  const stemStore = new InMemoryStemStore()
  const audioEngine = new FakeAudioEnginePort()
  await catalog.insert(track)

  for (const [index, lane] of ROCK_PROFILE.lanes.entries()) {
    const absent = options.absentGuitarCenter === true && lane.laneId === 'guitar_center'
    const channel = absent ? new Float32Array(FRAME_COUNT) : rampChannel(0.01 * (index + 1))
    const bytes = encodeFloat32Wav({ sampleRate: SAMPLE_RATE, planar: [channel, channel] })
    await stemStore.writeLane(track.resultKey, lane.laneId, bytes)
  }

  return { deps: { catalog, stemStore, audioEngine }, catalog, stemStore, audioEngine }
}

function renderMixer(
  testDeps: TestDeps,
  trackId = 'track-1',
): { onBack: number; onExport: number; lastExportedTrackId: string | null } {
  const calls: { onBack: number; onExport: number; lastExportedTrackId: string | null } = {
    onBack: 0,
    onExport: 0,
    lastExportedTrackId: null,
  }
  const container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
  flushSync(() => root.render(
    <MixerPage
      deps={testDeps.deps}
      trackId={trackId}
      onBackToLibrary={() => { calls.onBack += 1 }}
      onExport={(exportedTrackId) => { calls.onExport += 1; calls.lastExportedTrackId = exportedTrackId }}
    />,
  ))
  return calls
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function clickButton(selector: string): void {
  const button = document.querySelector<HTMLButtonElement>(selector)
  if (button === null) throw new Error(`button not found: ${selector}`)
  flushSync(() => button.click())
}

function lastGainFor(engine: FakeAudioEnginePort, laneId: string): number | undefined {
  return [...engine.laneGainCalls].reverse().find((call) => call.laneId === laneId)?.gain
}

function lanesRendered(): NodeListOf<Element> {
  return document.querySelectorAll('.mixer-lane-row')
}

/**
 * Waits for the lanes to render *and* for the session-scoped `useEffect`s
 * to have flushed — the DOM commit (lanes appearing) happens before React
 * runs passive effects, so a global keydown listener registered in one of
 * those effects (gated on `canPlay`) can still be mid-flight the instant
 * the lane rows appear. `masterGainCalls` is only pushed by an effect
 * declared earlier in `MixerPage` than the keydown-registration effect, so
 * its presence proves every earlier effect for this render — including the
 * keydown listener's re-registration with the now-current `canPlay` — has
 * already run.
 */
async function waitForLoaded(engine: FakeAudioEnginePort): Promise<void> {
  await waitFor(() => lanesRendered().length === 6 && engine.masterGainCalls.length > 0)
}

test('opens a track and renders all six lanes in profile order, including the absent-lane suffix', async () => {
  const testDeps = await buildDeps(baseTrack(), { absentGuitarCenter: true })
  renderMixer(testDeps)
  await waitForLoaded(testDeps.audioEngine)

  const names = [...lanesRendered()].map((row) => row.querySelector('.mixer-lane-name')?.textContent)
  expect(names).toEqual([
    'Vocals',
    'Drums',
    'Bass',
    'Guitar Center · NOT IN THIS TRACK',
    'Guitar Sides',
    'Other',
  ])

  expect(document.querySelector('.mixer-track-title')?.textContent).toBe('Komorebi Master Mix')
  expect(document.querySelector('.mixer-track-artist')?.textContent).toBe('Yui')
})

test('solo toggles call setLaneGain with the domain\'s exact multi-solo effective gain', async () => {
  const testDeps = await buildDeps(baseTrack())
  renderMixer(testDeps)
  await waitForLoaded(testDeps.audioEngine)

  clickButton('.mixer-lane-row[data-lane-id="vocals"] .mixer-lane-solo')
  clickButton('.mixer-lane-row[data-lane-id="drums"] .mixer-lane-solo')

  expect(lastGainFor(testDeps.audioEngine, 'vocals')).toBe(1)
  expect(lastGainFor(testDeps.audioEngine, 'drums')).toBe(1)
  expect(lastGainFor(testDeps.audioEngine, 'bass')).toBe(0)
  expect(lastGainFor(testDeps.audioEngine, 'other')).toBe(0)

  // Muted always wins over solo.
  clickButton('.mixer-lane-row[data-lane-id="vocals"] .mixer-lane-mute')
  expect(lastGainFor(testDeps.audioEngine, 'vocals')).toBe(0)
  expect(lastGainFor(testDeps.audioEngine, 'drums')).toBe(1)
})

test('the gain fader pushes gainFromPercent\'s value through setLaneGain', async () => {
  const testDeps = await buildDeps(baseTrack())
  renderMixer(testDeps)
  await waitForLoaded(testDeps.audioEngine)

  const fader = document.querySelector<HTMLInputElement>('.mixer-lane-row[data-lane-id="vocals"] .mixer-lane-gain-fader')
  if (fader === null) throw new Error('vocals fader not found')
  const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  flushSync(() => {
    nativeValueSetter?.call(fader, '40')
    fader.dispatchEvent(new Event('input', { bubbles: true }))
  })

  expect(lastGainFor(testDeps.audioEngine, 'vocals')).toBeCloseTo(0.4, 6)
  expect(document.querySelector('.mixer-lane-row[data-lane-id="vocals"] .mixer-lane-gain-readout')?.textContent)
    .toBe(formatGainDb(40))
})

test('master gain slider calls setMasterGain with masterGainFromPercent\'s value and shows the dB readout', async () => {
  const testDeps = await buildDeps(baseTrack())
  renderMixer(testDeps)
  await waitForLoaded(testDeps.audioEngine)

  const fader = document.querySelector<HTMLInputElement>('.mixer-master-gain-fader')
  if (fader === null) throw new Error('master fader not found')
  expect(fader.getAttribute('aria-label')).toBe('Master volume')
  expect(document.querySelector('.mixer-master-gain-label')).toBeNull()
  expect(document.querySelector('.mixer-master-gain-icon')?.getAttribute('aria-hidden')).toBe('true')
  const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  flushSync(() => {
    nativeValueSetter?.call(fader, '50')
    fader.dispatchEvent(new Event('input', { bubbles: true }))
  })

  expect(testDeps.audioEngine.masterGainCalls.at(-1)).toBeCloseTo(0.5, 6)
  expect(document.querySelector('.mixer-master-gain-readout')?.textContent).toBe(formatGainDb(50))
})

test('spacebar toggles play/pause only while mounted; unmounting removes the global listener', async () => {
  const testDeps = await buildDeps(baseTrack())
  renderMixer(testDeps)
  await waitForLoaded(testDeps.audioEngine)

  flushSync(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })))
  expect(testDeps.audioEngine.playCalls).toBe(1)

  flushSync(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })))
  expect(testDeps.audioEngine.pauseCalls).toBe(1)

  root.unmount()
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))
  // Still 1: the listener was removed on unmount, so this Space press was never handled.
  expect(testDeps.audioEngine.playCalls).toBe(1)
})

test('primary transport actions are compact icon buttons with accessible names and an active loop state', async () => {
  const testDeps = await buildDeps(baseTrack())
  renderMixer(testDeps)
  await waitForLoaded(testDeps.audioEngine)

  const back = document.querySelector<HTMLButtonElement>('.mixer-skip-back')
  const playback = document.querySelector<HTMLButtonElement>('.mixer-play-pause')
  const forward = document.querySelector<HTMLButtonElement>('.mixer-skip-forward')
  const loop = document.querySelector<HTMLButtonElement>('.mixer-loop-toggle')
  if (back === null || playback === null || forward === null || loop === null) {
    throw new Error('primary transport buttons not found')
  }

  expect(back.getAttribute('aria-label')).toBe('Seek backward 10 seconds')
  expect(playback.getAttribute('aria-label')).toBe('Play')
  expect(forward.getAttribute('aria-label')).toBe('Seek forward 10 seconds')
  expect(loop.getAttribute('aria-label')).toBe('Enable loop')
  expect(loop.getAttribute('aria-pressed')).toBe('false')
  expect(back.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  expect(playback.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  expect(forward.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  expect(loop.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')

  clickButton('.mixer-play-pause')
  expect(testDeps.audioEngine.playCalls).toBe(1)
  expect(playback.getAttribute('aria-label')).toBe('Pause')

  // A/B actions remain separately available next to the new loop toggle.
  expect(document.querySelector('.mixer-set-loop-a')).not.toBeNull()
  expect(document.querySelector('.mixer-set-loop-b')).not.toBeNull()
  expect(document.querySelector('.mixer-clear-loop')).not.toBeNull()
})

test('skip buttons and arrow keys move exactly SKIP_SECONDS, clamped to the track bounds', async () => {
  const testDeps = await buildDeps(baseTrack())
  renderMixer(testDeps)
  await waitForLoaded(testDeps.audioEngine)

  clickButton('.mixer-skip-forward')
  expect(testDeps.audioEngine.seekCalls.at(-1)).toBe(SKIP_SAMPLES)
  expect(document.querySelector('.mixer-time-readout')?.textContent).toBe('0:10 / 0:30')

  clickButton('.mixer-skip-forward')
  expect(testDeps.audioEngine.seekCalls.at(-1)).toBe(SKIP_SAMPLES * 2)

  clickButton('.mixer-skip-forward')
  // Exactly the track end (3 * 10 s == 30 s), not a clamp yet.
  expect(testDeps.audioEngine.seekCalls.at(-1)).toBe(FRAME_COUNT)

  clickButton('.mixer-skip-forward')
  // Unclamped would be 40 s; clamps at the track end instead.
  expect(testDeps.audioEngine.seekCalls.at(-1)).toBe(FRAME_COUNT)

  flushSync(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })))
  expect(testDeps.audioEngine.seekCalls.at(-1)).toBe(FRAME_COUNT - SKIP_SAMPLES)

  // Two more presses land exactly at 0; a third demonstrates the start clamp.
  flushSync(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })))
  flushSync(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })))
  expect(testDeps.audioEngine.seekCalls.at(-1)).toBe(0)

  flushSync(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })))
  expect(testDeps.audioEngine.seekCalls.at(-1)).toBe(0)
})

test('the focused timeline seeks by one second and reaches both bounds without using global skip', async () => {
  const testDeps = await buildDeps(baseTrack())
  renderMixer(testDeps)
  await waitForLoaded(testDeps.audioEngine)

  const timeline = document.querySelector<HTMLElement>('.mixer-timeline-ruler')
  if (timeline === null) throw new Error('timeline not found')
  expect(timeline.getAttribute('role')).toBe('slider')
  expect(timeline.getAttribute('aria-label')).toBe('Track position')
  expect(timeline.getAttribute('aria-valuemin')).toBe('0')
  expect(timeline.getAttribute('aria-valuemax')).toBe(String(FRAME_COUNT))
  expect(timeline.getAttribute('aria-valuenow')).toBe('0')

  timeline.focus()
  await userEvent.keyboard('{ArrowRight}')
  expect(testDeps.audioEngine.seekCalls.at(-1)).toBe(SAMPLE_RATE)
  expect(timeline.getAttribute('aria-valuenow')).toBe(String(SAMPLE_RATE))
  await userEvent.keyboard('{Home}')
  expect(testDeps.audioEngine.seekCalls.at(-1)).toBe(0)
  await userEvent.keyboard('{End}')
  expect(testDeps.audioEngine.seekCalls.at(-1)).toBe(FRAME_COUNT)
  await userEvent.keyboard('{ArrowRight}')
  expect(testDeps.audioEngine.seekCalls.at(-1)).toBe(FRAME_COUNT)
  await userEvent.keyboard('{ArrowLeft}')
  expect(testDeps.audioEngine.seekCalls.at(-1)).toBe(FRAME_COUNT - SAMPLE_RATE)

  timeline.style.width = '300px'
  const rect = timeline.getBoundingClientRect()
  flushSync(() => timeline.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    clientX: rect.left + rect.width / 2,
  })))
  expect(testDeps.audioEngine.seekCalls.at(-1)).toBe(FRAME_COUNT / 2)
})

test('A/B loop markers are settable, clearable, and L toggles between the confirmed region and none', async () => {
  const testDeps = await buildDeps(baseTrack())
  renderMixer(testDeps)
  await waitForLoaded(testDeps.audioEngine)

  // A at sample 0 (the playhead's starting position).
  clickButton('.mixer-set-loop-a')
  // Move the playhead 10 s forward, then confirm B there.
  clickButton('.mixer-skip-forward')
  clickButton('.mixer-set-loop-b')

  expect(testDeps.audioEngine.loopRangeCalls.at(-1)).toEqual({ startSample: 0, endSample: SKIP_SAMPLES })
  expect(document.querySelector('.mixer-loop-marker-start')?.textContent).toBe('A 0:00')
  expect(document.querySelector('.mixer-loop-marker-end')?.textContent).toBe('B 0:10')

  const loopToggle = document.querySelector<HTMLButtonElement>('.mixer-loop-toggle')
  if (loopToggle === null) throw new Error('loop toggle not found')
  expect(loopToggle.getAttribute('aria-pressed')).toBe('true')
  clickButton('.mixer-loop-toggle')
  expect(loopToggle.getAttribute('aria-pressed')).toBe('false')
  expect(loopToggle.getAttribute('aria-label')).toBe('Enable loop')
  expect(testDeps.audioEngine.loopRangeCalls.at(-1)).toBeNull()

  clickButton('.mixer-clear-loop')
  expect(testDeps.audioEngine.loopRangeCalls.at(-1)).toBeNull()

  // 'L' and the button use the same toggle state and restore the saved region.
  flushSync(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l' })))
  expect(testDeps.audioEngine.loopRangeCalls.at(-1)).toEqual({ startSample: 0, endSample: SKIP_SAMPLES })
  expect(loopToggle.getAttribute('aria-pressed')).toBe('true')

  // The button turns looping off again, just like 'L'.
  clickButton('.mixer-loop-toggle')
  expect(testDeps.audioEngine.loopRangeCalls.at(-1)).toBeNull()
  expect(loopToggle.getAttribute('aria-pressed')).toBe('false')
})

test('Back to library and Export stems only navigate; they never dispose the shared engine', async () => {
  const testDeps = await buildDeps(baseTrack())
  const calls = renderMixer(testDeps)
  await waitForLoaded(testDeps.audioEngine)

  clickButton('.mixer-back-to-library')
  clickButton('.mixer-export-stems')

  expect(calls.onBack).toBe(1)
  expect(calls.onExport).toBe(1)
  // Proves the trackId-threading fix, not just that a click was observed:
  // `TrackHeader`'s "Export stems" button now carries the exact loaded
  // track's id all the way out through `MixerPage`'s own `onExport` prop.
  expect(calls.lastExportedTrackId).toBe('track-1')
  expect(testDeps.audioEngine.disposed).toBe(false)
})

test('the desktop mixer keeps timeline labels and each lane gain beside its controls', async () => {
  const testDeps = await buildDeps(baseTrack())
  renderMixer(testDeps)
  await waitForLoaded(testDeps.audioEngine)

  expect(document.querySelectorAll('.mixer-timeline-tick').length).toBeGreaterThanOrEqual(3)
  const row = document.querySelector('.mixer-lane-row')!
  expect(row.querySelector('.mixer-lane-info .mixer-lane-gain')).not.toBeNull()
  expect(row.querySelector('.mixer-lane-waveform')).not.toBeNull()
  expect(getComputedStyle(row).gridTemplateColumns.split(' ').length).toBe(3)
})

test('mixer expands across a maximized workspace and distributes height across lanes', async () => {
  await page.viewport(1920, 1400)
  const testDeps = await buildDeps(baseTrack())
  renderMixer(testDeps)
  await waitForLoaded(testDeps.audioEngine)

  const mixer = document.querySelector<HTMLElement>('.mixer-page')
  const firstLane = document.querySelector<HTMLElement>('.mixer-lane-row')
  if (mixer === null || firstLane === null) throw new Error('mixer layout not found')

  expect(mixer.getBoundingClientRect().width).toBeGreaterThan(1800)
  expect(firstLane.getBoundingClientRect().height).toBeGreaterThan(140)
})

test('short mixer viewports keep the minimum lane height and remain scrollable', async () => {
  await page.viewport(1280, 560)
  const testDeps = await buildDeps(baseTrack())
  renderMixer(testDeps)
  await waitForLoaded(testDeps.audioEngine)

  const firstLane = document.querySelector<HTMLElement>('.mixer-lane-row')
  if (firstLane === null) throw new Error('mixer lane not found')

  expect(firstLane.getBoundingClientRect().height).toBeGreaterThanOrEqual(80)
  expect(document.documentElement.scrollHeight).toBeGreaterThan(window.innerHeight)
})

test('every rendered lane waveform reaches 3:1 contrast against its actual lane surface', async () => {
  const testDeps = await buildDeps(baseTrack())
  renderMixer(testDeps)
  await waitForLoaded(testDeps.audioEngine)

  const parseRgb = (value: string): [number, number, number] => {
    const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number)
    if (channels === undefined || channels.length !== 3) throw new Error(`unsupported computed color: ${value}`)
    return [channels[0]!, channels[1]!, channels[2]!]
  }
  const composite = (foreground: [number, number, number], background: [number, number, number], opacity: number) =>
    foreground.map((channel, index) => channel * opacity + background[index]! * (1 - opacity)) as [number, number, number]
  const luminance = (rgb: [number, number, number]): number => {
    const linear = rgb.map((channel) => {
      const normalized = channel / 255
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
  }
  const ratio = (first: number, second: number): number => (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)

  const laneIds = ['vocals', 'drums', 'bass', 'guitar_center', 'guitar_sides', 'other']
  const measurements = laneIds.map((laneId) => {
    const waveform = document.querySelector<SVGSVGElement>(`.mixer-lane-row[data-lane-id="${laneId}"] .mixer-lane-waveform`)
    const path = waveform?.querySelector('path')
    if (waveform === null || path === null || waveform === undefined || path === undefined) {
      throw new Error(`waveform not found for lane: ${laneId}`)
    }
    const foreground = getComputedStyle(path).fill
    const background = getComputedStyle(waveform).backgroundColor
    const opacity = Number(getComputedStyle(path).opacity)
    const foregroundRgb = parseRgb(foreground)
    const backgroundRgb = parseRgb(background)
    const compositedRgb = composite(foregroundRgb, backgroundRgb, opacity)
    return { laneId, foreground, background, opacity, compositedRgb, contrast: ratio(luminance(compositedRgb), luminance(backgroundRgb)) }
  })

  expect(measurements).toHaveLength(6)
  for (const measurement of measurements) {
    expect(measurement.contrast, `${measurement.laneId}: ${JSON.stringify(measurement)}`).toBeGreaterThanOrEqual(3)
  }
})
