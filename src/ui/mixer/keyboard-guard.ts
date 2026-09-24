import type { NavDestination } from '../shell/AppShell'

/**
 * Ports `gui.py:180`'s `space_toggles_playback`: spacebar only toggles
 * playback when the active destination is Mixer *and* a session can
 * currently play. `MixerPage`'s own keydown listener only exists while it
 * is mounted (i.e. only while `view === 'mixer'`, per `App.tsx`'s
 * conditional render), so calling this with the literal `'mixer'` is
 * structurally always true there — it is still called explicitly, with the
 * exact two-part guard, to keep the ported contract documented and unit
 * testable on its own rather than only implicit in mount/unmount timing.
 */
export function canTogglePlayback(view: NavDestination, canPlay: boolean): boolean {
  return view === 'mixer' && canPlay
}
