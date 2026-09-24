import type { CatalogPort } from '../../application/ports/catalog-port'
import type { Track } from '../../domain/track'

const DEFAULT_DATABASE_NAME = 'stemslayer'
const DB_VERSION = 1
const STORE_NAME = 'tracks'
const BY_IDENTITY_INDEX = 'by_identity'
const BY_CREATED_AT_INDEX = 'by_createdAt'

/** Thrown by `insert` when a row with the same `trackId` already exists. */
export class DuplicateTrackIdError extends Error {
  constructor(readonly trackId: string) {
    super(`indexeddb-catalog.duplicate_track_id:${trackId}`)
    this.name = 'DuplicateTrackIdError'
  }
}

/** Thrown by `update` when no row with the given `trackId` exists. */
export class TrackNotFoundError extends Error {
  constructor(readonly trackId: string) {
    super(`indexeddb-catalog.track_not_found:${trackId}`)
    this.name = 'TrackNotFoundError'
  }
}

/**
 * Thrown when a write collides with the unique `by_identity` index on
 * `[sourceHash, pipelineFingerprint]`. This is the safety net under the Web
 * Lock identity-claim sequence, never the primary mechanism
 * (`docs/decisions/browser-storage.md` section 1).
 */
export class IdentityCollisionError extends Error {
  constructor(readonly sourceHash: string, readonly pipelineFingerprint: string) {
    super(`indexeddb-catalog.identity_collision:${sourceHash}:${pipelineFingerprint}`)
    this.name = 'IdentityCollisionError'
  }
}

function openDatabase(databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (db.objectStoreNames.contains(STORE_NAME)) return
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'trackId' })
      store.createIndex(BY_IDENTITY_INDEX, ['sourceHash', 'pipelineFingerprint'], { unique: true })
      store.createIndex(BY_CREATED_AT_INDEX, 'createdAtUtc')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexeddb-catalog.open_failed'))
  })
}

function freezeTrack(record: Track): Track {
  return Object.freeze({ ...record })
}

function rejectionFor(track: Track, request: IDBRequest, fallbackMessage: string): Error {
  if (request.error?.name === 'ConstraintError' && track.sourceHash !== undefined) {
    return new IdentityCollisionError(track.sourceHash, track.pipelineFingerprint)
  }
  return request.error ?? new Error(fallbackMessage)
}

/**
 * `CatalogPort` over one IndexedDB database (`stemslayer`, version 1),
 * object store `tracks` keyed by `trackId`
 * (`docs/decisions/browser-storage.md` section 1).
 */
export class IndexedDbCatalog implements CatalogPort {
  private readonly dbPromise: Promise<IDBDatabase>

  constructor(databaseName: string = DEFAULT_DATABASE_NAME) {
    this.dbPromise = openDatabase(databaseName)
  }

  /** Closes the underlying connection; not part of `CatalogPort`, for lifecycle management (tests, shutdown). */
  async close(): Promise<void> {
    const db = await this.dbPromise
    db.close()
  }

  async listAll(): Promise<readonly Track[]> {
    const db = await this.dbPromise
    return new Promise((resolve, reject) => {
      const store = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME)
      const tracks: Track[] = []
      const request = store.index(BY_CREATED_AT_INDEX).openCursor(null, 'prev')
      request.onsuccess = () => {
        const cursor = request.result
        if (cursor === null) {
          resolve(tracks)
          return
        }
        tracks.push(freezeTrack(cursor.value as Track))
        cursor.continue()
      }
      request.onerror = () => reject(request.error ?? new Error('indexeddb-catalog.list_failed'))
    })
  }

  async getById(trackId: string): Promise<Track | undefined> {
    const db = await this.dbPromise
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(trackId)
      request.onsuccess = () => {
        const result = request.result as Track | undefined
        resolve(result === undefined ? undefined : freezeTrack(result))
      }
      request.onerror = () => reject(request.error ?? new Error('indexeddb-catalog.get_failed'))
    })
  }

  async insert(track: Track): Promise<void> {
    const existing = await this.getById(track.trackId)
    if (existing !== undefined) {
      throw new DuplicateTrackIdError(track.trackId)
    }
    const db = await this.dbPromise
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).add(track)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(rejectionFor(track, request, 'indexeddb-catalog.insert_failed'))
    })
  }

  async update(track: Track): Promise<void> {
    const existing = await this.getById(track.trackId)
    if (existing === undefined) {
      throw new TrackNotFoundError(track.trackId)
    }
    const db = await this.dbPromise
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(track)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(rejectionFor(track, request, 'indexeddb-catalog.update_failed'))
    })
  }

  async remove(trackId: string): Promise<void> {
    const db = await this.dbPromise
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(trackId)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error ?? new Error('indexeddb-catalog.remove_failed'))
    })
  }
}
