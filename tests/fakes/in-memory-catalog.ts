import type { CatalogPort } from '../../src/application/ports/catalog-port'
import type { Track } from '../../src/domain/track'

export class InMemoryCatalog implements CatalogPort {
  private readonly tracksById = new Map<string, Track>()

  async listAll(): Promise<readonly Track[]> {
    return [...this.tracksById.values()]
  }

  async getById(trackId: string): Promise<Track | undefined> {
    return this.tracksById.get(trackId)
  }

  async insert(track: Track): Promise<void> {
    this.tracksById.set(track.trackId, track)
  }

  async update(track: Track): Promise<void> {
    this.tracksById.set(track.trackId, track)
  }

  async remove(trackId: string): Promise<void> {
    this.tracksById.delete(trackId)
  }
}
