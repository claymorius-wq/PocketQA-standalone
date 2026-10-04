// Lens material primitives (Direction A v2 §2, §4, §9, §10, §11; docs/decisions/0006-lens-visual-system.md).
// Every primitive reads its recipe from useTheme().glass and degrades to flat token surfaces in the
// light theme (glass.enabled === false). TODO(light-lens): light Lens recipes land in tokens.ts.
export { CausticSweep, useSweepOnEnable, type CausticSweepProps } from './CausticSweep';
export { FlutedLens, type FlutedLensProps } from './FlutedLens';
export { BlurTargetContext, GlassBlur, blurAvailable, type GlassBlurProps } from './GlassBlur';
export { GlassSurface, type GlassLevel, type GlassSurfaceProps } from './GlassSurface';
export { Grain, GRAIN_TILE, type GrainProps } from './Grain';
export { Ground, GroundFade, type GroundProps } from './Ground';
export { useKeyLight, type KeyLight } from './keyLight';
// useUplightNumeralStyle is integration-pending: the U5/U6 lit balance numerals are not wired yet.
export { UplightFloor, UplightMotes, useUplight, useUplightNumeralStyle, type Uplight, type UplightFloorProps, type UplightGrade, type UplightOptions } from './Uplight';
export { Well, type WellProps, type WellState } from './Well';
