// Controlled vocabularies from docs/VOCAB.md and the key lists from
// docs/RECIPE-SCHEMA.md. The seed lists live here until the vault's vocab/ data
// exists; the unit list must match the prompt in docs/AI-TEMPLATE.md.

import { editDistance, fold, stripAccents } from './normalize';
import { UNITS, type Lang, type SectionKind, type SourceType, type Unit } from './types';

export { UNITS };

/** Canonical unit → aliases, Quebec French first. From docs/VOCAB.md. */
export const UNIT_ALIASES: Record<Unit, string[]> = {
	g: ['g', 'gr', 'gramme', 'grammes', 'gram', 'grams'],
	kg: ['kg', 'kilo', 'kilos', 'kilogramme'],
	ml: ['ml', 'millilitre', 'millilitres'],
	cl: ['cl', 'centilitre'],
	l: ['l', 'litre', 'litres', 'liter', 'L'],
	cup: ['tasse', 'tasses', 't.', 't', 'cup', 'cups', 'c.'],
	tbsp: [
		'c. à table',
		'c. à soupe',
		'c.s.',
		'c. à s.',
		'c. table',
		'c. soupe',
		'cuillère à soupe',
		'cuil. à soupe',
		'tablespoon',
		'tbsp',
		'T'
	],
	tsp: [
		'c. à thé',
		'c.t.',
		'c. à t.',
		'c. à t',
		'c. thé',
		'c. à café',
		'cuillère à thé',
		'cuillère à café',
		'cuil. à thé',
		'teaspoon',
		'tsp'
	],
	pinch: ['pincée', 'pincee', 'pinch'],
	drop: ['goutte', 'gouttes', 'drop', 'drops'],
	lb: ['lb', 'lbs', 'livre', 'livres', 'pound', 'pounds'],
	oz: ['oz', 'once', 'onces', 'ounce', 'ounces'],
	qt: ['pinte', 'pintes', 'quart', 'qt'],
	pint: ['chopine', 'chopines', 'pint'],
	piece: ['pièce', 'piece', 'pcs', 'unité', 'unite'],
	clove: ['gousse', 'gousses', 'clove', 'cloves'],
	leaf: ['feuille', 'feuilles', 'leaf', 'leaves'],
	sprig: ['brin', 'brins', 'sprig'],
	stalk: ['branche de céleri', 'tige', 'stalk'],
	bunch: ['botte', 'bouquet', 'bunch'],
	slice: ['tranche', 'tranches', 'slice', 'slices'],
	can: ['boîte', 'boite', 'bte', 'conserve', 'can', 'tin'],
	packet: ['sachet', 'paquet', 'enveloppe', 'packet', 'sachets', 'pqt'],
	bottle: ['bouteille', 'bouteilles', 'bottle', 'bottles'],
	jar: ['pot', 'pots', 'jar', 'jars'],
	bag: ['sac', 'sacs', 'bag', 'bags']
};

export function isUnit(v: unknown): v is Unit {
	return typeof v === 'string' && (UNITS as readonly string[]).includes(v);
}

// `t`/`T` depend on the recipe's language (docs/VOCAB.md): in French `t.` is a
// cup; in English `T` is a tablespoon and `t` a teaspoon. Cases the doc does not
// settle (French `T`, English `t.`) resolve to nothing rather than a guess.
const LANG_ALIASES: Record<Lang, Record<string, Unit | null>> = {
	fr: { t: 'cup', 't.': 'cup', T: null, 'T.': null },
	en: { t: 'tsp', 'T': 'tbsp', 't.': null, 'T.': null }
};

const dotless = (s: string) => fold(s).replace(/[.\s]/g, '');

const aliasIndex = new Map<string, Unit>();
const dotlessIndex = new Map<string, Unit>();
for (const unit of UNITS) {
	for (const alias of UNIT_ALIASES[unit]) {
		if (alias in LANG_ALIASES.fr) continue;
		aliasIndex.set(fold(alias), unit);
		const d = dotless(alias);
		if (d.length > 1) dotlessIndex.set(d, unit);
	}
}

/**
 * The canonical unit an alias stands for, in the given language. `null` when the
 * alias is known but ambiguous in that language; `undefined` when unknown.
 */
export function unitForAlias(alias: string, lang: Lang): Unit | null | undefined {
	const s = alias.normalize('NFC').trim();
	if (s in LANG_ALIASES[lang]) return LANG_ALIASES[lang][s];
	const exact = aliasIndex.get(fold(s));
	if (exact) return exact;
	const d = dotless(s);
	return d.length > 1 ? dotlessIndex.get(d) : undefined;
}

// Pattern for "a number, then a unit alias" inside free text (E210, E216). Run
// against accent-stripped text; all aliases of both languages are included since
// this only detects, it does not convert.
// '1-1/2' is a mixed number as recipe cards write it, not a range. A leading
// decimal point (`.75 l`) is a number too, and a match never starts right
// after a dot, nor after a digit and a comma: `.75 l` is 0.75 l, never 75 l
// (`de.75 l` reads as no amount at all rather than a wrong one).
const NUMBER_SRC = String.raw`(\d+-\d+\/\d+|\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?\s*[½¼¾⅓⅔⅛]|\d+(?:[.,]\d+)?|[.,]\d+|[½¼¾⅓⅔⅛])`;
const ALIAS_SRC = [...new Set(UNITS.flatMap((u) => UNIT_ALIASES[u]).map((a) => stripAccents(a)))]
	.sort((a, b) => b.length - a.length)
	.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s*'))
	.join('|');
const QTY_UNIT_RE_ALL = new RegExp(
	String.raw`(?<![\p{L}\p{N}.]|\p{N},)${NUMBER_SRC}\s*(${ALIAS_SRC})(?![\p{L}\p{N}])`,
	'giu'
);

export interface QtyUnitMatch {
	/** The whole match, as written in the original text. */
	match: string;
	/** The number as written, except a leading decimal point gets its 0 (`.75` → `0.75`). */
	qty: string;
	unitText: string;
	/** Offsets of the match in the original text. */
	start: number;
	end: number;
}

/** Find "number followed by a unit" in text, e.g. '2 lbs', '1/2 tasse'. */
export function findQtyUnit(text: string): QtyUnitMatch | undefined {
	return findAllQtyUnits(text)[0];
}

/** Every "number followed by a unit" in text, in order. */
export function findAllQtyUnits(text: string): QtyUnitMatch[] {
	// Strip accents char by char, remembering where each flat char came from, so
	// matches can be cut out of the original text with their accents intact.
	const src = text.normalize('NFC');
	let flat = '';
	const origin: number[] = [];
	let i = 0;
	for (const ch of src) {
		const s = stripAccents(ch);
		for (let k = 0; k < s.length; k++) origin.push(i);
		flat += s;
		i += ch.length;
	}
	origin.push(src.length);
	return [...flat.matchAll(QTY_UNIT_RE_ALL)].map((m) => {
		const at = m.index ?? 0;
		const start = origin[at];
		const end = origin[at + m[0].length];
		const unitStart = origin[at + m[0].length - m[2].length];
		// `.75` → `0.75`: the qty as a number reads it.
		return { match: src.slice(start, end), qty: m[1].replace(/^[.,](?=\d)/, '0.'), unitText: src.slice(unitStart, end), start, end };
	});
}

/** Units that count or contain rather than measure: a size in `note` is fine with these. */
export const COUNT_UNITS: readonly Unit[] = [
	'piece',
	'clove',
	'leaf',
	'sprig',
	'stalk',
	'bunch',
	'slice',
	'can',
	'packet',
	'bottle',
	'jar',
	'bag'
];

/** Body headings, docs/RECIPE-SCHEMA.md. Matched case- and diacritic-insensitively. */
export const HEADING_ALIASES: Record<Exclude<SectionKind, 'other'>, string[]> = {
	method: ['Préparation', 'Preparation', 'Instructions', 'Méthode'],
	notes: ['Notes', 'Remarques'],
	variants: ['Variantes', 'Variants'],
	alternatives: ['Alternatives', 'Substitutions']
};

export function headingKind(heading: string): SectionKind {
	const h = fold(heading).replace(/\s*:$/, '');
	for (const [kind, aliases] of Object.entries(HEADING_ALIASES)) {
		if (aliases.some((a) => fold(a) === h)) return kind as SectionKind;
	}
	return 'other';
}

export const SOURCE_TYPES: readonly SourceType[] = [
	'family',
	'book',
	'website',
	'magazine',
	'tv',
	'invented'
];

export const SEASONS = ['printemps', 'ete', 'automne', 'hiver'] as const;

/** docs/VOCAB.md "Seasons": each value and alias, folded, → the canonical season. */
export const SEASON_ALIASES: Readonly<Record<string, (typeof SEASONS)[number]>> = {
	printemps: 'printemps',
	spring: 'printemps',
	ete: 'ete',
	summer: 'ete',
	automne: 'automne',
	autumn: 'automne',
	fall: 'automne',
	hiver: 'hiver',
	winter: 'hiver'
};

/** The canonical season for a value or alias (`été`, `Winter`), else undefined. */
export function seasonFor(v: string): (typeof SEASONS)[number] | undefined {
	return SEASON_ALIASES[fold(v)];
}

/** The closest season to an unknown value, within edit distance 2. */
export function suggestSeason(v: string): (typeof SEASONS)[number] | undefined {
	const k = fold(v);
	let best: string | undefined;
	let bestD = Infinity;
	for (const a of Object.keys(SEASON_ALIASES)) {
		const d = editDistance(k, a);
		if (d < bestD) {
			bestD = d;
			best = a;
		}
	}
	return best !== undefined && bestD <= 2 ? SEASON_ALIASES[best] : undefined;
}

/** Values of `extracted_by`: typed by a person, read by an AI, imported from a web page's JSON-LD. */
export const EXTRACTED_BY = ['hand', 'ai', 'web'] as const;

export const SCHEMA_VERSIONS = [3] as const;

/** Allowed keys per object, from the frontmatter reference in docs/RECIPE-SCHEMA.md. */
export const ALLOWED_KEYS = {
	top: [
		'schema',
		'title',
		'slug',
		'lang',
		'family',
		'variant',
		'source',
		'times',
		'oven',
		'servings',
		'servings_max',
		'servings_note',
		'yield',
		'tags',
		'season',
		'difficulty',
		'rating',
		'ingredients',
		'media',
		'status',
		'added',
		'updated',
		'extracted_by'
	],
	source: ['type', 'author', 'url', 'title', 'page', 'note'],
	times: ['prep', 'cook', 'rest', 'total'],
	oven: ['temp', 'temp_max', 'unit'],
	yield: ['qty', 'qty_max', 'unit', 'note'],
	media: ['final'],
	group: ['group', 'items', 'optional'],
	item: [
		'name',
		'qty',
		'qty_max',
		'unit',
		'alt',
		'brand',
		'or',
		'note',
		'prep',
		'to_taste',
		'optional',
		'recipe',
		'buy_instead',
		'item'
	],
	alt: ['qty', 'qty_max', 'unit']
} as const;

// Words an AI reaches for instead of the real key — French, or near-English.
const KEY_SYNONYMS: Record<string, string> = {
	titre: 'title',
	langue: 'lang',
	famille: 'family',
	variante: 'variant',
	temps: 'times',
	time: 'times',
	four: 'oven',
	portions: 'servings',
	portion: 'servings',
	rendement: 'yield',
	etiquettes: 'tags',
	saison: 'season',
	seasons: 'season',
	difficulte: 'difficulty',
	ingredient: 'ingredients',
	auteur: 'author',
	quantite: 'qty',
	quantity: 'qty',
	unite: 'unit',
	nom: 'name',
	marque: 'brand',
	preparation: 'prep',
	cuisson: 'cook',
	repos: 'rest',
	temperature: 'temp',
	groupe: 'group'
};

/** Top-level keys that belong inside a nested object. */
export const MISPLACED_TOP_KEYS: Record<string, string> = {
	author: 'source.author',
	auteur: 'source.author',
	url: 'source.url',
	page: 'source.page',
	prep: 'times.prep',
	cook: 'times.cook',
	rest: 'times.rest',
	total: 'times.total',
	temp: 'oven.temp',
	temperature: 'oven.temp',
	final: 'media.final'
};

/** Closest allowed key for an unknown one, or undefined. */
export function suggestKey(key: string, allowed: readonly string[]): string | undefined {
	const k = fold(key);
	const syn = KEY_SYNONYMS[k];
	if (syn && allowed.includes(syn)) return syn;
	let best: string | undefined;
	let bestD = Infinity;
	for (const a of allowed) {
		const d = editDistance(k, a);
		if (d < bestD) {
			bestD = d;
			best = a;
		}
	}
	return bestD <= 2 ? best : undefined;
}
