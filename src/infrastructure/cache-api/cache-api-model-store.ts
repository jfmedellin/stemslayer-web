import type {
  ModelDownloadProgress,
  ModelFootprint,
  ModelStorePort,
} from '../../application/ports/model-store-port'
import { WebCryptoHash } from '../web-crypto/web-crypto-hash'
import {
  PINNED_MODEL_MANIFEST,
  type PinnedModelManifest,
  type PinnedModelManifestEntry,
} from './model-manifest'

const CACHE_PREFIX = 'stemslayer-model-'

export class UnknownModelProfileError extends Error {
  constructor(readonly profileId: string) {
    super(`model-store.unknown_profile:${profileId}`)
    this.name = 'UnknownModelProfileError'
  }
}

export class ModelDownloadError extends Error {
  constructor(readonly profileId: string, readonly status?: number, diagnosticMessage?: string) {
    const identity = status === undefined
      ? `model-store.download_failed:${profileId}`
      : `model-store.download_failed:${profileId}:${status}`
    super(diagnosticMessage === undefined ? identity : `${identity}: ${diagnosticMessage}`)
    this.name = 'ModelDownloadError'
  }
}

function safeDownloadDiagnostic(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined
  // Control characters are stripped on purpose: a diagnostic copied from a
  // rejected response body must not smuggle line breaks or terminal escapes
  // into logs. Those regex literals are the intent, not a typo.
  // eslint-disable-next-line no-control-regex
  const message = error.message.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
  return message.length === 0 ? undefined : message.slice(0, 240)
}

export class ModelStreamError extends Error {
  constructor(readonly profileId: string) {
    super(`model-store.stream_failed:${profileId}`)
    this.name = 'ModelStreamError'
  }
}

export class ModelSizeMismatchError extends Error {
  constructor(
    readonly profileId: string,
    readonly expectedBytes: number,
    readonly actualBytes: number,
  ) {
    super(`model-store.size_mismatch:${profileId}:${expectedBytes}:${actualBytes}`)
    this.name = 'ModelSizeMismatchError'
  }
}

export class ModelDigestMismatchError extends Error {
  constructor(readonly profileId: string, readonly expected: string, readonly actual: string) {
    super(`model-store.digest_mismatch:${profileId}:${expected}:${actual}`)
    this.name = 'ModelDigestMismatchError'
  }
}

export class ModelCacheWriteError extends Error {
  constructor(readonly profileId: string) {
    super(`model-store.cache_write_failed:${profileId}`)
    this.name = 'ModelCacheWriteError'
  }
}

export class ModelNotCachedError extends Error {
  constructor(readonly profileId: string) {
    super(`model-store.not_cached:${profileId}`)
    this.name = 'ModelNotCachedError'
  }
}

export class ModelCacheReadError extends Error {
  constructor(readonly profileId: string, readonly status?: number) {
    super(status === undefined
      ? `model-store.cache_read_failed:${profileId}`
      : `model-store.cache_read_failed:${profileId}:${status}`)
    this.name = 'ModelCacheReadError'
  }
}

export interface CacheApiModelStoreOptions {
  readonly manifest?: PinnedModelManifest
  readonly cacheStorage?: CacheStorage
  readonly fetcher?: typeof fetch
}

function cachePrefixForProfile(profileId: string): string {
  return `${CACHE_PREFIX}${encodeURIComponent(profileId)}@`
}

export function cacheNameForModel(entry: PinnedModelManifestEntry): string {
  return `${cachePrefixForProfile(entry.profileId)}${entry.revision}`
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function combine(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** Cache API implementation that exposes only size- and SHA-256-verified model bytes. */
export class CacheApiModelStore implements ModelStorePort {
  private readonly manifest: PinnedModelManifest
  private readonly cacheStorage: CacheStorage
  private readonly fetcher: typeof fetch
  private readonly hash = new WebCryptoHash()

  constructor(options: CacheApiModelStoreOptions = {}) {
    this.manifest = options.manifest ?? PINNED_MODEL_MANIFEST
    this.cacheStorage = options.cacheStorage ?? caches
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  }

  async getFootprint(profileId: string): Promise<ModelFootprint> {
    const entry = this.resolve(profileId)
    const cache = await this.cacheStorage.open(cacheNameForModel(entry))
    const cached = await cache.match(entry.url)
    if (cached === undefined) return Object.freeze({ cached: false, sizeBytes: entry.sizeBytes })

    try {
      await this.verify(entry, new Uint8Array(await cached.arrayBuffer()))
      return Object.freeze({ cached: true, sizeBytes: entry.sizeBytes })
    } catch (error) {
      await cache.delete(entry.url)
      if (error instanceof ModelSizeMismatchError || error instanceof ModelDigestMismatchError) {
        return Object.freeze({ cached: false, sizeBytes: entry.sizeBytes })
      }
      throw error
    }
  }

  async ensure(
    profileId: string,
    onProgress: (progress: ModelDownloadProgress) => void,
  ): Promise<void> {
    const entry = this.resolve(profileId)
    const cache = await this.cacheStorage.open(cacheNameForModel(entry))
    const cached = await cache.match(entry.url)
    if (cached !== undefined) {
      try {
        await this.verify(entry, new Uint8Array(await cached.arrayBuffer()))
        await this.removeObsoleteRevisions(entry)
        return
      } catch (error) {
        await cache.delete(entry.url)
        if (!(error instanceof ModelSizeMismatchError || error instanceof ModelDigestMismatchError)) throw error
      }
    }

    const bytes = await this.download(entry, onProgress)
    try {
      await cache.put(entry.url, new Response(toArrayBuffer(bytes)))
    } catch {
      await cache.delete(entry.url)
      throw new ModelCacheWriteError(entry.profileId)
    }

    try {
      const stored = await cache.match(entry.url)
      if (stored === undefined) throw new ModelCacheWriteError(entry.profileId)
      await this.verify(entry, new Uint8Array(await stored.arrayBuffer()))
    } catch (error) {
      await cache.delete(entry.url)
      throw error
    }
    await this.removeObsoleteRevisions(entry)
  }

  async read(profileId: string): Promise<Uint8Array> {
    const entry = this.resolve(profileId)
    const cache = await this.cacheStorage.open(cacheNameForModel(entry))
    const cached = await cache.match(entry.url)
    if (cached === undefined) throw new ModelNotCachedError(profileId)

    try {
      if (!cached.ok || cached.body === null) {
        throw new ModelCacheReadError(profileId, cached.status)
      }
      const bytes = new Uint8Array(await cached.arrayBuffer())
      await this.verify(entry, bytes)
      return bytes.slice()
    } catch (error) {
      await cache.delete(entry.url)
      if (
        error instanceof ModelCacheReadError
        || error instanceof ModelSizeMismatchError
        || error instanceof ModelDigestMismatchError
      ) {
        throw error
      }
      throw new ModelCacheReadError(profileId)
    }
  }

  private resolve(profileId: string): PinnedModelManifestEntry {
    const entry = this.manifest[profileId]
    if (entry === undefined) throw new UnknownModelProfileError(profileId)
    return entry
  }

  private async download(
    entry: PinnedModelManifestEntry,
    onProgress: (progress: ModelDownloadProgress) => void,
  ): Promise<Uint8Array> {
    let response: Response
    try {
      response = await this.fetcher(entry.url)
    } catch (error) {
      throw new ModelDownloadError(entry.profileId, undefined, safeDownloadDiagnostic(error))
    }
    if (!response.ok) throw new ModelDownloadError(entry.profileId, response.status)
    if (response.body === null) throw new ModelStreamError(entry.profileId)

    const chunks: Uint8Array[] = []
    let receivedBytes = 0
    const reader = response.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        receivedBytes += value.byteLength
        onProgress(Object.freeze({ receivedBytes, totalBytes: entry.sizeBytes }))
      }
    } catch {
      throw new ModelStreamError(entry.profileId)
    } finally {
      reader.releaseLock()
    }
    return combine(chunks, receivedBytes)
  }

  private async verify(entry: PinnedModelManifestEntry, bytes: Uint8Array): Promise<void> {
    if (bytes.byteLength !== entry.sizeBytes) {
      throw new ModelSizeMismatchError(entry.profileId, entry.sizeBytes, bytes.byteLength)
    }
    const digest = await this.hash.sha256(bytes)
    if (digest !== entry.sha256) {
      throw new ModelDigestMismatchError(entry.profileId, entry.sha256, digest)
    }
  }

  private async removeObsoleteRevisions(entry: PinnedModelManifestEntry): Promise<void> {
    const current = cacheNameForModel(entry)
    const profilePrefix = cachePrefixForProfile(entry.profileId)
    const obsolete = (await this.cacheStorage.keys())
      .filter((name) => name.startsWith(profilePrefix) && name !== current)
    await Promise.all(obsolete.map((name) => this.cacheStorage.delete(name)))
  }
}
