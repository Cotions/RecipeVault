// Durations in step text become timer buttons in kitchen mode:
// "25 min", "1 h 30", "45-50 minutes", "1 heure", "45 à 50 min", "2 hours",
// "3 heures 1/2", "1 heure et demie", "1/2 heure", "3/4 h", "45 secondes",
// "1 min 30 s", "1 minute 30".
// A range counts down its upper bound and says so in its label.

export interface FoundDuration {
	start: number;
	end: number;
	text: string;
	seconds: number;
	/** Set for a range: the timer runs to this. */
	maxSeconds?: number;
}

const NUM = String.raw`\d\/\d|\d+(?:[.,]\d+)?(?:\s*[½¼¾]|\s+\d\/\d)?|[½¼¾]`;
const H = String.raw`h|hr|hrs|heures?|hours?`;
const M = String.raw`min|mins|minutes?|mn`;
// After the hours: « 1 h 30 », « 3 heures 1/2 », « 1 heure et demie ».
const HALF = String.raw`(?:et\s+)?(?:demie?|1\/2|½)`;
const S = String.raw`s|sec|secs|secondes?|seconds?`;
// After the minutes: « 1 min 30 s », or two bare digits (« 1 minute 30 »), which
// `findDurations` takes only as a quarter (15, 30, 45) after a single-digit count of
// minutes; « 1 minute et demie » too.
const SECONDS = String.raw`\s*(\d{1,2})\s*(?:${S})(?![\p{L}])|(\s*(\d{2})(?![\d/]|\s*\/))`;
const ONE = String.raw`(${NUM})\s*(?:(${H})(?:\s*(${HALF})|\s*(\d{1,2})(?!\s*\/)(?:\s*(?:${M}))?)?|(${M})(?:\s*(${HALF})|${SECONDS})?|(${S}))`;
const RANGE_RE = new RegExp(
	String.raw`(?<![\p{L}\d/])(?:(${NUM})\s*(?:-|–|à|to|ou|or)\s*)?${ONE}(?![\p{L}])`,
	'giu'
);

function num(s: string): number {
	const t = s.replace(',', '.').trim();
	const glyph: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75 };
	let m: RegExpMatchArray | null;
	if ((m = t.match(/^(\d+)\s+(\d)\/(\d)$/))) return +m[1] + +m[2] / +m[3];
	if ((m = t.match(/^(\d)\/(\d)$/))) return +m[1] / +m[2];
	if ((m = t.match(/^(\d+(?:\.\d+)?)?\s*([½¼¾])$/))) return Number(m[1] ?? 0) + glyph[m[2]];
	return Number(t);
}

export function findDurations(text: string): FoundDuration[] {
	const out: FoundDuration[] = [];
	for (const m of text.matchAll(RANGE_RE)) {
		const [, low, value, hours, half, extraMin, minutes, halfMin, extraSec, bare, bareSec] = m;
		let whole = m[0];
		const perUnit = hours ? 3600 : minutes ? 60 : 1;
		let main = num(value) * perUnit + (hours && half ? 1800 : 0) + (hours && extraMin ? Number(extraMin) * 60 : 0);
		if (halfMin) main += 30;
		else if (extraSec && Number(extraSec) < 60) main += Number(extraSec);
		else if (bare) {
			// « 1 minute 30 » is a minute and a half; « 20 minutes 12 … » is not read further.
			if (/^\d$/.test(value) && low === undefined && ['15', '30', '45'].includes(bareSec)) main += Number(bareSec);
			else whole = whole.slice(0, whole.length - bare.length);
		}
		if (!main || main > 48 * 3600) continue;
		const d: FoundDuration = { start: m.index ?? 0, end: (m.index ?? 0) + whole.length, text: whole.trim(), seconds: main };
		if (low !== undefined) {
			const lo = num(low) * perUnit;
			if (lo > 0 && lo < main) {
				d.seconds = lo;
				d.maxSeconds = main;
			}
		}
		out.push(d);
	}
	return out;
}

/** mm:ss or h:mm:ss for a running timer. */
export function clock(ms: number): string {
	const s = Math.max(0, Math.ceil(ms / 1000));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	const mm = String(m).padStart(h ? 2 : 1, '0');
	return h ? `${h}:${mm}:${String(sec).padStart(2, '0')}` : `${mm}:${String(sec).padStart(2, '0')}`;
}

/** A timer's length in words: whole minutes as everywhere else, seconds when it has some (« 45 s », « 1 min 30 s »). */
export function timerLength(seconds: number, whole: (s: number) => string): string {
	if (seconds % 60 === 0 || seconds >= 3600) return whole(seconds);
	const m = Math.floor(seconds / 60);
	return m ? `${m} min ${seconds % 60} s` : `${seconds} s`;
}
