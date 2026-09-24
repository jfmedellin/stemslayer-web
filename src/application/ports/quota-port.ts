/**
 * Reports the origin's free storage headroom for the pre-flight quota check
 * (`docs/decisions/browser-storage.md` section 4). `architecture.md`'s
 * infrastructure layout has no dedicated adapter folder for this port since
 * it wraps a single global API (`navigator.storage.estimate()`); implemented
 * alongside P5 (OPFS adapter), the task that also owns stem storage sizing.
 */
export interface QuotaPort {
  /** Bytes of headroom currently available in the origin's storage bucket (`quota - usage`). */
  availableBytes(): Promise<number>
}
