const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const

/** Binary-unit byte formatter (1024 base) used across the storage/model readouts. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'

  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const decimals = unitIndex === 0 ? 0 : 1
  return `${value.toFixed(decimals)} ${UNITS[unitIndex]}`
}
