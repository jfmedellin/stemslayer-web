// Desktop's fixed cancellation copy (`history.py` `_CANCELLED_ERROR_DETAIL`),
// reused for a job cancelled mid-run and for a queued job cancelled before it
// ever ran (`SeparationQueue.cancel`).
export const CANCELLED_ERROR_DETAIL =
  'job.cancelled Separation was cancelled; no partial result was kept. Retry from the original audio.'

// `history.py:385-391`'s `recover_unfinished()` copy for a `preparing`/
// `processing` row left behind by a crash or closed tab.
export const UNFINISHED_ERROR_DETAIL = 'Stemslayer closed before this separation finished. Retry the track.'

/** `history.py:393-412`'s `validate_ready()` shape: `"Stored stems are unavailable: {error}. Retry from the original audio."` */
export function unavailableErrorDetail(detail: string): string {
  return `Stored stems are unavailable: ${detail}. Retry from the original audio.`
}

/** Desktop's generic `"{cause} {recovery}"` failure shape (`history.py:738-745`), default recovery. */
export function failureErrorDetail(cause: string): string {
  return `${cause} Retry from the original audio.`
}
