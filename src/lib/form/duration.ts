// Hours and minutes (and an optional upper bound) ↔ the duration format of
// docs/RECIPE-SCHEMA.md: `30m`, `1h`, `1h15m`, a range `45m-50m`.

import { formatDuration } from '../vault/duration';
import type { Duration } from '../vault/types';
import { findDurations } from '../render/timers';

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

// ---------------------------------------------------------------------------
// One text box per time (the form shows "1 h 30", she may type "90 min",
// "1h30", "20 à 25 min", "1 à 2 h"). The same FormDuration either way: what
// she typed that is not a time is kept in `typed.hours`, `hours` is NaN, and
// Save stays disabled as for any malformed box.

/** The four numbers of a duration, without what she typed. */
export type DurationValue = Pick<FormDuration, DurationField>;

const FRACTIONS: Record<string, string> = { '½': ' 1/2', '¼': ' 1/4', '¾': ' 3/4', '⅓': ' 1/3', '⅔': ' 2/3' };
const D_NUM = String.raw`(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)`;
const D_HOURS = String.raw`(?:h|hr|hrs|heures?|hours?)`;
const D_MINUTES = String.raw`(?:m|mn|min|mins|minutes?)`;
const D_H = new RegExp(String.raw`^${D_NUM}\s*${D_HOURS}\.?(?:\s*(?:et\s+)?(\d+)\s*(?:${D_MINUTES}\.?)?)?$`);
const D_M = new RegExp(String.raw`^${D_NUM}\s*${D_MINUTES}\.?$`);
const D_BARE = new RegExp(String.raw`^${D_NUM}$`);

function dNum(s: string): number {
	const t = s.trim();
	let m: RegExpMatchArray | null;
	if ((m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + +m[2] / +m[3];
	if ((m = t.match(/^(\d+)\/(\d+)$/))) return +m[1] / +m[2];
	return Number(t);
}

/** Minutes in one time ("1 h 30", "90 min", "45"); a bare number is in `unit`. */
function dMinutes(s: string, unit: 'h' | 'm'): number | undefined {
	let m: RegExpMatchArray | null;
	let min: number;
	if ((m = s.match(D_H))) min = dNum(m[1]) * 60 + Number(m[2] ?? 0);
	else if ((m = s.match(D_M))) min = dNum(m[1]);
	else if ((m = s.match(D_BARE))) min = dNum(m[1]) * (unit === 'h' ? 60 : 1);
	else return undefined;
	// Whole minutes only: "1,5 h" is 90 min, "1,5 min" is not a time of the format.
	const r = Math.round(min);
	return Math.abs(min - r) < 1e-9 ? r : undefined;
}

function splitMinutes(min: number): { hours: number | null; minutes: number | null } {
	const h = Math.floor(min / 60);
	const m = min % 60;
	return { hours: h || null, minutes: m || !h ? m : null };
}

/**
 * What she typed in a time box, read. `null`: not a time. A range whose
 * maximum does not go up is still read (the form then says « Le maximum doit
 * dépasser le minimum », as for the boxes before).
 */
export function readDurationInput(text: string): DurationValue | null {
	let s = text.normalize('NFC').toLowerCase().trim();
	if (!s) return { hours: null, minutes: null, maxHours: null, maxMinutes: null };
	for (const [k, v] of Object.entries(FRACTIONS)) s = s.split(k).join(v);
	s = s.replace(/(\d),(\d)/g, '$1.$2').replace(/\s+/g, ' ').trim();
	const parts = s.split(/\s*(?:[-–—]|\s(?:à|a|to|ou)\s)\s*/);
	if (parts.length > 2 || parts.some((p) => !p)) return null;
	if (parts.length === 1) {
		const a = dMinutes(parts[0], 'm');
		return a === undefined ? null : { ...splitMinutes(a), maxHours: null, maxMinutes: null };
	}
	// "20 à 25 min", "1 à 2 h": the first number takes the unit of the second.
	const unit = new RegExp(String.raw`^${D_NUM}\s*${D_HOURS}\.?$`).test(parts[1]) ? 'h' : 'm';
	const a = dMinutes(parts[0], unit);
	const b = dMinutes(parts[1], 'm');
	if (a === undefined || b === undefined) return null;
	const max = splitMinutes(b);
	return { ...splitMinutes(a), maxHours: max.hours, maxMinutes: max.minutes };
}

/** A typed time as the form's duration: read, or kept as typed (NaN, blocks Save). */
export function durationFromInput(text: string): FormDuration {
	const v = readDurationInput(text);
	if (v) return { ...v, typed: undefined };
	return { hours: NaN, minutes: null, maxHours: null, maxMinutes: null, typed: { hours: text } };
}

/** The words of a time, per language. */
export interface DurationWords {
	h: string;
	min: string;
	/** Between the bounds of a range: « à ». */
	to: string;
}

/** Minutes the way the box shows them: "1 h 30", "45 min", "2 h"; `long` adds "min" after the hours' minutes. */
function showOne(hours: number | null, minutes: number | null, w: DurationWords, long: boolean): string {
	const h = hours ?? 0;
	const m = minutes ?? 0;
	if (h && m) return `${h} ${w.h} ${m}${long ? ` ${w.min}` : ''}`;
	if (h) return `${h} ${w.h}`;
	return `${m} ${w.min}`;
}

/**
 * The duration as the box shows it ("1 h 30", "20 à 25 min", "1 à 2 h",
 * "1 h à 1 h 30"), or what she typed when it was not a time; '' when empty.
 * `long`: the echo beside the box ("1 h 30 min").
 */
export function durationInputText(d: FormDuration, w: DurationWords, long = false): string {
	const typed = d.typed && Object.values(d.typed).find((v) => v !== undefined);
	if (typed !== undefined) return typed;
	const nums = [d.hours, d.minutes, d.maxHours, d.maxMinutes];
	if (nums.some((n) => n !== null && !Number.isFinite(n))) return '';
	if (d.hours === null && d.minutes === null) return '';
	if (d.maxHours === null && d.maxMinutes === null) return showOne(d.hours, d.minutes, w, long);
	const onlyMin = !d.hours && !d.maxHours;
	const onlyHours = !d.minutes && !d.maxMinutes && !!d.hours && !!d.maxHours;
	if (onlyMin) return `${d.minutes ?? 0} ${w.to} ${d.maxMinutes ?? 0} ${w.min}`;
	if (onlyHours) return `${d.hours} ${w.to} ${d.maxHours} ${w.h}`;
	return `${showOne(d.hours, d.minutes, w, long)} ${w.to} ${showOne(d.maxHours, d.maxMinutes, w, long)}`;
}

/** A time box's bounds in seconds; null when empty or not a time. */
function boxSeconds(d: FormDuration): { lo: number; hi: number | null } | null {
	const nums = [d.hours, d.minutes, d.maxHours, d.maxMinutes];
	if (nums.some((n) => n !== null && !Number.isFinite(n)) || (d.hours === null && d.minutes === null)) return null;
	const lo = ((d.hours ?? 0) * 60 + (d.minutes ?? 0)) * 60;
	const hasMax = d.maxHours !== null || d.maxMinutes !== null;
	return { lo, hi: hasMax ? ((d.maxHours ?? 0) * 60 + (d.maxMinutes ?? 0)) * 60 : null };
}

/**
 * A step's time edited (« 10 à 12 minutes » → « 12 à 14 minutes ») while a
 * time box (Cuisson, Préparation) still holds the old one: the box's new value
 * to offer (« Cuisson : 12 min → 12 à 14 min ? »). Only when the step holds as
 * many times before as after, exactly one of them changed, and the box held
 * that one — the same range, or one of its bounds. Whole minutes only.
 */
export function stepTimeChange(before: string, after: string, box: FormDuration): DurationValue | undefined {
	const was = findDurations(before);
	const now = findDurations(after);
	if (!was.length || was.length !== now.length) return undefined;
	const key = (d: { seconds: number; maxSeconds?: number }) => `${d.seconds}-${d.maxSeconds ?? ''}`;
	const changed = was.map((w, i) => i).filter((i) => key(was[i]) !== key(now[i]));
	if (changed.length !== 1) return undefined;
	const old = was[changed[0]];
	const next = now[changed[0]];
	const b = boxSeconds(box);
	if (!b) return undefined;
	const held = b.hi === null ? b.lo === old.seconds || b.lo === old.maxSeconds : b.lo === old.seconds && b.hi === old.maxSeconds;
	if (!held || next.seconds % 60 || (next.maxSeconds ?? 0) % 60) return undefined;
	const lo = split(next.seconds);
	const hi = next.maxSeconds !== undefined ? split(next.maxSeconds) : { hours: null, minutes: null };
	return { ...lo, maxHours: hi.hours, maxMinutes: hi.minutes };
}
