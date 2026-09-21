/**
 * `LockPort` key that serializes the read-decide-write identity-claim
 * sequence across tabs/workers (`docs/decisions/browser-storage.md` section
 * 1). Shared by every use case that claims or rebinds a track identity.
 */
export const IDENTITY_CLAIM_LOCK_KEY = 'stemslayer:identity-claim'
