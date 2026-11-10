// The pan at another amount (usability round 3; plan 05, "The pan"): when a
// step names a pan with its size (« verser dans un plat de 9 x 13 »), the
// recipe page suggests pans whose bottom makes the scaled area, so the batter
// keeps its depth and the times stay those of the card. A pan named without a
// size (« un moule à pain ») only gets « × 1 ½ la surface ». Browser-safe;
// the words are the page's (i18n), the numbers are here.

/** Rectangles and squares (`w` × `h`), round pans (`w` the diameter), loaf pans. */
export type PanShape = 'rect' | 'round' | 'loaf';

export interface PanSize {
	shape: PanShape;
	w: number;
	h: number;
	/** As the card measures it: `in` (9 x 13, 9 po) or `cm`. */
	unit: 'in' | 'cm';
}

export interface PanMention {
	/** The card's own word for it, singular: `plat`, `moule`, `assiette`, `pan`. */
	word: string;
	/** Its size, when the text gives one that reads. */
	size?: PanSize;
}

export interface PanOption {
	count: number;
	size: PanSize;
}

/** Baking pans a kitchen has, by shape and measure (bottom sizes; sheet pans left out: they are shallower). */
const STANDARD: Record<PanSize['unit'], Record<PanShape, [number, number][]>> = {
	in: {
		rect: [
			[8, 8],
			[9, 9],
			[7, 11],
			[9, 13],
			[10, 15]
		],
		round: [
			[8, 8],
			[9, 9],
			[10, 10]
		],
		loaf: [
			[8, 4],
			[9, 5]
		]
	},
	cm: {
		rect: [
			[20, 20],
			[23, 23],
			[18, 28],
			[23, 33],
			[25, 38]
		],
		round: [
			[20, 20],
			[23, 23],
			[25, 25]
		],
		loaf: [
			[20, 10],
			[23, 13]
		]
	}
};

/** A suggestion is kept within this share of the scaled area (about a sixth: a thin layer more or less). */
export const PAN_TOLERANCE = 0.17;
/** Each pan beyond the first counts as this much error: one pan rather than two when both fit. */
const PER_PAN = 0.04;

// JavaScript's \b knows no accents (« carré », « beurré »): word edges by letter.
const B = String.raw`(?<![\p{L}\p{N}])`;
const E = String.raw`(?![\p{L}\p{N}])`;
const NUM = String.raw`(\d{1,2}(?:[.,]\d)?)`;
const IN = String.raw`(?:po(?:uces?)?${E}|"|″|-?\s?inch(?:es)?${E}|in${E})`;
const CM = String.raw`cm${E}`;
const UNIT = String.raw`(${IN}|${CM})`;
/** French or English pan words a size may follow; « casserole » (a saucepan) and « plat » alone in « un plat principal » are not here. */
const WORD = String.raw`(plat|moule|assiette|lèchefrite|lechefrite|tôle|plaque|pan|dish|tin)s?`;
const BETWEEN = String.raw`([^.,;:\n]{0,30}?)`;

/** « plat de 9 x 13 », « moule 23 x 33 cm », « moule à pain de 9 x 5 po ». */
const RECT_AFTER = new RegExp(String.raw`${B}${WORD}${E}${BETWEEN}${B}${NUM}\s*(?:${IN}|${CM})?\s*[x×]\s*${NUM}\s*${UNIT}?`, 'iu');
/** « an 8 x 8 pan », « a 9x13-inch baking dish ». */
const RECT_BEFORE = new RegExp(String.raw`${B}${NUM}\s*(?:${IN})?\s*[x×]\s*${NUM}\s*${UNIT}?\s+(?:[\p{L}-]+\s+){0,2}?${WORD}${E}`, 'iu');
/** « moule carré de 8 pouces », « assiette à tarte de 9 po », « moule rond de 23 cm », « a 9-inch pie plate ». */
const ONE_AFTER = new RegExp(String.raw`${B}${WORD}${E}${BETWEEN}${B}${NUM}\s*${UNIT}`, 'iu');
const ONE_BEFORE = new RegExp(String.raw`${B}${NUM}\s*${UNIT}\s+(?:[\p{L}-]+\s+){0,2}?(pan|dish|plate|tin)s?${E}`, 'iu');
/** A pan named without a size: kept to words that mean a baking pan. */
const NAMED = new RegExp(String.raw`${B}(moule|lèchefrite|lechefrite|assiette à tarte|plat allant au four|plat de cuisson|plat beurré|plat graissé|baking dish|baking pan|cake pan|loaf pan|pie plate|springform|muffin tin)s?${E}`, 'iu');

const ROUND = new RegExp(String.raw`${B}(rond|ronde|round|tarte|pie|charnière|springform)${E}`, 'iu');
/** One size and a cake pan: round (a square says « carré »). */
const ROUND_ONE = new RegExp(String.raw`${B}(rond|ronde|round|tarte|pie|charnière|springform|gâteau)${E}`, 'iu');
const SQUARE = new RegExp(String.raw`${B}(carré|carrée|square)${E}`, 'iu');
const num = (s: string) => Number(s.replace(',', '.'));
const unitOf = (s: string | undefined): PanSize['unit'] | undefined => (s === undefined ? undefined : /cm/i.test(s) ? 'cm' : 'in');
const singular = (w: string) => w.toLocaleLowerCase('fr').replace(/^lechefrite$/, 'lèchefrite');
/** The word a pan is said by: « assiette à tarte » by « assiette », « baking dish » by « dish ». */
const headWord = (w: string) => singular(w.split(/\s+/).find((x) => /^(moule|lèchefrite|lechefrite|assiette|plat|dish|pan|plate|springform|tin)$/i.test(x)) ?? w.split(/\s+/).at(-1)!);

function shapeOf(context: string, w: number, h: number): PanShape {
	if (new RegExp(String.raw`${B}(pain|loaf)${E}`, 'iu').test(context)) return 'loaf';
	if (w === h && ROUND.test(context)) return 'round';
	return 'rect';
}

/** One text's first pan, if it names one. */
function panIn(text: string): PanMention | undefined {
	let m = RECT_AFTER.exec(text);
	if (m) {
		const [, word, between, a, b, u] = m;
		const w = num(a);
		const h = num(b);
		return { word: singular(word), size: { shape: shapeOf(word + between, w, h), w, h, unit: unitOf(u) ?? 'in' } };
	}
	m = RECT_BEFORE.exec(text);
	if (m) {
		const [all, a, b, u, word] = m;
		return { word: singular(word), size: { shape: shapeOf(all, num(a), num(b)), w: num(a), h: num(b), unit: unitOf(u) ?? 'in' } };
	}
	m = ONE_AFTER.exec(text);
	if (m) {
		const [, word, between, a, u] = m;
		const d = num(a);
		const context = word + ' ' + between;
		const unit = unitOf(u)!;
		if (SQUARE.test(context)) return { word: singular(word), size: { shape: 'rect', w: d, h: d, unit } };
		if (/^assiette/i.test(word) || ROUND_ONE.test(context)) return { word: singular(word), size: { shape: 'round', w: d, h: d, unit } };
		return { word: singular(word) };
	}
	m = ONE_BEFORE.exec(text);
	if (m) {
		const [all, a, u, word] = m;
		const d = num(a);
		const unit = unitOf(u)!;
		if (SQUARE.test(all)) return { word: singular(word), size: { shape: 'rect', w: d, h: d, unit } };
		return { word: singular(word), size: { shape: 'round', w: d, h: d, unit } };
	}
	m = NAMED.exec(text);
	return m ? { word: headWord(m[1]) } : undefined;
}

/** A pan is at least 4 in (10 cm) across: « carrés de 2 po » are pieces, not a pan. */
function sized(p: PanMention | undefined): PanMention | undefined {
	if (!p?.size) return p;
	const min = p.size.unit === 'cm' ? 10 : 4;
	return Math.min(p.size.w, p.size.h) < min || Math.max(p.size.w, p.size.h) > min * 5 ? { word: p.word } : p;
}

/** The first pan the texts name (the steps, then a text yield): one with a size before one without. */
export function findPan(texts: readonly string[]): PanMention | undefined {
	let bare: PanMention | undefined;
	for (const t of texts) {
		const p = sized(panIn(t));
		if (p?.size) return p;
		bare ??= p;
	}
	return bare;
}

/** The bottom's area, in the size's own unit squared. */
export function panArea(s: Pick<PanSize, 'shape' | 'w' | 'h'>): number {
	return s.shape === 'round' ? (Math.PI * s.w * s.w) / 4 : s.w * s.h;
}

/**
 * Up to two ways to bake `factor` times the card's pan at the same depth: the
 * same pan several times, or pans of the usual sizes of its shape, one to
 * three of one size, each within `PAN_TOLERANCE` of the scaled area. Fewer
 * pans first when they fit as well. Empty when none fits (the page then says
 * « × 1 ½ la surface »).
 */
export function panOptions(size: PanSize, factor: number): PanOption[] {
	const target = panArea(size) * factor;
	const sizes: [number, number][] = [[size.w, size.h], ...STANDARD[size.unit][size.shape].filter(([w, h]) => !(Math.min(w, h) === Math.min(size.w, size.h) && Math.max(w, h) === Math.max(size.w, size.h)))];
	const scored: (PanOption & { score: number })[] = [];
	for (const [w, h] of sizes) {
		const s: PanSize = { shape: size.shape, w, h, unit: size.unit };
		for (let count = 1; count <= 3; count++) {
			const err = Math.abs(count * panArea(s) - target) / target;
			if (err <= PAN_TOLERANCE + 1e-9) scored.push({ count, size: s, score: err + PER_PAN * (count - 1) });
		}
	}
	scored.sort((a, b) => a.score - b.score || a.count - b.count);
	return scored.slice(0, 2).map(({ count, size }) => ({ count, size }));
}

// --- whole baked things, one per pan (usability round 4) ----------------------
//
// A recipe that makes « 2 tourtières » (a text yield), or whose pastry line
// says « pour 2 tartes » (its note), bakes one of them per pan: at × 2 it
// makes 4 and needs 4 pans of the card's size, not one pan of twice the area.
// The count is the card's; the words are the card's too.

/** Things baked whole, one per pan, a count of which a yield or a note may give (singular or plural, either language). */
const BAKED = /^(?:tartes?|tourtières?|tourtieres?|quiches?|pâtés?|gâteaux?|gâteau|gateaux?|gateau|pains?|pies?|tarts?|cakes?|loaf|loaves)$/iu;
/** Of those, the ones baked in a pie plate rather than a cake or loaf pan. */
const PIE = /^(?:tartes?|tourtières?|tourtieres?|quiches?|pâtés?|pies?|tarts?)$/iu;
const SMALL: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, one: 1, two: 2, three: 3, four: 4, five: 5 };
/** « pour 2 tartes », « pour deux tourtières de 9 po », « for 2 pies ». */
const FOR_COUNT = /^(pour|for)(\s+)(\d{1,2}|un|une|deux|trois|quatre|cinq|six|one|two|three|four|five)(\s+)([\p{L}]+)(.*)$/iu;

export interface BakedCount {
	/** How many the card makes. */
	count: number;
	/** The card's word for one of them, as written (`tourtières`). */
	word: string;
	/** Baked in a pie plate (a tarte, a tourtière), else in a cake or loaf pan. */
	pie: boolean;
}

const firstWord = (s: string) => /^[\p{L}]+/u.exec(s.trim())?.[0] ?? '';
const baked = (count: number, word: string): BakedCount | undefined =>
	count > 0 && BAKED.test(word) ? { count, word, pie: PIE.test(word) } : undefined;

/** A note's « pour 2 tartes », read; undefined for any other note (a can's size never scales). */
function noteCount(note: string): BakedCount | undefined {
	const m = FOR_COUNT.exec(note.trim());
	if (!m) return undefined;
	const n = /^\d/.test(m[3]) ? Number(m[3]) : SMALL[m[3].toLowerCase()];
	return baked(n, m[5]);
}

/**
 * What a recipe makes, when it makes whole baked things: its text yield
 * (« 2 tourtières »), an object yield of pieces whose note names them, else
 * the first ingredient note that says « pour 2 tartes ».
 */
export function bakedCount(recipe: {
	yield?: string | { qty?: { value: number }; unit?: string; note?: string } | null;
	ingredients: { items: { note?: string }[] }[];
}): BakedCount | undefined {
	const y = recipe.yield;
	if (typeof y === 'string') {
		const m = /^(\d{1,2})\s+(.*)$/u.exec(y.trim());
		const b = m ? baked(Number(m[1]), firstWord(m[2])) : undefined;
		if (b) return b;
	} else if (y?.qty && (!y.unit || y.unit === 'piece') && y.note) {
		const b = baked(y.qty.value, firstWord(y.note));
		if (b) return b;
	}
	for (const g of recipe.ingredients) for (const it of g.items) if (it.note) {
		const b = noteCount(it.note);
		if (b) return b;
	}
	return undefined;
}

/** A word for one or for several (`tarte`/`tartes`, `gâteau`/`gâteaux`, `loaf`/`loaves`), from either form. */
export function countWord(word: string, n: number, lang: 'fr' | 'en'): string {
	const many = lang === 'fr' ? n >= 2 : n > 1;
	const lower = word.toLowerCase();
	if (lower === 'loaf' || lower === 'loaves') return many ? 'loaves' : 'loaf';
	const one = /eaux$/i.test(word) ? word.slice(0, -1) : /s$/i.test(word) ? word.slice(0, -1) : word;
	if (!many) return one;
	return /eau$/i.test(one) ? `${one}x` : /[sx]$/i.test(one) ? one : `${one}s`;
}

/** A count at a factor: whole when it is, else rounded (at least 1) and marked. */
export function scaledCount(count: number, factor: number): { n: number; approx: boolean } {
	const v = count * factor;
	const r = Math.round(v);
	return Math.abs(v - r) < 1e-9 ? { n: r, approx: false } : { n: Math.max(1, r), approx: true };
}

/**
 * An ingredient's note at a factor: « pour 2 tartes » × 2 → « pour 4 tartes »
 * (× 1 ⅓ → « pour ≈ 3 tartes »). Any other note, as written.
 */
export function scaleNote(note: string, factor: number, lang: 'fr' | 'en'): string {
	if (factor === 1) return note;
	const m = FOR_COUNT.exec(note.trim());
	const b = m ? noteCount(note) : undefined;
	if (!m || !b) return note;
	const s = scaledCount(b.count, factor);
	return `${m[1]}${m[2]}${s.approx ? '≈ ' : ''}${s.n}${m[4]}${countWord(m[5], s.n, lang)}${m[6]}`;
}

/** A pan's words for `n` of them: French marks the first word (« assiettes à tarte »), English the last (« pie plates »). */
export function pluralPan(word: string, n: number, lang: 'fr' | 'en'): string {
	const words = word.split(' ');
	const at = lang === 'en' ? words.length - 1 : 0;
	const w = words[at];
	words[at] = lang === 'en' && n > 1 && /(sh|ch|s|x)$/.test(w) ? `${w}es` : countWord(w, n, lang);
	return words.join(' ');
}
