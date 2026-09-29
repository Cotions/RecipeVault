// Hours and minutes (and an optional upper bound) ↔ the duration format of
// docs/RECIPE-SCHEMA.md: `30m`, `1h`, `1h15m`, a range `45m-50m`.

import { formatDuration } from '../vault/duration';
import type { Duration } from '../vault/types';

/** One time field of the form. `null` = left empty. */
export type DurationField = 'hours' | 'minutes' | 'maxHours' | 'maxMinutes';
export const DURATION_FIELDS: readonly DurationField[] = ['hours', 'minutes', 'maxHours', 'maxMinutes'];

export interface FormDuration {
	/** A box holding something that is not a number is NaN (it blocks Save); empty is null. */
	hours: number | null;
	minutes: number | null;
	/** Upper bound of a range ("à"). */
	maxHours: number | null;
	maxMinutes: number | null;
	/**
	 * What she typed in a box that is not a number, shown back as typed. Kept
	 * in the form so a draft gives it back: JSON turns the NaN into null
	 * (`reviveDuration`). Absent when every box holds a number or nothing.
	 */
	typed?: Partial<Record<DurationField, string>>;
}

/** After a JSON round trip (a draft): a box with typed text and no number is NaN again, so it still blocks Save. */
export function reviveDuration(d: FormDuration): void {
	for (const k of DURATION_FIELDS) if (d.typed?.[k] !== undefined && d[k] === null) d[k] = NaN;
}

export const emptyDuration = (): FormDuration => ({ hours: null, minutes: null, maxHours: null, maxMinutes: null });

function split(seconds: number): { hours: number | null; minutes: number | null } {
	const min = Math.round(seconds / 60);
	const h = Math.floor(min / 60);
	const m = min % 60;
	return { hours: h || null, minutes: m || !h ? m : null };
}

/** A parsed duration as the form's fields: 75 minutes → 1 h 15 min. */
export function durationToForm(d: Duration | undefined): FormDuration {
	if (!d) return emptyDuration();
	const { hours, minutes } = split(d.seconds);
	const max = d.maxSeconds !== undefined ? split(d.maxSeconds) : { hours: null, minutes: null };
	return { hours, minutes, maxHours: max.hours, maxMinutes: max.minutes };
}

export type DurationInput = { ok: true; raw?: string } | { ok: false; reason: 'format' | 'range' };

const valid = (n: number | null) => n === null || (Number.isInteger(n) && n >= 0);

/** The fields as a duration string; `raw` absent when every field is empty. */
export function formToDuration(f: FormDuration): DurationInput {
	if (![f.hours, f.minutes, f.maxHours, f.maxMinutes].every(valid)) return { ok: false, reason: 'format' };
	const has = f.hours !== null || f.minutes !== null;
	const hasMax = f.maxHours !== null || f.maxMinutes !== null;
	if (!has) return hasMax ? { ok: false, reason: 'format' } : { ok: true };
	const min = (f.hours ?? 0) * 60 + (f.minutes ?? 0);
	const raw = formatDuration(min * 60);
	if (!hasMax) return { ok: true, raw };
	const max = (f.maxHours ?? 0) * 60 + (f.maxMinutes ?? 0);
	if (max <= min) return { ok: false, reason: 'range' };
	return { ok: true, raw: `${raw}-${formatDuration(max * 60)}` };
}

export const sameDuration = (a: FormDuration, b: FormDuration) =>
	a.hours === b.hours && a.minutes === b.minutes && a.maxHours === b.maxHours && a.maxMinutes === b.maxMinutes;
