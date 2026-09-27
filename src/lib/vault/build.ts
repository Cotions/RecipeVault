// Frontmatter data → typed Recipe. Only called once the checker found no
// errors, so the shapes are known to be valid; anything else is dropped.

import { parseDuration } from './duration';
import { markedNumber, parseQuantity } from './quantity';
import { slugify } from './slug';
import type {
	Alt,
	Ingredient,
	IngredientGroup,
	Marker,
	Oven,
	Quantity,
	Recipe,
	Source,
	Times,
	YieldObject
} from './types';
import { isUnit } from './vocab';
import { isBlank, isMap } from './rules/context';

// Text fields: a number is kept as text (`note: 796`); anything else that is not
// a string was already rejected by E218.
const str = (v: unknown): string | undefined =>
	typeof v === 'number' ? String(v) : typeof v === 'string' && v.trim() ? v : undefined;
const strs = (v: unknown): string[] =>
	Array.isArray(v) ? v.map(str).filter((s): s is string => s !== undefined) : [];
const int = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

function qty(v: unknown): Quantity | undefined {
	if (v === undefined || v === null) return undefined;
	const q = parseQuantity(v);
	return q.ok ? { raw: v as number | string, value: q.value } : undefined;
}

/** `recipe: "[[pate-brisee]]"` (edited in Obsidian) means `recipe: pate-brisee`. */
export function recipeRef(v: unknown): string | undefined {
	const s = str(v);
	return s?.trim().replace(/^\[\[(.*)\]\]$/, '$1').trim();
}

function ingredient(v: Record<string, unknown>): Ingredient {
	const out: Ingredient = { name: v.name as string };
	const q = qty(v.qty);
	if (q) out.qty = q;
	const qm = qty(v.qty_max);
	if (qm) out.qtyMax = qm;
	if (isUnit(v.unit)) out.unit = v.unit;
	if (isMap(v.alt)) {
		const alt = { qty: qty(v.alt.qty), unit: v.alt.unit } as Alt;
		const altMax = qty(v.alt.qty_max);
		if (altMax) alt.qtyMax = altMax;
		out.alt = alt;
	}
	if (str(v.brand)) out.brand = str(v.brand);
	if (Array.isArray(v.or))
		out.or = v.or.map((o) => (typeof o === 'string' ? { name: o } : ingredient(o as Record<string, unknown>)));
	if (str(v.note)) out.note = str(v.note);
	if (str(v.prep)) out.prep = str(v.prep);
	if (v.to_taste === true) out.toTaste = true;
	if (v.optional === true) out.optional = true;
	const ref = recipeRef(v.recipe);
	if (ref) out.recipe = ref;
	if (v.buy_instead === true) out.buyInstead = true;
	if (str(v.item)) out.item = str(v.item);
	return out;
}

export function buildRecipe(fm: Record<string, unknown>, markers: Marker[]): Recipe {
	const title = fm.title as string;
	const recipe: Recipe = {
		schema: fm.schema as number,
		title,
		slug: str(fm.slug) ?? slugify(title),
		slugDerived: str(fm.slug) === undefined,
		lang: fm.lang === 'en' ? 'en' : 'fr',
		tags: strs(fm.tags),
		season: strs(fm.season),
		ingredients: (fm.ingredients as Record<string, unknown>[]).map((g): IngredientGroup => {
			const group: IngredientGroup = {
				items: (g.items as Record<string, unknown>[]).map(ingredient)
			};
			if (str(g.group)) group.group = str(g.group);
			if (g.optional === true) group.optional = true;
			return group;
		}),
		markers
	};
	if (str(fm.family)) recipe.family = str(fm.family);
	if (str(fm.variant)) recipe.variant = str(fm.variant);
	if (isMap(fm.source)) {
		const s = fm.source;
		const source: Source = {};
		if (!isBlank(s.type)) source.type = s.type as Source['type'];
		for (const k of ['author', 'url', 'title', 'note'] as const) if (str(s[k])) source[k] = str(s[k]);
		if (typeof s.page === 'number' || str(s.page)) source.page = s.page as string | number;
		recipe.source = source;
	}
	if (isMap(fm.times)) {
		const times: Times = {};
		for (const k of ['prep', 'cook', 'rest', 'total'] as const) {
			const d = parseDuration(fm.times[k]);
			if (d) times[k] = d;
		}
		recipe.times = times;
	}
	if (isMap(fm.oven)) {
		const oven: Oven = { temp: markedNumber(fm.oven.temp)!, unit: fm.oven.unit as Oven['unit'] };
		if (typeof fm.oven.temp === 'string') oven.tempRaw = fm.oven.temp;
		const tempMax = markedNumber(fm.oven.temp_max);
		if (tempMax !== undefined) oven.tempMax = tempMax;
		if (typeof fm.oven.temp_max === 'string') oven.tempMaxRaw = fm.oven.temp_max;
		recipe.oven = oven;
	}
	// A marker is kept as written (`"4 [?]"`) so saving the file does not drop it.
	const servings = markedNumber(fm.servings);
	if (servings) recipe.servings = servings;
	if (servings && typeof fm.servings === 'string') recipe.servingsRaw = fm.servings;
	const servingsMax = markedNumber(fm.servings_max);
	if (servingsMax) recipe.servingsMax = servingsMax;
	if (servingsMax && typeof fm.servings_max === 'string') recipe.servingsMaxRaw = fm.servings_max;
	if (str(fm.servings_note)) recipe.servingsNote = str(fm.servings_note);
	if (str(fm.yield)) recipe.yield = str(fm.yield);
	else if (isMap(fm.yield)) {
		const y: YieldObject = {};
		const q = qty(fm.yield.qty);
		if (q) y.qty = q;
		const qm = qty(fm.yield.qty_max);
		if (qm) y.qtyMax = qm;
		if (isUnit(fm.yield.unit)) y.unit = fm.yield.unit;
		if (str(fm.yield.note)) y.note = str(fm.yield.note);
		recipe.yield = y;
	}
	if (int(fm.difficulty)) recipe.difficulty = int(fm.difficulty);
	if (int(fm.rating)) recipe.rating = int(fm.rating);
	if (isMap(fm.media)) {
		recipe.media = Object.fromEntries(
			Object.entries(fm.media).filter((e): e is [string, string] => typeof e[1] === 'string')
		);
	}
	for (const [key, prop] of [
		['status', 'status'],
		['added', 'added'],
		['updated', 'updated'],
		['extracted_by', 'extractedBy']
	] as const) {
		if (str(fm[key])) recipe[prop] = str(fm[key]);
	}
	return recipe;
}
