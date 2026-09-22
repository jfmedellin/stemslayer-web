import { useEffect, useState } from 'react'
import { addToLibrary, type AddToLibraryDeps, type AddToLibraryResult } from '../../application/add-to-library'
import type { ModelFootprint } from '../../application/ports/model-store-port'
import type { SeparationQueue } from '../../application/separation-queue'
import { BASIC_PROFILE, ROCK_PROFILE, type StemProfile } from '../../domain/stem-profile'
import type { NavigatorGpuLike } from '../../infrastructure/onnx-worker/onnx-session-manager'
import { formatBytes } from '../format/format-bytes'
import { BeforeYouStartStrip } from './BeforeYouStartStrip'
import { detectEngineProvider } from './detect-engine-provider'
import { DropZone } from './DropZone'
import { estimateSeparationSeconds } from './estimate-seconds'
import { FileCard } from './FileCard'
import { primaryActionLabel } from './primary-action-label'
import { ProfileCard } from './ProfileCard'
import { readAudioFileMetadata, type AudioFileMetadata } from './read-audio-file-metadata'

export interface UploadPageProps {
  readonly deps: AddToLibraryDeps
  readonly navigatorRef: NavigatorGpuLike
  /** The one shared queue (`app-dependencies.ts`): a `claimed`/`adopted` decision actually starts a job here. */
  readonly queue: SeparationQueue
}

interface LoadedFile {
  readonly fileName: string
  readonly bytes: Uint8Array
  readonly metadata: AudioFileMetadata
}

type SubmissionState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'succeeded'; readonly decision: 'claimed' | 'reused' | 'awaiting' | 'adopted' }
  | { readonly kind: 'quota-refused'; readonly forecastBytes: number; readonly availableBytes: number }
  | { readonly kind: 'failed'; readonly message: string }

const EXTRA_FILES_MESSAGE = 'Only the first file was loaded — Stemslayer separates one file at a time.'

function successCopyForDecision(decision: 'claimed' | 'reused' | 'awaiting' | 'adopted'): string {
  switch (decision) {
    case 'claimed':
      return 'Queued for separation.'
    case 'reused':
      return 'Already separated — added to your library.'
    case 'awaiting':
      return 'Another tab is already separating this file — it will appear in your library.'
    case 'adopted':
      return 'Picked up an unfinished separation for this file.'
  }
}

/** Container for the Upload destination: owns the loaded-file/profile/submission state and calls `addToLibrary`. */
export function UploadPage({ deps, navigatorRef, queue }: UploadPageProps) {
  const [loaded, setLoaded] = useState<LoadedFile | null>(null)
  const [rejectionMessage, setRejectionMessage] = useState<string | null>(null)
  const [profile, setProfile] = useState<StemProfile>(ROCK_PROFILE)
  const [footprints, setFootprints] = useState<Readonly<Record<string, ModelFootprint>>>({})
  const [availableBytes, setAvailableBytes] = useState<number | null>(null)
  const [submission, setSubmission] = useState<SubmissionState>({ kind: 'idle' })

  useEffect(() => {
    let cancelled = false

    deps.quota.availableBytes().then((bytes) => {
      if (!cancelled) setAvailableBytes(bytes)
    })

    Promise.all(
      [BASIC_PROFILE, ROCK_PROFILE].map(async (candidate) => {
        const footprint = await deps.modelStore.getFootprint(candidate.profileId)
        return [candidate.profileId, footprint] as const
      }),
    ).then((entries) => {
      if (!cancelled) setFootprints(Object.fromEntries(entries))
    })

    return () => {
      cancelled = true
    }
  }, [deps])

  async function handleFilesChosen(files: readonly File[]): Promise<void> {
    setSubmission({ kind: 'idle' })
    setRejectionMessage(files.length > 1 ? EXTRA_FILES_MESSAGE : null)

    const file = files[0]
    if (file === undefined) return

    const bytes = new Uint8Array(await file.arrayBuffer())
    const metadata = await readAudioFileMetadata(file.name, bytes)
    setLoaded({ fileName: file.name, bytes, metadata })
  }

  function handleChangeFile(): void {
    setLoaded(null)
    setRejectionMessage(null)
    setSubmission({ kind: 'idle' })
  }

  async function handlePrimaryAction(): Promise<void> {
    if (loaded === null) return
    setSubmission({ kind: 'submitting' })

    let result: AddToLibraryResult
    try {
      result = await addToLibrary({ bytes: loaded.bytes, fileName: loaded.fileName, profile }, deps)
    } catch (error) {
      setSubmission({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
      return
    }

    if (result.decision === 'quota-refused') {
      setSubmission({
        kind: 'quota-refused',
        forecastBytes: result.forecastBytes,
        availableBytes: result.availableBytes,
      })
      return
    }

    // Only a fresh claim or an adopted (previously failed/interrupted/unavailable)
    // row needs a job started; `reused`/`awaiting` already have one, owned by
    // this tab or another.
    if (result.decision === 'claimed' || result.decision === 'adopted') {
      queue.enqueue(result.track.trackId, loaded.bytes)
    }
    setSubmission({ kind: 'succeeded', decision: result.decision })
  }

  const engineProvider = detectEngineProvider(navigatorRef)
  const durationForEstimate = loaded?.metadata.durationSeconds ?? 0
  const estimateSeconds = estimateSeparationSeconds(profile.profileId, durationForEstimate)
  const footprint = footprints[profile.profileId] ?? null
  const modelsLabel = footprint === null
    ? 'Checking…'
    : footprint.cached ? 'Cached' : `${formatBytes(footprint.sizeBytes)} to download`

  return (
    <section className="upload-page" aria-labelledby="upload-page-title">
      <h1 id="upload-page-title">Upload</h1>

      {loaded === null
        ? <DropZone onFilesChosen={handleFilesChosen} />
        : <FileCard metadata={loaded.metadata} onChangeFile={handleChangeFile} />}

      {rejectionMessage !== null && (
        <p className="drop-zone-rejection" role="status">{rejectionMessage}</p>
      )}

      <div className="profile-cards">
        <ProfileCard
          profile={BASIC_PROFILE}
          footprint={footprints[BASIC_PROFILE.profileId] ?? null}
          selected={profile.profileId === BASIC_PROFILE.profileId}
          onSelect={() => setProfile(BASIC_PROFILE)}
        />
        <ProfileCard
          profile={ROCK_PROFILE}
          footprint={footprints[ROCK_PROFILE.profileId] ?? null}
          selected={profile.profileId === ROCK_PROFILE.profileId}
          onSelect={() => setProfile(ROCK_PROFILE)}
        />
      </div>

      <BeforeYouStartStrip
        engineProvider={engineProvider}
        estimateSeconds={estimateSeconds}
        availableBytes={availableBytes}
        modelsLabel={modelsLabel}
      />

      <button
        type="button"
        className="primary-action"
        disabled={loaded === null || submission.kind === 'submitting'}
        onClick={handlePrimaryAction}
      >
        {primaryActionLabel(profile)}
      </button>

      {submission.kind === 'succeeded' && (
        <p className="submission-status" data-tone="success" role="status">
          {successCopyForDecision(submission.decision)}
        </p>
      )}
      {submission.kind === 'quota-refused' && (
        <p className="submission-status" data-tone="refused" role="alert">
          Not enough storage: needs {formatBytes(submission.forecastBytes)}, only{' '}
          {formatBytes(submission.availableBytes)} available.
        </p>
      )}
      {submission.kind === 'failed' && (
        <p className="submission-status" data-tone="refused" role="alert">{submission.message}</p>
      )}
    </section>
  )
}
