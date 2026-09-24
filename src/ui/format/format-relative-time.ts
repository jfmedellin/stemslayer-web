const UNITS: ReadonlyArray<readonly [string, number]> = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]

/**
 * Renders an ISO timestamp as "{n} {unit}(s) ago" (or "just now"), for the
 * Mixer track header's "separated {relative time} ago" readout. `now`
 * defaults to the real current time and is injectable for deterministic
 * tests.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime()
  const diffSeconds = Math.max(0, Math.floor((now.getTime() - then) / 1000))
  if (diffSeconds < 60) return 'just now'

  for (const [label, secondsInUnit] of UNITS) {
    const value = Math.floor(diffSeconds / secondsInUnit)
    if (value >= 1) return `${value} ${label}${value === 1 ? '' : 's'} ago`
  }
  return 'just now'
}
