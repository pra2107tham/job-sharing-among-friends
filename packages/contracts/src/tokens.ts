/**
 * Design tokens.
 *
 * Written before the first screen on purpose. Doc 1 §1 puts the whole value of
 * the product on the sharing gesture feeling effortless, and consistency is most
 * of what makes an interface feel that way. Retrofitting tokens after ten
 * screens have each invented their own spacing is the expensive version.
 *
 * The raw values live in tokens.json because tailwind.config.js is loaded by
 * Node and cannot require a .ts file. JSON is the one format both the TypeScript
 * app and the Tailwind config can read, so there is a single source of truth.
 *
 * Rules:
 *   - No raw hex or magic numbers in components. Import from here.
 *   - Spacing is a 4pt scale. If a value is not on the scale, the layout is wrong.
 */

import tokens from './tokens.json';

export const palette = tokens.palette;
export const space = tokens.space;
export const radius = tokens.radius;
export const fontSize = tokens.fontSize;

export const lightTheme = {
  bg: palette.white,
  bgSubtle: palette.ink50,
  surface: palette.white,
  border: palette.ink100,
  text: palette.ink900,
  textMuted: palette.ink500,
  textInverse: palette.white,
  accent: palette.accent500,
  accentText: palette.white,
  accentSubtle: palette.accent50,
} as const;

export const darkTheme: Theme = {
  bg: palette.ink900,
  bgSubtle: '#1B1917',
  surface: palette.ink700,
  border: '#3A3531',
  text: palette.ink50,
  textMuted: palette.ink300,
  textInverse: palette.ink900,
  accent: palette.accent300,
  accentText: palette.ink900,
  accentSubtle: '#1A2E27',
};

export type Theme = { [K in keyof typeof lightTheme]: string };

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/**
 * Motion. Kept short deliberately: doc 1 §4.3 budgets 300ms for the entire
 * share gesture, so no transition on that path may exceed `fast`.
 */
export const duration = {
  instant: 90,
  fast: 160,
  normal: 240,
} as const;

/** Minimum touch target. Anything interactive must meet this. */
export const HIT_SLOP = 44;

/** Tracker status colours, keyed by the DB's job_status values. */
export const statusColor = {
  new: palette.ink300,
  saved: palette.saved,
  applied: palette.applied,
  interviewing: palette.interviewing,
  offer: palette.offer,
  rejected: palette.rejected,
  not_interested: palette.muted,
} as const;
