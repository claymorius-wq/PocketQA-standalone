// Lens motion primitives (Direction A §11). Tokens live in src/theme/motion.ts; everything here
// reads them through useMotion(), so reduced motion is resolved in one place.
export { causticDelay, entranceDelay, ENTRANCE_WINDOW, joinWave, type EntranceStep, type Wave } from './entrance';
export { usePressMotion } from './press';
// Integration-pending (not wired into a screen yet): NumberRoll (S3 credit roll), BreathingCore and
// useLiveBreath (S2 recorder), jsStackScreenOptions (needs react-native-gesture-handler, ADR 0005).
export { canRoll, groupDigits, NumberRoll, planRoll, type RollColumn, type RollPart, type RollPlan } from './NumberRoll';
export { BreathingCore, CORE_IDLE_OPACITY, LiveLed, liveLevels, useLiveBreath, type LiveBreath, type LiveLevels } from './BreathingCore';
export { SHEET_CLEARANCE, useSheetMotion, type SheetMotion } from './sheet';
export { jsStackScreenOptions, stackScreenOptions, tabScreenOptions } from './navigation';
export { useCrossfade, useTabTile } from './swap';
