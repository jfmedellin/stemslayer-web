import { describe, expect, test } from 'vitest'

import { InferenceCancelled } from '../../src/application/ports/inference-port'
import { BASIC_PROFILE } from '../../src/domain/stem-profile'
import { FakeInference } from './fake-inference'
import { InMemoryStemStore } from './in-memory-stem-store'

const job = {
  trackId: 'track-1',
  profile: BASIC_PROFILE,
  source: new Uint8Array([1, 2, 3]),
  resultKey: 'stems/track-1',
}

describe('FakeInference', () => {
  test('hangs until terminated when no script is configured', async () => {
    const stemStore = new InMemoryStemStore()
    const inference = new FakeInference(stemStore)

    const handle = inference.run(job, () => {})
    let settled = false
    void handle.result.finally(() => {
      settled = true
    }).catch(() => {})
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)

    handle.terminate()

    await expect(handle.result).rejects.toBeInstanceOf(InferenceCancelled)
  })

  test('resolves with the scripted lane keys and writes them into the stem store', async () => {
    const stemStore = new InMemoryStemStore()
    const inference = new FakeInference(stemStore)
    const laneKeys = ['stems/track-1/vocals', 'stems/track-1/drums', 'stems/track-1/bass', 'stems/track-1/other']
    inference.scriptSuccess('track-1', laneKeys)
    const progressEvents: unknown[] = []

    const handle = inference.run(job, (progress) => progressEvents.push(progress))

    await expect(handle.result).resolves.toEqual(laneKeys)
    expect(progressEvents.length).toBeGreaterThan(0)
    for (const key of laneKeys) {
      await expect(stemStore.exists(key)).resolves.toBe(true)
    }
    expect(inference.writtenLaneKeysByTrackId.get('track-1')).toEqual(laneKeys)
  })

  test('rejects with the scripted failure', async () => {
    const stemStore = new InMemoryStemStore()
    const inference = new FakeInference(stemStore)
    const failure = new Error('inference.crashed')
    inference.scriptFailure('track-1', failure)

    const handle = inference.run(job, () => {})

    await expect(handle.result).rejects.toBe(failure)
  })

  test('terminate on an already-scripted success still rejects with InferenceCancelled if called before it settles', async () => {
    const stemStore = new InMemoryStemStore()
    const inference = new FakeInference(stemStore)
    inference.scriptSuccess('track-1', ['stems/track-1/vocals'])

    const handle = inference.run(job, () => {})
    handle.terminate()

    await expect(handle.result).rejects.toBeInstanceOf(InferenceCancelled)
  })
})
