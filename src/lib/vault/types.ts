// Types shared by the parser, the checker and (later) the save path and index.
// The file format itself is specified in docs/RECIPE-SCHEMA.md.

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
	/** Stable code from docs/VALIDATION.md, e.g. 'E201'. */
	code: string;
	severity: Severity;
	/** Data path such as 'ingredients[0].items[3].unit' — never a line number. */
	path: string | null;
	/** States the fault. */
	message: string;
	/** States the correction, when one can be stated. */
	fix?: string;
	/** Set in batch mode. */
	file?: string;
}

export type Lang = 'fr' | 'en';

export const UNITS = [
	'g',
	'kg',
	'ml',
	'cl',
	'l',
	'cup',
	'tbsp',
	'tsp',
	'pinch',
	'drop',
	'lb',
	'oz',
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
	'bag',
	'qt',
	'pint'
] as const;
export type Unit = (typeof UNITS)[number];

export type MarkerKind = 'uncertain' | 'uncertain-alt' | 'illegible' | 'added';

export interface Marker {
	kind: MarkerKind;
	/** Where the marker was found: a frontmatter path, or a body path like 'body.method.steps[2]'. */
	path: string;
	/** The marker exactly as written, e.g. '[?: 250]'. */
	text: string;
	/** The other plausible reading, for '[?: other]'. */
	alternative?: string;
}

export interface Quantity {
	/** As written in the file: 2, 0.5, "1 1/2", "250 [?]". */
	raw: number | string;
	/** Numeric value, markers stripped: 1.5 for "1 1/2". */
	value: number;
}

export interface Duration {
	/** As written, e.g. '45m-50m'. */
	raw: string;
	seconds: number;
	/** Upper bound of a range. */
	maxSeconds?: number;
}

export interface Alt {
	qty: Quantity;
	qtyMax?: Quantity;
	unit: Unit;
}

export interface Ingredient {
	name: string;
	qty?: Quantity;
	qtyMax?: Quantity;
	unit?: Unit;
	alt?: Alt;
	brand?: string;
	/** Replacements. A plain-name entry in the file becomes `{ name }` here. */
	or?: Ingredient[];
	note?: string;
	prep?: string;
	toTaste?: boolean;
	optional?: boolean;
	/** Slug of a sub-recipe; Obsidian `[[slug]]` brackets already stripped. */
	recipe?: string;
	buyInstead?: boolean;
	/** Manual registry override. */
	item?: string;
}

export interface IngredientGroup {
	group?: string;
	optional?: boolean;
	items: Ingredient[];
}

export type SourceType = 'family' | 'book' | 'website' | 'magazine' | 'tv' | 'invented';

export interface Source {
	/** Optional: absent when the kind of source is not evident. */
	type?: SourceType;
	author?: string;
	url?: string;
	title?: string;
	page?: string | number;
	note?: string;
}

export interface Times {
	prep?: Duration;
	cook?: Duration;
	rest?: Duration;
	total?: Duration;
}

export interface Oven {
	temp: number;
	tempMax?: number;
	unit: 'F' | 'C';
	/** `temp` as written when it carries a marker: `"350 [?]"`. */
	tempRaw?: string;
	/** `temp_max` as written when it carries a marker. */
	tempMaxRaw?: string;
}

export interface YieldObject {
	qty?: Quantity;
	qtyMax?: Quantity;
	unit?: Unit;
	note?: string;
}

export interface Recipe {
	schema: number;
	title: string;
	slug: string;
	/** True when `slug` was absent from the file and derived from the title. */
	slugDerived: boolean;
	lang: Lang;
	family?: string;
	variant?: string;
	source?: Source;
	times?: Times;
	oven?: Oven;
	servings?: number;
	servingsMax?: number;
	/** `servings` as written when it carries a marker: `"4 [?]"`. */
	servingsRaw?: string;
	/** `servings_max` as written when it carries a marker. */
	servingsMaxRaw?: string;
	servingsNote?: string;
	yield?: string | YieldObject;
	tags: string[];
	season: string[];
	difficulty?: number;
	rating?: number;
	ingredients: IngredientGroup[];
	media?: Record<string, string>;
	status?: string;
	added?: string;
	updated?: string;
	extractedBy?: string;
	/** Every marker in the file, frontmatter and body. */
	markers: Marker[];
}

export type SectionKind = 'method' | 'notes' | 'variants' | 'alternatives' | 'other';

export interface Section {
	kind: SectionKind;
	/** Heading text as written, without the leading hashes. */
	heading: string;
	level: number;
	/** Section content, heading line excluded. */
	text: string;
}

export interface Step {
	/** The number as written; the app renumbers, so repeated `1.` is fine. */
	number: number;
	/** Step text, continuation lines joined with a space. */
	text: string;
	/** The `###` heading the step sits under, if any. */
	subheading?: string;
}

export interface Body {
	/** Text before the first heading. */
	preamble: string;
	sections: Section[];
	/** Numbered steps of the method section. */
	steps: Step[];
}
