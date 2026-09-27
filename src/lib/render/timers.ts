// Durations in step text become timer buttons in kitchen mode:
// "25 min", "1 h 30", "45-50 minutes", "1 heure", "45 à 50 min", "2 hours",
// "3 heures 1/2", "1 heure et demie".
// A range counts down its upper bound and says so in its label.

export interface FoundDuration {
	start: number;
	end: number;
	text: string;
	seconds: number;
	/** Set for a range: the timer runs to this. */
	maxSeconds?: number;
}

const NUM = String.raw`\d+(?:[.,]\d+)?(?:\s*[½¼¾]|\s+\d\/\d)?|[½¼¾]`;
const H = String.raw`h|hr|hrs|heures?|hours?`;
const M = String.raw`min|mins|minutes?|mn`;
// After the hours: « 1 h 30 », « 3 heures 1/2 », « 1 heure et demie ».
const HALF = String.raw`(?:et\s+)?(?:demie?|1\/2|½)`;
const ONE = String.raw`(${NUM})\s*(?:(${H})(?:\s*(${HALF})|\s*(\d{1,2})(?!\s*\/)(?:\s*(?:${M}))?)?|(${M}))`;
const RANGE_RE = new RegExp(
	String.raw`(?<![\p{L}\d])(?:(${NUM})\s*(?:-|–|à|to|ou|or)\s*)?${ONE}(?![\p{L}])`,
	'giu'
);

function num(s: string): number {
	const t = s.replace(',', '.').trim();
	const glyph: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75 };
	let m: RegExpMatchArray | null;
	if ((m = t.match(/^(\d+)\s+(\d)\/(\d)$/))) return +m[1] + +m[2] / +m[3];
	if ((m = t.match(/^(\d+(?:\.\d+)?)?\s*([½¼¾])$/))) return Number(m[1] ?? 0) + glyph[m[2]];
	return Number(t);
}

export function findDurations(text: string): FoundDuration[] {
	const out: FoundDuration[] = [];
	for (const m of text.matchAll(RANGE_RE)) {
		const [whole, low, value, hours, half, extraMin, minutes] = m;
		const perUnit = hours ? 3600 : 60;
		const main = num(value) * perUnit + (hours && half ? 1800 : 0) + (hours && extraMin ? Number(extraMin) * 60 : 0);
		if (!main || main > 48 * 3600) continue;
		const d: FoundDuration = { start: m.index ?? 0, end: (m.index ?? 0) + whole.length, text: whole.trim(), seconds: main };
		if (low !== undefined) {
			const lo = num(low) * perUnit;
			if (lo > 0 && lo < main) {
				d.seconds = lo;
				d.maxSeconds = main;
			}
		}
		void minutes;
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
