const LANE_COLOR_VARS: Readonly<Record<string, string>> = {
  vocals: '--color-vocals',
  drums: '--color-drums',
  bass: '--color-bass',
  guitar_center: '--color-guitar-center',
  guitar_sides: '--color-guitar-sides',
  other: '--color-other',
}

/**
 * The CSS custom-property name for a lane's ribbon color
 * (`src/ui/tokens.css`'s stem color tokens). An unrecognized/future lane
 * falls back to `--color-other` rather than erroring, matching the domain's
 * `describeLane` render-never-throw rule.
 */
export function laneColorVar(laneId: string): string {
  return LANE_COLOR_VARS[laneId] ?? '--color-other'
}
