import type { StemLaneInfo, StemStorePort } from '../../src/application/ports/stem-store-port'
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

  async readLaneFile(resultKey: string, laneId: string): Promise<File> {
    const bytes = this.lanes.get(laneKey(resultKey, laneId))
    if (bytes === undefined) throw new Error(`stem-store.lane_not_found:${laneKey(resultKey, laneId)}`)
    return new File([bytes.slice().buffer as ArrayBuffer], `${laneId}.wav`)
  }

  async openLaneStream(resultKey: string, laneId: string): Promise<ReadableStream<Uint8Array>> {
    return (await this.readLaneFile(resultKey, laneId)).stream()
  }

  async createExportArchive() {
    const chunks: Uint8Array[] = []
    let closed = false
    const remove = (): void => { chunks.length = 0; closed = true }
    return {
      write: async (chunk: Uint8Array): Promise<void> => {
        if (closed) throw new Error('fake-stem-store.export_not_open')
        chunks.push(chunk.slice())
      },
      complete: async (): Promise<File> => {
        if (closed) throw new Error('fake-stem-store.export_not_open')
        const file = new File(chunks.map((chunk) => chunk.slice().buffer as ArrayBuffer), 'stems.zip')
        remove()
        return file
      },
      abort: async (): Promise<void> => { remove() },
      release: async (): Promise<void> => { remove() },
    }
  }

  async readLaneInfo(resultKey: string, laneId: string): Promise<StemLaneInfo> {
    const bytes = await this.readLane(resultKey, laneId)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return { sampleRate: view.getUint32(24, true), frameCount: view.getUint32(40, true) / 8 }
  }

  async readLaneFrames(
    resultKey: string,
    laneId: string,
    startFrame: number,
    frameCount: number,
  ): Promise<readonly [Float32Array, Float32Array]> {
    const bytes = await this.readLane(resultKey, laneId)
    const endFrame = startFrame + frameCount
    const payload = bytes.subarray(44 + startFrame * 8, 44 + endFrame * 8)
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
    const left = new Float32Array(frameCount)
    const right = new Float32Array(frameCount)
    for (let frame = 0; frame < frameCount; frame += 1) {
      left[frame] = view.getFloat32(frame * 8, true)
      right[frame] = view.getFloat32(frame * 8 + 4, true)
    }
    return [left, right]
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
