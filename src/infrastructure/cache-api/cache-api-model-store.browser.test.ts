import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  CacheApiModelStore,
  ModelDigestMismatchError,
  ModelDownloadError,
  ModelSizeMismatchError,
  ModelStreamError,
  UnknownModelProfileError,
  cacheNameForModel,
} from './cache-api-model-store'
import {
  PINNED_MODEL_MANIFEST,
  type PinnedModelManifest,
  type PinnedModelManifestEntry,
} from './model-manifest'

const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

const entry: PinnedModelManifestEntry = Object.freeze({
  profileId: 'test-profile',
  revision: 'test-revision',
  url: 'https://models.example/test-revision/model.onnx',
  sizeBytes: 3,
  sha256: ABC_SHA256,
})
const manifest: PinnedModelManifest = Object.freeze({ [entry.profileId]: entry })

const responseWithChunks = (...chunks: readonly Uint8Array[]): Response => new Response(
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  }),
  { status: 200 },
)

const fetchReturning = (response: Response): typeof fetch => vi.fn(async () => response)

afterEach(async () => {
  await Promise.all((await caches.keys())
    .filter((name) => name.startsWith('stemslayer-model-'))
    .map((name) => caches.delete(name)))
})

describe('pinned model manifest', () => {
  test('pins the Basic and Rock mirror revisions, sizes, digests, and URLs', () => {
    expect(PINNED_MODEL_MANIFEST['legacy-four-stem']).toEqual({
      profileId: 'legacy-four-stem',
      revision: '850cd89461d0817276337061c29e6abceb86d75f',
      url: 'https://huggingface.co/Ghilda/htdemucs-onnx/resolve/850cd89461d0817276337061c29e6abceb86d75f/htdemucs.onnx',
      sizeBytes: 174_266_088,
      sha256: 'e528a932a7d091e15938369135569884b62c2193fb11044c3d4a0d4c7b9221af',
    })
    expect(PINNED_MODEL_MANIFEST['metal-stereo-six-stem']).toEqual({
      profileId: 'metal-stereo-six-stem',
      revision: '0c850a01007f48d94900b21b49a0d0ae1a17239f',
      url: 'https://huggingface.co/kramp/htdemucs-6s-webgpu-onnx/resolve/0c850a01007f48d94900b21b49a0d0ae1a17239f/htdemucs_6s.onnx',
      sizeBytes: 284_797_240,
      sha256: 'a3f5050696cda4b2344d465123acb21ee699dad7d0634dba1d282497a04ac86a',
    })
    expect(Object.isFrozen(PINNED_MODEL_MANIFEST)).toBe(true)
    expect(Object.values(PINNED_MODEL_MANIFEST).every(Object.isFrozen)).toBe(true)
  })
})

describe('CacheApiModelStore', () => {
  test('rejects an unknown profile without opening the network', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const store = new CacheApiModelStore({ manifest, cacheStorage: caches, fetcher })

    await expect(store.ensure('unknown', vi.fn())).rejects.toBeInstanceOf(UnknownModelProfileError)
    await expect(store.getFootprint('unknown')).rejects.toBeInstanceOf(UnknownModelProfileError)
    expect(fetcher).not.toHaveBeenCalled()
  })

  test('streams a cold download with monotonic byte progress and caches verified bytes', async () => {
    const fetcher = fetchReturning(responseWithChunks(
      new Uint8Array([97]),
      new Uint8Array([98, 99]),
    ))
    const store = new CacheApiModelStore({ manifest, cacheStorage: caches, fetcher })
    const progress = vi.fn()

    await store.ensure(entry.profileId, progress)

    expect(progress.mock.calls.map(([value]) => value)).toEqual([
      { receivedBytes: 1, totalBytes: 3 },
      { receivedBytes: 3, totalBytes: 3 },
    ])
    expect(fetcher).toHaveBeenCalledOnce()
    const cached = await (await caches.open(cacheNameForModel(entry))).match(entry.url)
    expect(new Uint8Array(await cached!.arrayBuffer())).toEqual(new Uint8Array([97, 98, 99]))
    await expect(store.getFootprint(entry.profileId)).resolves.toEqual({ cached: true, sizeBytes: 3 })
  })

  test('uses a verified cache hit without network access or progress', async () => {
    const cache = await caches.open(cacheNameForModel(entry))
    await cache.put(entry.url, new Response(new Uint8Array([97, 98, 99])))
    const fetcher = vi.fn<typeof fetch>()
    const progress = vi.fn()
    const store = new CacheApiModelStore({ manifest, cacheStorage: caches, fetcher })

    await store.ensure(entry.profileId, progress)

    expect(fetcher).not.toHaveBeenCalled()
    expect(progress).not.toHaveBeenCalled()
  })

  test('fails closed with a typed download error when fetch rejects or returns an error', async () => {
    const rejectedFetch = vi.fn<typeof fetch>(async () => { throw new Error('offline') })
    const rejectedStore = new CacheApiModelStore({ manifest, cacheStorage: caches, fetcher: rejectedFetch })
    await expect(rejectedStore.ensure(entry.profileId, vi.fn())).rejects.toBeInstanceOf(ModelDownloadError)

    const failedStore = new CacheApiModelStore({
      manifest,
      cacheStorage: caches,
      fetcher: fetchReturning(new Response(null, { status: 503 })),
    })
    await expect(failedStore.ensure(entry.profileId, vi.fn())).rejects.toBeInstanceOf(ModelDownloadError)
  })

  test('fails closed with a typed stream error and removes the partial entry', async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([97]))
        controller.error(new Error('stream interrupted'))
      },
    }))
    const store = new CacheApiModelStore({ manifest, cacheStorage: caches, fetcher: fetchReturning(response) })

    await expect(store.ensure(entry.profileId, vi.fn())).rejects.toBeInstanceOf(ModelStreamError)
    expect(await (await caches.open(cacheNameForModel(entry))).match(entry.url)).toBeUndefined()
  })

  test('removes a newly cached entry and reports a typed size mismatch', async () => {
    const store = new CacheApiModelStore({
      manifest,
      cacheStorage: caches,
      fetcher: fetchReturning(responseWithChunks(new Uint8Array([97, 98]))),
    })

    await expect(store.ensure(entry.profileId, vi.fn())).rejects.toBeInstanceOf(ModelSizeMismatchError)
    expect(await (await caches.open(cacheNameForModel(entry))).match(entry.url)).toBeUndefined()
  })

  test('removes a newly cached entry and reports a typed digest mismatch', async () => {
    const wrongDigestEntry = Object.freeze({ ...entry, sha256: '0'.repeat(64) })
    const wrongManifest = Object.freeze({ [entry.profileId]: wrongDigestEntry })
    const store = new CacheApiModelStore({
      manifest: wrongManifest,
      cacheStorage: caches,
      fetcher: fetchReturning(responseWithChunks(new Uint8Array([97, 98, 99]))),
    })

    await expect(store.ensure(entry.profileId, vi.fn())).rejects.toBeInstanceOf(ModelDigestMismatchError)
    expect(await (await caches.open(cacheNameForModel(wrongDigestEntry))).match(entry.url)).toBeUndefined()
  })
})
