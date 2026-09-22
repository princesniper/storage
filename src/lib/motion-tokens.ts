/**
 * Phase A — "Dark Botanical Ops / Quiet Premium" motion tokens.
 *
 * Tokens only: no component imports this yet, so nothing visually changes.
 * Phases B+ should use these instead of ad-hoc durations/easings.
 *
 * Durations: micro 0.12s · fast 0.18s · standard 0.24s · deliberate 0.32s
 * modal 0.28s · page 0.26s · countUp 0.9s
 * Easing: [0.16, 1, 0.3, 1]
 * Spring: stiffness 420, damping 34, mass 0.9
 * Soft spring: stiffness 260, damping 30, mass 1
 */

export const MOTION_EASE = [0.16, 1, 0.3, 1] as const;

export const MOTION_DURATION = {
  micro: 0.12,
  fast: 0.18,
  standard: 0.24,
  deliberate: 0.32,
  modal: 0.28,
  page: 0.26,
  countUp: 0.9,
} as const;

export const MOTION_SPRING = {
  stiffness: 420,
  damping: 34,
  mass: 0.9,
} as const;

export const MOTION_SPRING_SOFT = {
  stiffness: 260,
  damping: 30,
  mass: 1,
} as const;

/** Framer Motion transition presets (quiet, operational — not bouncy). */
export const MOTION_PRESETS = {
  micro: { duration: MOTION_DURATION.micro, ease: [...MOTION_EASE] },
  fast: { duration: MOTION_DURATION.fast, ease: [...MOTION_EASE] },
  standard: { duration: MOTION_DURATION.standard, ease: [...MOTION_EASE] },
  deliberate: { duration: MOTION_DURATION.deliberate, ease: [...MOTION_EASE] },
  modal: { duration: MOTION_DURATION.modal, ease: [...MOTION_EASE] },
  page: { duration: MOTION_DURATION.page, ease: [...MOTION_EASE] },
} as const;

/** Status → color-var mapping (5 colors only, mirrors CSS vars). */
export const STATUS_VARS = {
  waiting: "var(--status-waiting)",
  processing: "var(--status-processing)",
  transit: "var(--status-transit)",
  completed: "var(--status-completed)",
  exception: "var(--status-exception)",
} as const;

export type StatusKey = keyof typeof STATUS_VARS;
