import { beforeEach, describe, expect, test, vi } from 'vitest'

import { createLoopRange, resolveEffectiveGains, type MixerLaneState } from '../../domain/mixer/mixer'
import type { MixerSession, MixerSessionLane } from '../../application/ports/audio-engine-port'
import { MIXER_PREFETCH_CHUNK_FRAMES, MIXER_PREFETCH_SLOT_COUNT } from './protocol'
import { WebAudioEngine } from './web-audio-engine'

const SAMPLE_RATE = 44_100
const FRAME_COUNT = 200

/** A distinct ramp per lane so every sample position has a unique, checkable value. */
function rampChannel(base: number, frameCount = FRAME_COUNT): Float32Array {
  return Float32Array.from({ length: frameCount }, (_unused, index) => base + index / 1_000)
}

function lane(
  laneId: string,
  base: number,
  frameCount = FRAME_COUNT,
): MixerSessionLane & { readonly channels: readonly [Float32Array, Float32Array] } {
  return {
    laneId,
    displayName: laneId,
    channels: [rampChannel(base, frameCount), rampChannel(base, frameCount)],
    absent: false,
  }
}

function makeSession(lanes: readonly MixerSessionLane[], frameCount = FRAME_COUNT): MixerSession {
  return {
    trackId: 'track-1',
    sampleRate: SAMPLE_RATE,
    frameCount,
    lanes,
    fallback: false,
  }
}

/** Lets the worklet's port messages and AudioParam automation land before rendering starts. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 50))
}

/** Waits for cross-thread AudioWorklet messages without assuming they beat a suspend event. */
async function waitForCondition(
  condition: () => boolean,
  description: string,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`)
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

async function render(context: OfflineAudioContext): Promise<AudioBuffer> {
  await flushMicrotasks()
  return context.startRendering()
}

function makeContext(length: number): OfflineAudioContext {
  return new OfflineAudioContext(2, length, SAMPLE_RATE)
}

describe('WebAudioEngine against a real AudioWorkletProcessor (OfflineAudioContext, Chromium)', () => {
  let context: OfflineAudioContext
  let engine: WebAudioEngine

  beforeEach(() => {
    context = makeContext(FRAME_COUNT + 100)
    engine = new WebAudioEngine({ context })
  })

  test('mixes two lanes at their set gains, sample-accurately, then stops at the track end', async () => {
    const vocals = lane('vocals', 0.1)
    const drums = lane('drums', 0.2)
    await engine.load(makeSession([vocals, drums]))
    engine.setLaneGain('vocals', 1)
    engine.setLaneGain('drums', 0.5)
    engine.setMasterGain(1)
    engine.play()

    const buffer = await render(context)
    const left = buffer.getChannelData(0)

    for (const sampleIndex of [0, 1, 50, 199]) {
      const expected = vocals.channels[0][sampleIndex] * 1 + drums.channels[0][sampleIndex] * 0.5
      expect(left[sampleIndex]).toBeCloseTo(expected, 6)
    }
    // Stops (silence) once frameCount is reached, rather than repeating or looping.
    expect(left[FRAME_COUNT]).toBe(0)
    expect(left[FRAME_COUNT + 50]).toBe(0)
  })

  test('a paused engine renders silence even though lanes are loaded', async () => {
    await engine.load(makeSession([lane('vocals', 0.3)]))
    engine.setLaneGain('vocals', 1)
    // Never calls play().

    const buffer = await render(context)
    const left = buffer.getChannelData(0)
    expect(left[0]).toBe(0)
    expect(left[50]).toBe(0)
  })

  test('pause reports its state and cursor so playback can resume from that position', async () => {
    const progress: Array<{ currentSample: number; isPlaying: boolean }> = []
    engine.onProgress((update) => progress.push(update))
    await engine.load(makeSession([lane('vocals', 0.3)]))
    engine.seek(80)
    engine.play()
    engine.pause()
    engine.play()

    await render(context)

    expect(progress).toEqual([
      { currentSample: 80, isPlaying: true },
      { currentSample: 80, isPlaying: false },
      { currentSample: 80, isPlaying: true },
    ])
  })

  test('multi-solo: a soloed lane keeps its gain, a non-soloed lane is silenced, wired through the real domain formula', async () => {
    const vocals = lane('vocals', 0.1)
    const drums = lane('drums', 0.2)
    const bass = lane('bass', 0.05)
    await engine.load(makeSession([vocals, drums, bass]))

    // Two lanes soloed (multi-solo), one left alone: exact same
    // `resolveEffectiveGains` the domain test suite covers in
    // `tests/domain/mixer.test.ts` — this proves the engine applies
    // whatever the domain resolves, sample-accurately, not a re-implemented
    // mute/solo rule inside the adapter.
    const laneStates: readonly MixerLaneState[] = [
      { laneId: 'vocals', gainPercent: 100, muted: false, solo: true },
      { laneId: 'drums', gainPercent: 100, muted: false, solo: false },
      { laneId: 'bass', gainPercent: 100, muted: true, solo: true },
    ]
    const gains = resolveEffectiveGains(laneStates)
    for (const [laneId, gain] of gains) engine.setLaneGain(laneId, gain)
    engine.setMasterGain(1)
    engine.play()

    const buffer = await render(context)
    const left = buffer.getChannelData(0)

    const sampleIndex = 25
    const expected = vocals.channels[0][sampleIndex] * 1 // drums silenced, bass muted-over-solo
    expect(left[sampleIndex]).toBeCloseTo(expected, 6)
    expect(gains.get('drums')).toBe(0)
    expect(gains.get('bass')).toBe(0)
  })

  test('master gain applies after the per-lane sum, scaling the whole mix', async () => {
    const vocals = lane('vocals', 0.1)
    const drums = lane('drums', 0.1)
    await engine.load(makeSession([vocals, drums]))
    engine.setLaneGain('vocals', 1)
    engine.setLaneGain('drums', 1)
    engine.setMasterGain(0.25)
    engine.play()

    const buffer = await render(context)
    const left = buffer.getChannelData(0)

    const sampleIndex = 10
    const expected = (vocals.channels[0][sampleIndex] + drums.channels[0][sampleIndex]) * 0.25
    expect(left[sampleIndex]).toBeCloseTo(expected, 6)
  })

  test('a loop region wraps the shared cursor from its end back to its start', async () => {
    const solo = lane('vocals', 0.1)
    await engine.load(makeSession([solo]))
    engine.setLaneGain('vocals', 1)
    engine.setMasterGain(1)
    engine.setLoopRange(createLoopRange(50, 150, FRAME_COUNT))
    engine.play()

    const buffer = await render(context)
    const left = buffer.getChannelData(0)

    // Playback starts at cursor 0 (outside the [50,150) region) and plays
    // straight through, unaffected, until the cursor itself reaches the
    // region's end at source sample 150.
    expect(left[0]).toBeCloseTo(solo.channels[0][0], 6)
    expect(left[149]).toBeCloseTo(solo.channels[0][149], 6)
    // The very next sample wraps: cursor 149 -> next 150 >= endSample(150)
    // -> jumps to startSample(50). Rendered playback sample 150 is source
    // sample 50, not source sample 150.
    expect(left[150]).toBeCloseTo(solo.channels[0][50], 6)
    expect(left[150]).not.toBeCloseTo(solo.channels[0][150], 3)
    expect(left[151]).toBeCloseTo(solo.channels[0][51], 6)
    // The loop repeats every (150-50)=100 samples: it wraps again at
    // playback sample 250 (149 samples into the second pass through the
    // region, same as the first wrap).
    expect(left[250]).toBeCloseTo(solo.channels[0][50], 6)
  })

    test('seek jumps the shared cursor to an exact sample before playback resumes', async () => {
    const solo = lane('vocals', 0.1)
    await engine.load(makeSession([solo]))
    engine.setLaneGain('vocals', 1)
    engine.setMasterGain(1)
    engine.seek(80)
    engine.play()

    const buffer = await render(context)
    const left = buffer.getChannelData(0)

    expect(left[0]).toBeCloseTo(solo.channels[0][80], 6)
    expect(left[19]).toBeCloseTo(solo.channels[0][99], 6)
  })

  test('streams bounded frame blocks and loops sample-accurately across a prefetch boundary', async () => {
    const frameCount = 16_390
    const streamed: number[] = []
    const session: MixerSession = {
      trackId: 'streamed-track',
      sampleRate: SAMPLE_RATE,
      frameCount,
      fallback: false,
      lanes: [{ laneId: 'vocals', displayName: 'Vocals', absent: false }],
      readFrames: async (startFrame, count) => {
        streamed.push(count)
        const channel = Float32Array.from({ length: count }, (_unused, index) => (startFrame + index) / 100_000)
        return [[channel, channel.slice()]]
      },
    }
    const boundaryContext = new OfflineAudioContext(2, 5, SAMPLE_RATE)
    const boundaryEngine = new WebAudioEngine({ context: boundaryContext })
    const streamProgress: Array<{ currentSample: number; isPlaying: boolean; isBuffering?: boolean }> = []
    boundaryEngine.onProgress((progress) => streamProgress.push(progress))
    await boundaryEngine.load(session)
    boundaryEngine.setLaneGain('vocals', 1)
    boundaryEngine.setMasterGain(1)
    boundaryEngine.setLoopRange(createLoopRange(16_382, 16_385, frameCount))
    boundaryEngine.seek(16_382)
    boundaryEngine.play()
    const output = await render(boundaryContext)
    const samples = output.getChannelData(0)

    expect(streamed.length).toBeGreaterThan(0)
    expect(samples[0]).toBeCloseTo(16_382 / 100_000, 6)
    expect(samples[1]).toBeCloseTo(16_383 / 100_000, 6)
    expect(samples[2]).toBeCloseTo(16_384 / 100_000, 6)
    expect(samples[3]).toBeCloseTo(16_382 / 100_000, 6)
    expect(streamed.every((count) => count <= 16_384)).toBe(true)
    expect(streamed.length).toBeLessThanOrEqual(4)
    boundaryEngine.dispose()
  })

  test('keeps multi-chunk loop ranges prefetched through a loop wrap', async () => {
    const frameCount = MIXER_PREFETCH_CHUNK_FRAMES * (MIXER_PREFETCH_SLOT_COUNT + 1)
    const frameReads: number[] = []
    const context = new OfflineAudioContext(2, frameCount + MIXER_PREFETCH_CHUNK_FRAMES, SAMPLE_RATE)
    const streamingEngine = new WebAudioEngine({ context })
    const progress: Array<{ currentSample: number; isPlaying: boolean; isBuffering?: boolean }> = []
    let previousSample = 0
    let loopWrapped = false
    streamingEngine.onProgress((next) => {
      if (next.currentSample < previousSample && previousSample >= frameCount - MIXER_PREFETCH_CHUNK_FRAMES) {
        loopWrapped = true
      }
      previousSample = next.currentSample
      progress.push(next)
    })
    const session: MixerSession = {
      trackId: 'long-loop-track',
      sampleRate: SAMPLE_RATE,
      frameCount,
      fallback: false,
      lanes: [{ laneId: 'vocals', displayName: 'Vocals', absent: false }],
      readFrames: async (startFrame, count) => {
        frameReads.push(startFrame)
        const channel = new Float32Array(count).fill(0.1)
        return [[channel, channel.slice()]]
      },
    }

    await streamingEngine.load(session)
    await flushMicrotasks()
    progress.length = 0
    previousSample = 0
    loopWrapped = false
    streamingEngine.setLaneGain('vocals', 1)
    streamingEngine.setMasterGain(1)
    streamingEngine.setLoopRange(createLoopRange(0, frameCount, frameCount))
    streamingEngine.play()
    const firstSuspended = context.suspend(
      (MIXER_PREFETCH_CHUNK_FRAMES * 2.5) / SAMPLE_RATE,
    )
    const rendering = context.startRendering()
    try {
      await firstSuspended
      await waitForCondition(
        () => progress.some((next) => next.currentSample > MIXER_PREFETCH_CHUNK_FRAMES * 2),
        'worklet progress after the first interior chunk',
      )
      await waitForCondition(() => frameReads.includes(MIXER_PREFETCH_CHUNK_FRAMES * 4), 'the loop-end prefetch')
      const beforeWrapSuspended = context.suspend(
        (frameCount - MIXER_PREFETCH_CHUNK_FRAMES / 2) / SAMPLE_RATE,
      )
      await context.resume()
      await beforeWrapSuspended
      await waitForCondition(
        () => progress.some((next) => next.currentSample > MIXER_PREFETCH_CHUNK_FRAMES * 4),
        'worklet progress before the loop wrap',
      )
      await waitForCondition(
        () => frameReads.filter((startFrame) => startFrame === MIXER_PREFETCH_CHUNK_FRAMES).length > 1,
        'the loop-start refill before the loop wrap',
      )
      expect(frameReads).toContain(MIXER_PREFETCH_CHUNK_FRAMES * 4)
      expect(progress.every((next) => next.isBuffering !== true)).toBe(true)
      await context.resume()
      await rendering
      await waitForCondition(() => loopWrapped, 'the first completed loop wrap')

      expect(frameReads.filter((startFrame) => startFrame === MIXER_PREFETCH_CHUNK_FRAMES).length).toBeGreaterThan(1)
      expect(progress.every((next) => next.isBuffering !== true)).toBe(true)
    } finally {
      await context.resume().catch(() => undefined)
      await rendering.catch(() => undefined)
      streamingEngine.dispose()
    }
  })

  test('keeps sequential prefetch ahead of playback when the selected loop is far away', async () => {
    const frameCount = MIXER_PREFETCH_CHUNK_FRAMES * 12
    const context = new OfflineAudioContext(2, MIXER_PREFETCH_CHUNK_FRAMES * 4, SAMPLE_RATE)
    const streamingEngine = new WebAudioEngine({ context })
    const frameReads: number[] = []
    const progress: Array<{ currentSample: number; isPlaying: boolean; isBuffering?: boolean }> = []
    streamingEngine.onProgress((next) => progress.push(next))
    const session: MixerSession = {
      trackId: 'distant-loop-track',
      sampleRate: SAMPLE_RATE,
      frameCount,
      fallback: false,
      lanes: [{ laneId: 'vocals', displayName: 'Vocals', absent: false }],
      readFrames: async (startFrame, count) => {
        frameReads.push(startFrame)
        const channel = new Float32Array(count).fill(0.1)
        return [[channel, channel.slice()]]
      },
    }

    await streamingEngine.load(session)
    await flushMicrotasks()
    streamingEngine.setLaneGain('vocals', 1)
    streamingEngine.setLoopRange(createLoopRange(
      MIXER_PREFETCH_CHUNK_FRAMES * 8,
      MIXER_PREFETCH_CHUNK_FRAMES * 10,
      frameCount,
    ))
    streamingEngine.play()
    const suspended = context.suspend((MIXER_PREFETCH_CHUNK_FRAMES * 2.5) / SAMPLE_RATE)
    const rendering = context.startRendering()
    try {
      await suspended
      await waitForCondition(
        () => progress.some((next) => next.currentSample >= MIXER_PREFETCH_CHUNK_FRAMES * 2),
        'worklet progress at or beyond the second sequential chunk',
      )
      await waitForCondition(
        () => frameReads.includes(MIXER_PREFETCH_CHUNK_FRAMES * 4),
        'the fourth sequential prefetch chunk',
      )

      expect(frameReads).toContain(MIXER_PREFETCH_CHUNK_FRAMES * 4)
      expect(frameReads).not.toContain(MIXER_PREFETCH_CHUNK_FRAMES * 8)
    } finally {
      await context.resume().catch(() => undefined)
      await rendering.catch(() => undefined)
      streamingEngine.dispose()
    }
  })

  test('outputs silence and freezes the cursor while the requested frame range is unavailable', async () => {
    const context = new OfflineAudioContext(2, 128, SAMPLE_RATE)
    const streamingEngine = new WebAudioEngine({ context })
    let unblock!: (block: readonly [Float32Array, Float32Array]) => void
    let markRequested!: () => void
    const requested = new Promise<void>((resolve) => { markRequested = resolve })
    const progress: Array<{ currentSample: number; isPlaying: boolean; isBuffering?: boolean }> = []
    streamingEngine.onProgress((next) => progress.push(next))
    const session: MixerSession = {
      trackId: 'underrun-track',
      sampleRate: SAMPLE_RATE,
      frameCount: 1_000,
      fallback: false,
      lanes: [{ laneId: 'vocals', displayName: 'Vocals', absent: false }],
      readFrames: async () => {
        markRequested()
        return new Promise<readonly [Float32Array, Float32Array]>((resolve) => { unblock = resolve })
          .then(([left, right]) => [[left, right]])
      },
    }
    const loading = streamingEngine.load(session)
    try {
      await requested
      streamingEngine.setLaneGain('vocals', 1)
      streamingEngine.play()
      const rendered = await context.startRendering()
      expect([...rendered.getChannelData(0)].every((sample) => sample === 0)).toBe(true)
      expect(progress.every((next) => next.currentSample === 0)).toBe(true)
    } finally {
      const block = new Float32Array(1_000)
      unblock([block, block.slice()])
      await loading
      streamingEngine.dispose()
    }
  })

  test('keeps the cursor fixed through an OfflineAudioContext underrun, then resumes PCM playback after refill', async () => {
    const context = new OfflineAudioContext(2, 8_192, SAMPLE_RATE)
    const streamingEngine = new WebAudioEngine({ context })
    let unblock!: (block: readonly [Float32Array, Float32Array]) => void
    let markRequested!: () => void
    const requested = new Promise<void>((resolve) => { markRequested = resolve })
    const progress: Array<{ currentSample: number; isPlaying: boolean; isBuffering?: boolean }> = []
    streamingEngine.onProgress((next) => progress.push(next))
    const session: MixerSession = {
      trackId: 'offline-refill-track',
      sampleRate: SAMPLE_RATE,
      frameCount: 16_384,
      fallback: false,
      lanes: [{ laneId: 'vocals', displayName: 'Vocals', absent: false }],
      readFrames: async () => {
        markRequested()
        return new Promise<readonly [Float32Array, Float32Array]>((resolve) => { unblock = resolve })
          .then(([left, right]) => [[left, right]])
      },
    }
    const loading = streamingEngine.load(session)
    try {
      await requested
      streamingEngine.setLaneGain('vocals', 1)
      streamingEngine.setMasterGain(1)
      streamingEngine.play()
      const suspended = context.suspend(1_024 / SAMPLE_RATE)
      const rendering = context.startRendering()
      await suspended
      await waitForCondition(
        () => progress.some((next) => next.isBuffering === true && next.currentSample === 0),
        'the worklet buffering progress message',
      )

      expect(progress.some((next) => next.isBuffering === true && next.currentSample === 0)).toBe(true)
      expect(progress.every((next) => next.currentSample === 0)).toBe(true)

      const block = new Float32Array(16_384).fill(0.25)
      unblock([block, block.slice()])
      await loading
      await context.resume()
      const rendered = await rendering
      const output = rendered.getChannelData(0)
      expect(output.slice(0, 1_024).every((sample) => sample === 0)).toBe(true)
      expect(output[1_024]).toBeCloseTo(0.25, 6)
      expect(progress.some((next) => next.currentSample > 0)).toBe(true)
    } finally {
      if (unblock !== undefined) {
        const block = new Float32Array(16_384)
        unblock([block, block.slice()])
      }
      await loading.catch(() => undefined)
      streamingEngine.dispose()
    }
  })

  test('reports buffering while starved and clears it when the missing block arrives', async () => {
    const context = new AudioContext({ sampleRate: SAMPLE_RATE })
    const streamingEngine = new WebAudioEngine({ context })
    let unblock!: (block: readonly [Float32Array, Float32Array]) => void
    let markRequested!: () => void
    let rangeSignal: AbortSignal | undefined
    const requested = new Promise<void>((resolve) => { markRequested = resolve })
    const progress: Array<{ currentSample: number; isPlaying: boolean; isBuffering?: boolean }> = []
    streamingEngine.onProgress((next) => progress.push(next))
    const session: MixerSession = {
      trackId: 'starved-track',
      sampleRate: SAMPLE_RATE,
      frameCount: 16_384,
      fallback: false,
      lanes: [{ laneId: 'vocals', displayName: 'Vocals', absent: false }],
      readFrames: async (_start, _count, signal) => {
        rangeSignal = signal
        markRequested()
        return new Promise<readonly [Float32Array, Float32Array]>((resolve) => {
          unblock = (block) => resolve(block)
        }).then(([left, right]) => [[left, right]])
      },
    }
    let loading: Promise<void> | undefined
    try {
      loading = streamingEngine.load(session)
      await requested
      streamingEngine.setLaneGain('vocals', 1)
      streamingEngine.play()
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(progress.some((next) => next.isBuffering === true && next.currentSample === 0)).toBe(true)

      const block = new Float32Array(16_384).fill(0.2)
      unblock([block, block.slice()])
      await loading
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(progress.some((next) => next.isBuffering === false && next.currentSample === 0)).toBe(true)
      streamingEngine.cancelPendingReads()
      expect(rangeSignal?.aborted).toBe(true)
    } finally {
      if (unblock !== undefined) {
        const block = new Float32Array(16_384)
        unblock([block, block.slice()])
      }
      await loading?.catch(() => undefined)
      streamingEngine.dispose()
    }
  })

  test('does not transfer a partial lane range and resumes the shared cursor after the delayed lane arrives', async () => {
    const context = new OfflineAudioContext(2, 2_048, SAMPLE_RATE)
    const streamingEngine = new WebAudioEngine({ context })
    const frameCount = 5 * 16_384
    let releaseDelayedLane!: (channel: Float32Array) => void
    let markDelayedLaneRequested!: () => void
    let outstandingReads = 0
    let maxOutstandingReads = 0
    const delayedLaneRequested = new Promise<void>((resolve) => { markDelayedLaneRequested = resolve })
    const progress: Array<{ currentSample: number; isPlaying: boolean; isBuffering?: boolean }> = []
    streamingEngine.onProgress((next) => progress.push(next))
    const session: MixerSession = {
      trackId: 'synchronized-track',
      sampleRate: SAMPLE_RATE,
      frameCount,
      fallback: false,
      lanes: [
        { laneId: 'vocals', displayName: 'Vocals', absent: false },
        { laneId: 'drums', displayName: 'Drums', absent: false },
      ],
      readFrames: async (startFrame, count) => {
        outstandingReads += 1
        maxOutstandingReads = Math.max(maxOutstandingReads, outstandingReads)
        try {
          const vocals = new Float32Array(count).fill(0.1)
          const drums = startFrame === 0
            ? await new Promise<Float32Array>((resolve) => {
              releaseDelayedLane = resolve
              markDelayedLaneRequested()
            })
            : new Float32Array(count).fill(0.2)
          return [[vocals, vocals.slice()], [drums, drums.slice()]]
        } finally {
          outstandingReads -= 1
        }
      },
    }
    const loading = streamingEngine.load(session)
    try {
      await delayedLaneRequested
      const node = (streamingEngine as unknown as { node: AudioWorkletNode }).node
      const postMessage = vi.spyOn(node.port, 'postMessage')
      await flushMicrotasks()

      expect(postMessage.mock.calls.some(([message]) => {
        const chunk = message as { kind?: string; startFrame?: number }
        return chunk.kind === 'chunk' && chunk.startFrame === 0
      })).toBe(false)

      releaseDelayedLane(new Float32Array(16_384).fill(0.2))
      await loading
      streamingEngine.setLaneGain('vocals', 1)
      streamingEngine.setLaneGain('drums', 1)
      streamingEngine.setMasterGain(1)
      streamingEngine.play()
      const rendered = await render(context)

      expect(postMessage.mock.calls.some(([message]) => {
        const chunk = message as { kind?: string; startFrame?: number; lanes?: unknown[] }
        return chunk.kind === 'chunk' && chunk.startFrame === 0 && chunk.lanes?.length === 2
      })).toBe(true)
      expect(progress.some((next) => next.currentSample > 0)).toBe(true)
      expect(rendered.getChannelData(0)[0]).toBeCloseTo(0.3, 6)
      expect(maxOutstandingReads).toBeLessThanOrEqual(MIXER_PREFETCH_SLOT_COUNT)
    } finally {
      releaseDelayedLane?.(new Float32Array(16_384))
      await loading.catch(() => undefined)
      streamingEngine.dispose()
    }
  })

  test('reports a safe range failure, does not spin retries, and retries only after Play', async () => {
    const context = makeContext(64)
    const streamingEngine = new WebAudioEngine({ context })
    let rangeReads = 0
    let rejectRange!: (error: Error) => void
    let markRangeRead!: () => void
    const firstRangePending = new Promise<void>((resolve) => { markRangeRead = resolve })
    const progress: Array<{
      currentSample: number
      isPlaying: boolean
      isBuffering?: boolean
      rangeError?: string
    }> = []
    streamingEngine.onProgress((next) => progress.push(next))
    const session: MixerSession = {
      trackId: 'range-error-track',
      sampleRate: SAMPLE_RATE,
      frameCount: 64,
      fallback: false,
      lanes: [{ laneId: 'vocals', displayName: 'Vocals', absent: false }],
      readFrames: async (_startFrame, frameCount) => {
        rangeReads += 1
        if (rangeReads === 1) {
          markRangeRead()
          return new Promise<readonly [Float32Array, Float32Array][]>((_resolve, reject) => {
            rejectRange = reject
          })
        }
        const channel = new Float32Array(frameCount).fill(0.25)
        return [[channel, channel.slice()]]
      },
    }
    const loading = streamingEngine.load(session)
    try {
      await firstRangePending
      streamingEngine.setLaneGain('vocals', 1)
      streamingEngine.play()
      rejectRange(new Error('private path: C:\\Users\\person\\stems.wav'))
      await loading
      const rendered = await render(context)

      expect(rendered.getChannelData(0).every((sample) => sample === 0)).toBe(true)
      expect(progress.some((next) => next.rangeError === 'range-read-failed'
        && next.isPlaying === false && next.currentSample === 0)).toBe(true)
      expect(JSON.stringify(progress)).not.toContain('private path')
      expect(rangeReads).toBe(1)

      streamingEngine.play()
      await flushMicrotasks()
      expect(rangeReads).toBe(2)
    } finally {
      rejectRange?.(new Error('test cleanup'))
      await loading.catch(() => undefined)
      streamingEngine.dispose()
    }
  })

  test('discards a late chunk from the cancelled track after a replacement session loads', async () => {
    const context = makeContext(64)
    const streamingEngine = new WebAudioEngine({ context })
    const lateBlocks: Array<() => void> = []
    const oldSignals: AbortSignal[] = []
    const oldSession: MixerSession = {
      trackId: 'old-track',
      sampleRate: SAMPLE_RATE,
      frameCount: 64,
      fallback: false,
      lanes: [{ laneId: 'vocals', displayName: 'Vocals', absent: false }],
      readFrames: async (_startFrame, frameCount, signal) => {
        if (signal !== undefined) oldSignals.push(signal)
        return new Promise<readonly [Float32Array, Float32Array]>((resolve) => {
          lateBlocks.push(() => resolve([new Float32Array(frameCount).fill(0.9), new Float32Array(frameCount).fill(0.9)]))
        })
          .then(([left, right]) => [[left, right]])
      },
    }
    const oldLoading = streamingEngine.load(oldSession)
    try {
      while (lateBlocks.length < 1) await new Promise((resolve) => setTimeout(resolve, 1))
      const oldNode = (streamingEngine as unknown as { node: AudioWorkletNode }).node
      const oldPostMessage = vi.spyOn(oldNode.port, 'postMessage')
      const replacementChannel = new Float32Array(64).fill(0.4)
      const replacement: MixerSession = {
        trackId: 'new-track',
        sampleRate: SAMPLE_RATE,
        frameCount: 64,
        fallback: false,
        lanes: [{ laneId: 'vocals', displayName: 'Vocals', absent: false }],
        readFrames: async () => [[replacementChannel, replacementChannel.slice()]],
      }
      await streamingEngine.load(replacement)

      expect(oldSignals.every((signal) => signal.aborted)).toBe(true)
      for (const resolve of lateBlocks) resolve()
      await oldLoading

      expect(oldPostMessage.mock.calls.some(([message]) => (message as { kind?: string }).kind === 'chunk')).toBe(false)
      const newNode = (streamingEngine as unknown as { node: AudioWorkletNode }).node
      const newPostMessage = vi.spyOn(newNode.port, 'postMessage')
      streamingEngine.setLaneGain('vocals', 1)
      streamingEngine.setMasterGain(1)
      streamingEngine.play()
      const rendered = await render(context)
      expect(rendered.getChannelData(0)[0]).toBeCloseTo(0.4, 6)
      expect(newPostMessage.mock.calls.map(([message]) => (message as { kind?: string }).kind)).not.toContain('flush')
    } finally {
      for (const resolve of lateBlocks) resolve()
      await oldLoading.catch(() => undefined)
      streamingEngine.dispose()
    }
  })

  test('shares a delayed module load and prevents an older session from replacing the newer one', async () => {
    const context = makeContext(64)
    let releaseModule!: () => void
    const moduleGate = new Promise<void>((resolve) => { releaseModule = resolve })
    const loadProcessorModule = vi.fn(async (target: BaseAudioContext, url: string | URL) => {
      await moduleGate
      await target.audioWorklet.addModule(url)
    })
    const streamingEngine = new WebAudioEngine({ context, loadProcessorModule })
    const olderLoad = streamingEngine.load(makeSession([lane('older-lane', 0.1, 64)], 64))
    const newerLoad = streamingEngine.load(makeSession([lane('newer-lane', 0.4, 64)], 64))

    try {
      await flushMicrotasks()
      expect(loadProcessorModule).toHaveBeenCalledOnce()
      releaseModule()
      await Promise.all([olderLoad, newerLoad])

      expect(() => streamingEngine.setLaneGain('newer-lane', 1)).not.toThrow()
      expect(() => streamingEngine.setLaneGain('older-lane', 1))
        .toThrow('web-audio-engine.failed:unknown_lane:older-lane')
    } finally {
      releaseModule()
      await Promise.all([olderLoad.catch(() => undefined), newerLoad.catch(() => undefined)])
      streamingEngine.dispose()
    }
  })

  test('does not install a session when module loading resolves after cancellation', async () => {
    const context = makeContext(64)
    let releaseModule!: () => void
    const moduleGate = new Promise<void>((resolve) => { releaseModule = resolve })
    const loadProcessorModule = vi.fn(async () => moduleGate)
    const streamingEngine = new WebAudioEngine({ context, loadProcessorModule })
    const pendingLoad = streamingEngine.load(makeSession([lane('cancelled-lane', 0.1, 64)], 64))

    try {
      await flushMicrotasks()
      streamingEngine.cancelPendingReads()
      releaseModule()
      await pendingLoad
      expect(() => streamingEngine.play()).toThrow('web-audio-engine.failed:no_session_loaded')
    } finally {
      releaseModule()
      await pendingLoad.catch(() => undefined)
      streamingEngine.dispose()
    }
  })

  test('does not revive a disposed engine when its pending module load resolves late', async () => {
    const context = makeContext(64)
    let releaseModule!: () => void
    const moduleGate = new Promise<void>((resolve) => { releaseModule = resolve })
    const loadProcessorModule = vi.fn(async () => moduleGate)
    const streamingEngine = new WebAudioEngine({ context, loadProcessorModule })
    const pendingLoad = streamingEngine.load(makeSession([lane('disposed-lane', 0.1, 64)], 64))

    try {
      await flushMicrotasks()
      streamingEngine.dispose()
      releaseModule()
      await pendingLoad
      expect(() => streamingEngine.play()).toThrow('web-audio-engine.failed:no_session_loaded')
      await expect(streamingEngine.load(makeSession([lane('after-dispose', 0.2, 64)], 64)))
        .rejects.toThrow('web-audio-engine.failed:disposed')
    } finally {
      releaseModule()
      await pendingLoad.catch(() => undefined)
      streamingEngine.dispose()
    }
  })
})

describe('WebAudioEngine real-time context activation (Chromium)', () => {
  test('resumes a suspended real-time context from Play before reporting playback', async () => {
    const context = new AudioContext({ sampleRate: SAMPLE_RATE })
    const engine = new WebAudioEngine({ context })

    try {
      await engine.load(makeSession([lane('vocals', 0.3)]))
      await context.suspend()
      const resume = vi.spyOn(context, 'resume').mockResolvedValue()
      const node = (engine as unknown as { node: AudioWorkletNode }).node
      const postMessage = vi.spyOn(node.port, 'postMessage')

      engine.play()

      expect(resume).toHaveBeenCalledOnce()
      expect(postMessage.mock.calls.map(([message]) => (message as { kind: string }).kind)).not.toContain('play')
      await Promise.resolve()
      expect(postMessage.mock.calls.map(([message]) => (message as { kind: string }).kind)).toContain('play')
    } finally {
      engine.dispose()
    }
  })

  test('does not report playback when resuming the real-time context fails', async () => {
    const context = new AudioContext({ sampleRate: SAMPLE_RATE })
    const engine = new WebAudioEngine({ context })

    try {
      await engine.load(makeSession([lane('vocals', 0.3)]))
      await context.suspend()
      vi.spyOn(context, 'resume').mockRejectedValue(new Error('resume blocked'))
      const node = (engine as unknown as { node: AudioWorkletNode }).node
      const postMessage = vi.spyOn(node.port, 'postMessage')

      engine.play()
      await Promise.resolve()

      expect(postMessage.mock.calls.map(([message]) => (message as { kind: string }).kind)).not.toContain('play')
    } finally {
      engine.dispose()
    }
  })

  test('keeps the latest pause intent when Play is waiting for context resume', async () => {
    const context = new AudioContext({ sampleRate: SAMPLE_RATE })
    const engine = new WebAudioEngine({ context })

    try {
      await engine.load(makeSession([lane('vocals', 0.3)]))
      await context.suspend()
      let resolveResume!: () => void
      vi.spyOn(context, 'resume').mockImplementation(() => new Promise<void>((resolve) => {
        resolveResume = resolve
      }))
      const node = (engine as unknown as { node: AudioWorkletNode }).node
      const postMessage = vi.spyOn(node.port, 'postMessage')

      engine.play()
      engine.pause()
      resolveResume()
      await Promise.resolve()

      expect(postMessage.mock.calls.map(([message]) => (message as { kind: string }).kind)).toEqual(['pause'])
    } finally {
      engine.dispose()
    }
  })

  test('does not call resume when the real-time context is already running', async () => {
    const context = new AudioContext({ sampleRate: SAMPLE_RATE })
    const engine = new WebAudioEngine({ context })

    try {
      await engine.load(makeSession([lane('vocals', 0.3)]))
      Object.defineProperty(context, 'state', { configurable: true, value: 'running' })
      const resume = vi.spyOn(context, 'resume')
      const node = (engine as unknown as { node: AudioWorkletNode }).node
      const postMessage = vi.spyOn(node.port, 'postMessage')

      engine.play()

      expect(resume).not.toHaveBeenCalled()
      expect(postMessage.mock.calls.map(([message]) => (message as { kind: string }).kind)).toContain('play')
    } finally {
      engine.dispose()
    }
  })
})
