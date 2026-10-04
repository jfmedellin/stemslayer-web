import type { StemStorePort } from '../../src/application/ports/stem-store-port'
import { encodeFloat32Wav } from '../../src/domain/audio/float32-wav'

function laneKey(resultKey: string, laneId: string): string {
  return `${resultKey}/${laneId}`
}

export class InMemoryStemStore implements StemStorePort {
  private readonly keys = new Set<string>()
  private readonly failingKeys = new Set<string>()
  private readonly lanes = new Map<string, Uint8Array>()

  async writeLane(resultKey: string, laneId: string, audio: Uint8Array): Promise<void> {
    this.lanes.set(laneKey(resultKey, laneId), audio)
    this.keys.add(resultKey)
    this.keys.add(laneKey(resultKey, laneId))
  }

  async beginLaneWrite(resultKey: string, laneId: string, sampleRate: number, frameCount: number) {
    const chunks: Float32Array[][] = [[], []]
    let frames = 0
    let done = false
    return {
      writeChunk: async (planar: readonly Float32Array[]): Promise<void> => {
        if (done || planar.length !== 2 || planar[0].length !== planar[1].length) {
          throw new Error('stem-store.invalid_stream_chunk')
        }
        frames += planar[0].length
        if (frames > frameCount) throw new Error('stem-store.too_many_frames')
        chunks[0].push(planar[0].slice())
        chunks[1].push(planar[1].slice())
      },
      finalize: async (): Promise<void> => {
        if (done || frames !== frameCount) throw new Error('stem-store.incomplete_stream')
        const planar = chunks.map((parts) => {
          const channel = new Float32Array(frameCount)
          let offset = 0
          for (const part of parts) { channel.set(part, offset); offset += part.length }
          return channel
        })
        await this.writeLane(resultKey, laneId, encodeFloat32Wav({ sampleRate, planar }))
        done = true
      },
      abort: async (): Promise<void> => {
        done = true
      },
    }
  }

  async readLane(resultKey: string, laneId: string): Promise<Uint8Array> {
    const audio = this.lanes.get(laneKey(resultKey, laneId))
    if (audio === undefined) {
      throw new Error(`stem-store.lane_not_found:${laneKey(resultKey, laneId)}`)
    }
    return audio
  }

  async delete(resultKey: string): Promise<void> {
    if (this.failingKeys.has(resultKey)) {
      this.failingKeys.delete(resultKey)
      throw new Error(`stem-store.delete_failed:${resultKey}`)
    }
    this.keys.delete(resultKey)
    for (const key of [...this.lanes.keys()]) {
      if (key === resultKey || key.startsWith(`${resultKey}/`)) this.lanes.delete(key)
    }
    for (const key of [...this.keys]) {
      if (key.startsWith(`${resultKey}/`)) this.keys.delete(key)
    }
  }

  async exists(resultKey: string): Promise<boolean> {
    return this.keys.has(resultKey)
  }

  async listResultKeys(): Promise<readonly string[]> {
    return [...this.keys]
  }

  seed(resultKey: string): void {
    this.keys.add(resultKey)
  }

  has(resultKey: string): boolean {
    return this.keys.has(resultKey)
  }

  failNextDeleteFor(resultKey: string): void {
    this.failingKeys.add(resultKey)
  }
}
