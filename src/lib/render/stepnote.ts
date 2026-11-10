// Kitchen mode at another amount: « × 2 · temps et four inchangés » is said
// where it matters, not on every step — on step 1, and on a step that names
// a time, an oven temperature or a pan (PLANNING.md, kitchen mode, "Timers").
import { findPan } from './pans';
import { findDurations } from './timers';

/** A temperature or the oven: « 350 °F », « 180 degrés », « au four » (French), « the oven » (English). */
const HEAT: Record<'fr' | 'en', RegExp> = {
	fr: /°|\bdegr[ée]s?\b|\bfour\b/iu,
	en: /°|\bdegrees?\b|\boven\b/iu
};

/** Whether the step at `index` (0-based) carries the scaling note. */
export function stepTakesScaleNote(text: string, index: number, lang: 'fr' | 'en'): boolean {
	if (index === 0) return true;
	return findDurations(text).length > 0 || HEAT[lang].test(text) || findPan([text]) !== undefined;
}
