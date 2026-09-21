export interface PinnedModelManifestEntry {
  readonly profileId: string
  readonly revision: string
  readonly url: string
  readonly sizeBytes: number
  readonly sha256: string
}

export type PinnedModelManifest = Readonly<Record<string, PinnedModelManifestEntry>>

const basic = Object.freeze({
  profileId: 'legacy-four-stem',
  revision: '850cd89461d0817276337061c29e6abceb86d75f',
  url: 'https://huggingface.co/Ghilda/htdemucs-onnx/resolve/850cd89461d0817276337061c29e6abceb86d75f/htdemucs.onnx',
  sizeBytes: 174_266_088,
  sha256: 'e528a932a7d091e15938369135569884b62c2193fb11044c3d4a0d4c7b9221af',
} satisfies PinnedModelManifestEntry)

const rock = Object.freeze({
  profileId: 'metal-stereo-six-stem',
  revision: '0c850a01007f48d94900b21b49a0d0ae1a17239f',
  url: 'https://huggingface.co/kramp/htdemucs-6s-webgpu-onnx/resolve/0c850a01007f48d94900b21b49a0d0ae1a17239f/htdemucs_6s.onnx',
  sizeBytes: 284_797_240,
  sha256: 'a3f5050696cda4b2344d465123acb21ee699dad7d0634dba1d282497a04ac86a',
} satisfies PinnedModelManifestEntry)

/** Build-pinned model artifacts. Every entry is immutable and addressed by profile id. */
export const PINNED_MODEL_MANIFEST: PinnedModelManifest = Object.freeze({
  [basic.profileId]: basic,
  [rock.profileId]: rock,
})
