// Screen-level Lens patterns (Direction A v2 boards, CONSISTENCY.md round 4; ADR 0006).
//
// Each pattern is the one implementation of an element that recurs across the screen boards,
// composed from the glass, icons, motion and ui primitives. Patterns take the data the screens
// already hold (contracts types, ISO timestamps, counts) and carry no business logic: they never
// fetch, mutate, or decide when a moment happens (the screen passes `earned`, `live`, `status`).
// Every pattern passes its testID through, has its accessibility built in, follows reduced
// motion through useTheme().motion, and degrades to flat surfaces in light (glass.enabled false).
//
// The kit already renders some of them as its own components (LoadingState is LensShimmer,
// EmptyState / ErrorState are EmptyPanel / ErrorPanel, Section is SectionHeader, ConfirmSheet is
// SheetActions + useCommitUplight). Patterns import the kit's leaf modules (text, button, card,
// status, spinner, icon, focus), never '../index', so the kit can compose them without a cycle.
// Integration-pending: screens adopt the rest in the screen phase.

export { Amount, Byline, ClauseDot, Clauses, CLAUSE_SEPARATOR, DateText, Meta, MINUS, signedAmount } from './type';
export { CommitUplight, MODE_B_HEIGHT, PASS_LEAVE_AFTER, PASS_MIN_AFTER_PRESS, UnderGlow, useCommitUplight, type CommitStatus } from './light';
export { RewardWell, rewardPhrase, type RewardWellProps } from './RewardWell';
export { BalanceHero, creditsSuffix, type BalanceHeroProps } from './BalanceHero';
export { plural, StudyCard, type StudyCardProps } from './StudyCard';
export { Hairline, ListCard, ListRow, type ListRowProps } from './ListRow';
export { SectionHeader, type SectionHeaderProps } from './SectionHeader';
export { KeyFigure, KeyValue, KeyValueList, type KeyValueProps, type ValueStyle } from './KeyValue';
export { TaskList, type TaskItem, type TaskListProps } from './TaskList';
export {
  AuditGroove,
  auditGlyph,
  auditParts,
  dayLabel,
  groupByDay,
  StatusTimeline,
  statusGlyph,
  Timeline,
  type AuditEntryData,
  type StatusEvent,
  type TimelineEntry,
  type TimelineGroup,
} from './Timeline';
export { MeterSwatch, PipCanvas, type MeterMaterial, type PipCell } from './meter';
export { BAR_WIDTH, BudgetMeter, layoutPips, PIP_GAP, planBudgetBar, planBudgetMeter, planMeter, SlotMeter, type MeterPlan, type MeterStatus, type SlotMeterProps } from './SlotMeter';
export { RecordControl, type RecordControlProps } from './RecordControl';
export { ClipRow, clipPill, ReviewNotice, type ClipRowProps, type ClipState } from './ClipRow';
export { GlideList } from './GlideList';
export { DecisionBar, SheetActions, SheetFailure, type DecisionAction, type DecisionBarProps, type SheetActionsProps } from './DecisionBar';
export { EmptyPanel, ErrorPanel, type EmptyPanelProps, type ErrorPanelProps, type StateIcon } from './EmptyPanel';
export { LensShimmer, type LensShimmerProps } from './LensShimmer';
export { PageDots, type PageDotsProps } from './PageDots';
export { Spinner } from '../spinner';
