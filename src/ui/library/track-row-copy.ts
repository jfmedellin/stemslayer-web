import type { SeparateProgressEvent } from '../../application/separate'

type PreparingEvent = Extract<SeparateProgressEvent, { phase: 'preparing' }>
type ProcessingEvent = Extract<SeparateProgressEvent, { phase: 'processing' }>

/** Shown for a `preparing` row before its first live progress event arrives. */
export const PREPARING_FALLBACK_DETAIL = 'Queued for separation.'

/** Fixed copy for an `interrupted` row, from the fetched Stitch Library screen. */
export const INTERRUPTED_DETAIL = 'Cancelled before it finished.'

/** Fixed copy for an `unavailable` row, from the fetched Stitch Library screen. */
export const UNAVAILABLE_DETAIL = 'Stems were removed by the browser. Separate again from the original file.'

/** Shown for a `failed` row when the track somehow carries no `errorDetail`. */
export const FAILED_FALLBACK_DETAIL = 'Separation failed.'

/**
 * `separate()`'s `preparing` phase already carries a fully-formatted detail
 * string (e.g. "Preparing Rock: 42%") — this only supplies the fallback
 * shown before the first event for this track arrives.
 */
export function preparingLabel(event: PreparingEvent | undefined): string {
  return event?.detail ?? PREPARING_FALLBACK_DETAIL
}

/** Renders "Separating · window N of M · P%" from `separate()`'s processing progress. */
export function processingLabel(event: ProcessingEvent | undefined): string {
  if (event === undefined) return 'Separating…'
  const percent = event.totalWindows > 0 ? Math.round((event.window / event.totalWindows) * 100) : 0
  return `Separating · window ${event.window} of ${event.totalWindows} · ${percent}%`
}
