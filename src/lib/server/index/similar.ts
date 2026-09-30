// The duplicate model (plan 05, Phase 5; docs/INGREDIENTS.md, "Duplicates"):
// every recipe's ingredient set from the index, the rarity weights and every
// pair above the threshold, built once per index state (`indexMemo`, like the
// pantry model) — a save, a sync or a registry edit (a queue "Relier" can make
// a pair) rebuilds it on the next read. Pairs a person settled as "Recettes
// différentes" (vocab/distinct.yaml, src/lib/server/duplicates.ts) are left
// out by the callers, per read: the file is small and edited as text.

import {
	batchPairs,
	DUPLICATE_THRESHOLD,
	elementOf,
	MIN_ELEMENTS,
	elementSet,
	methodShingles,
	rarityWeights,
	recipeLines,
	similarPairs,
	similarTo,
	simIndex,
	splitSets,
	weightOf,
	type SimIndex,
	type SimLine,
	type SimPair,
	type SimRecipe
} from '../../ingredients/similar';
import { stripMarkers } from '../../vault/markers';
import type { Recipe } from '../../vault/types';
import type { VaultVocab } from '../vocab';
import type { DB } from './db';
import { indexMemo } from './memo';
import { getResolver } from './resolve';

export interface DuplicateModel {
	recipes: Map<string, SimRecipe & { title: string }>;
	weights: Map<string, number>;
	/** Every pair above the threshold, family pairs out (Q16 C); dismissed pairs still in. */
	pairs: SimPair[];
	index: SimIndex;
	/** How an element reads: the registry name, the written name of an unresolved line, the sub-recipe's title. */
	labels: Map<string, string>;
	ms: number;
}

interface Row {
	slug: string;
	optional: number;
	group_optional: number;
	to_taste: number;
	recipe: string | null;
	item: string | null;
	key: string;
	qty: number | null;
	qty_max: number | null;
	unit: string | null;
	name: string;
}

const line = (r: Row): SimLine => ({
	item: r.item,
	key: r.key,
	recipe: r.recipe,
	optional: r.optional === 1,
	groupOptional: r.group_optional === 1,
	toTaste: r.to_taste === 1,
	qty: r.qty,
	qtyMax: r.qty_max,
	unit: r.unit
});

/** File hash → its method's word pairs, from the last build: a rebuild after one save shingles one body. */
let methodCache = new Map<string, string[]>();

function build(db: DB, threshold: number): DuplicateModel {
	const t0 = performance.now();
	const byRecipe = new Map<string, SimLine[]>();
	const labels = new Map<string, string>();
	for (const r of db
		.prepare('SELECT slug, optional, group_optional, to_taste, recipe, item, key, qty, qty_max, unit, name FROM ingredients ORDER BY slug, position')
		.all() as Row[]) {
		const l = line(r);
		(byRecipe.get(r.slug) ?? byRecipe.set(r.slug, []).get(r.slug)!).push(l);
		const e = elementOf(l);
		if (!labels.has(e) && !l.item && !l.recipe) labels.set(e, stripMarkers(r.name).trim());
	}
	for (const r of db.prepare('SELECT slug, name FROM registry').all() as { slug: string; name: string }[]) labels.set(r.slug, r.name);
	const recipes = new Map<string, SimRecipe & { title: string }>();
	const seen = new Map<string, string[]>();
	for (const r of db.prepare('SELECT slug, title, family, file_hash, body_md FROM recipes').all() as {
		slug: string;
		title: string;
		family: string | null;
		file_hash: string;
		body_md: string;
	}[]) {
		const set = elementSet(byRecipe.get(r.slug) ?? []);
		// The method's word pairs only where they can matter (a set that can pair at all), kept per file across rebuilds.
		let method: string[] | undefined;
		if (set.elements.length >= MIN_ELEMENTS) {
			method = methodCache.get(r.file_hash) ?? methodShingles(r.body_md);
			seen.set(r.file_hash, method);
		}
		recipes.set(r.slug, { slug: r.slug, title: stripMarkers(r.title), family: r.family, ...set, ...(method ? { method } : {}) });
		labels.set(`r:${r.slug}`, stripMarkers(r.title));
	}
	methodCache = seen;
	const list = [...recipes.values()];
	const weights = rarityWeights(list);
	const n = list.length;
	const weight = (e: string) => weightOf(weights, n, e);
	return { recipes, weights, pairs: similarPairs(list, weight, threshold), index: simIndex(list), labels, ms: performance.now() - t0 };
}

/** The model for the index as it is now. */
export function duplicateModel(db: DB, threshold = DUPLICATE_THRESHOLD): DuplicateModel {
	return indexMemo(db, `duplicates:${threshold}`, () => build(db, threshold));
}

/** An element as shown: `r:` a recipe's title, `k:` the written name, else the registry name (the slug when unknown). */
export function elementLabel(m: DuplicateModel, e: string): string {
	return m.labels.get(e) ?? (e.startsWith('k:') || e.startsWith('r:') ? e.slice(2) : e);
}

/** A pair's key in the dismiss file and in sets: the two slugs, sorted. */
export const pairKey = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`);

export interface PairDetail {
	a: string;
	b: string;
	score: number;
	shared: string[];
	onlyA: string[];
	onlyB: string[];
}

/** Shared elements and those only in each, as labels. */
export function pairDetail(m: DuplicateModel, p: SimPair): PairDetail {
	const x = m.recipes.get(p.a)!;
	const y = m.recipes.get(p.b)!;
	const s = splitSets(x.elements, y.elements);
	const lab = (xs: string[]) => xs.map((e) => elementLabel(m, e)).sort((u, v) => u.localeCompare(v, 'fr'));
	return { ...p, shared: lab(s.shared), onlyA: lab(s.onlyA), onlyB: lab(s.onlyB) };
}

/** Every pair above the threshold that no one has settled, most similar first. */
export function allPairs(db: DB, dismissed: Set<string> = new Set()): SimPair[] {
	return duplicateModel(db).pairs.filter((p) => !dismissed.has(pairKey(p.a, p.b)));
}

/**
 * The vault recipes close to a recipe not yet saved (a paste, the form): its
 * lines resolved as the index would resolve them. `own`: the slug it is saved
 * under (an edit, or a paste over itself), left out. `body`: its Markdown
 * body, for the second signal (the same method); without it, ingredients only.
 */
export function pairsFor(
	db: DB,
	vocab: Pick<VaultVocab, 'normalize'> | (() => Pick<VaultVocab, 'normalize'>),
	recipe: Pick<Recipe, 'ingredients' | 'lang' | 'family'>,
	opts: { own?: string; dismissed?: Set<string>; body?: string } = {}
): { slug: string; title: string; family: string | null; score: number; method?: true }[] {
	const m = duplicateModel(db);
	const lines = recipeLines(recipe, getResolver(db, vocab));
	const q = { ...elementSet(lines), family: recipe.family ?? null, ...(opts.body !== undefined ? { method: methodShingles(opts.body) } : {}) };
	const weight = (e: string) => weightOf(m.weights, m.recipes.size, e);
	return similarTo(q, m.index, weight, DUPLICATE_THRESHOLD, opts.own)
		.filter((x) => !(opts.own && opts.dismissed?.has(pairKey(opts.own, x.slug))))
		.map((x) => {
			const r = m.recipes.get(x.slug)!;
			return { slug: x.slug, title: r.title, family: r.family, score: x.score, ...(x.method ? { method: x.method } : {}) };
		});
}

/**
 * W505 inside one batch (a paste, `vault add` with several files): for each
 * recipe, the earlier recipes of the batch close to it, scored with the
 * vault's weights as `pairsFor` does. `slugs`: the slug each file is saved
 * under, so a pair settled as different recipes (`dismissed`) is left out.
 */
export function batchPairsFor(
	db: DB,
	vocab: Pick<VaultVocab, 'normalize'> | (() => Pick<VaultVocab, 'normalize'>),
	recipes: (Pick<Recipe, 'ingredients' | 'lang' | 'family'> | null | undefined)[],
	opts: { slugs?: (string | undefined)[]; dismissed?: Set<string>; bodies?: (string | undefined)[] } = {}
): { index: number; score: number; method?: true }[][] {
	if (recipes.filter(Boolean).length < 2) return recipes.map(() => []);
	const m = duplicateModel(db);
	const resolver = getResolver(db, vocab);
	const sets = recipes.map((r, i) => {
		if (!r) return null;
		const body = opts.bodies?.[i];
		return { ...elementSet(recipeLines(r, resolver)), family: r.family ?? null, ...(body !== undefined ? { method: methodShingles(body) } : {}) };
	});
	const weight = (e: string) => weightOf(m.weights, m.recipes.size, e);
	const slug = (i: number) => opts.slugs?.[i];
	return batchPairs(sets, weight, DUPLICATE_THRESHOLD, (i, j) => {
		const [a, b] = [slug(i), slug(j)];
		return !!a && !!b && a !== b && !!opts.dismissed?.has(pairKey(a, b));
	});
}
