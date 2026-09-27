// Durations: 30m, 1h, 1h15m; ranges 45m-50m. Nothing else.

import { stripMarkers } from './markers';
import { stripAccents } from './normalize';
import type { Duration } from './types';

const ONE = /^(?:(\d+)h)?(?:(\d+)m)?$/;

function one(s: string): number | undefined {
	const m = s.match(ONE);
	if (!m || (m[1] === undefined && m[2] === undefined)) return undefined;
	return (Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60;
}

/** Parse a duration value; undefined when it is not in the format. Markers are ignored. */
export function parseDuration(v: unknown): Duration | undefined {
	if (typeof v !== 'string') return undefined;
	const s = stripMarkers(v.normalize('NFC'));
	const parts = s.split('-');
	if (parts.length > 2) return undefined;
	const seconds = one(parts[0]);
	if (seconds === undefined) return undefined;
	if (parts.length === 1) return { raw: v, seconds };
	const maxSeconds = one(parts[1]);
	if (maxSeconds === undefined || maxSeconds <= seconds) return undefined;
	return { raw: v, seconds, maxSeconds };
}

/** Format seconds as the canonical duration: 75 min → '1h15m'. */
export function formatDuration(seconds: number): string {
	const min = Math.round(seconds / 60);
	const h = Math.floor(min / 60);
	const m = min % 60;
	return h && m ? `${h}h${m}m` : h ? `${h}h` : `${m}m`;
}

const NUM = String.raw`(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?)`;
const HOURS = String.raw`(?:h|hr|hrs|heures?|hours?)`;
const MINUTES = String.raw`(?:m|mn|min|mins|minutes?)`;

function num(s: string): number {
	const t = s.replace(',', '.').trim();
	let m: RegExpMatchArray | null;
	if ((m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + +m[2] / +m[3];
	if ((m = t.match(/^(\d+)\/(\d+)$/))) return +m[1] / +m[2];
	return Number(t);
}

/** Minutes in one free-text duration: '2 hrs', '1 1/4 heure', '1 h 30', '30 min'. */
function freeMinutes(s: string, defaultUnit?: 'h' | 'm'): number | undefined {
	const t = s.trim();
	let m: RegExpMatchArray | null;
	if ((m = t.match(new RegExp(`^${NUM}\\s*${HOURS}\\s*(?:(\\d+)\\s*${MINUTES}?)?$`))))
		return num(m[1]) * 60 + Number(m[2] ?? 0);
	if ((m = t.match(new RegExp(`^${NUM}\\s*${MINUTES}$`)))) return num(m[1]);
	if (defaultUnit && (m = t.match(new RegExp(`^${NUM}$`))))
		return num(m[1]) * (defaultUnit === 'h' ? 60 : 1);
	return undefined;
}

/**
 * Best-effort conversion of a malformed duration to the format, for the fix
 * text of E109: '2 hrs' → '2h', '45-50 minutes' → '45m-50m'. Trailing words
 * ('de réfrigération') are dropped; the caller says where they belong.
 */
export function suggestDuration(v: unknown): string | undefined {
	// A bare number has no unit: 1.5 may be hours or minutes. No guess.
	if (typeof v !== 'string') return undefined;
	let s = stripAccents(stripMarkers(v)).toLowerCase().trim();
	s = s.replace(/\s+(?:de|d'|of|pour|for|au|dans|in)\b.*$/, '').trim();
	const range = s.split(/\s*(?:-|–|\ba\b|\bto\b|\bou\b)\s*/);
	if (range.length === 2) {
		const unit = new RegExp(`${HOURS}$`).test(range[1]) ? 'h' : 'm';
		const a = freeMinutes(range[0], unit);
		const b = freeMinutes(range[1]);
		if (a !== undefined && b !== undefined && b > a)
			return `${formatDuration(a * 60)}-${formatDuration(b * 60)}`;
		return undefined;
	}
	const m = freeMinutes(s);
	return m !== undefined && m > 0 ? formatDuration(m * 60) : undefined;
}
