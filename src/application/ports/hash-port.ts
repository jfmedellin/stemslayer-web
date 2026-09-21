export interface HashPort {
  sha256(input: Uint8Array): Promise<string>
}
