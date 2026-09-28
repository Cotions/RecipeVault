// Data for the recipe page and kitchen mode.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Ingredient, Recipe } from '../vault/types';
import type { App } from './app';
import { familyDiff, getRecipe, titles as titlesOf, usedBy, type RecipeDetail } from './index/query';
import { currentFile } from './save';
import { unresolvedDiagnostics } from './index/resolve';
import { recipeVocabDiagnostics } from './checkopts';
import { DEFAULT_LOCALE } from './config';
import { costOfRecipe } from './cost';
import { loadConversions } from './vocab';
import type { CostLineView, CostView } from '../ingredients/cost';

const WIKI_RE = /\[\[([^\]|\n]+?)(?:\|[^\]\n]+)?\]\]/g;

/** Every slug a recipe points at: sub-recipes (with `or` entries) and body wikilinks. */
export function referencedSlugs(recipe: Recipe, body: string): string[] {
	const out = new Set<string>();
	const visit = (it: Ingredient) => {
		if (it.recipe) out.add(it.recipe);
		it.or?.forEach(visit);
	};
	recipe.ingredients.forEach((g) => g.items.forEach(visit));
	for (const m of body.matchAll(WIKI_RE)) out.add(m[1].trim());
	return [...out];
}

export function photoUrl(app: App, recipe: Recipe): string | null {
	const file = recipe.media?.final;
	if (!file || !/^[\w][\w.-]*$/.test(file)) return null;
	if (!existsSync(join(app.ctx.paths.media, recipe.slug, file))) return null;
	return `/media/${recipe.slug}/${encodeURIComponent(file)}`;
}

export interface SubRecipe {
	slug: string;
	recipe: Recipe;
	body: string;
}

export function loadRecipePage(app: App, slug: string) {
	const detail: RecipeDetail | undefined = getRecipe(app.ctx.db, slug);
	if (!detail) return undefined;
	const { recipe, row, broken } = detail;
	const titles = Object.fromEntries(titlesOf(app.ctx.db, referencedSlugs(recipe, row.body_md)));
	const family = recipe.family ? familyDiff(app.ctx.db, recipe.family) : undefined;
	const file = currentFile(app.ctx, slug);
	return {
		recipe,
		body: row.body_md,
		titles,
		photo: photoUrl(app, recipe),
		broken,
		variants: (family?.variants ?? []).filter((v) => v.slug !== slug).map((v) => ({ slug: v.slug, title: v.title, variant: v.variant })),
		usedBy: usedBy(app.ctx.db, slug),
		/** The family's display label from vocab/families.yaml, if set. */
		familyName: family?.label ?? null,
		/** W303 / W305 / W307: ingredients not linked to the registry (plan 03, Phase 2). */
		unresolved: broken ? [] : unresolvedDiagnostics(app.ctx.db, app.ctx.paths.vocab, recipe),
		/** W501 / W502: a tag outside the vocabulary, a family near another (plan 03, Q23). */
		vocab: broken ? [] : recipeVocabDiagnostics(app.ctx, recipe),
		file: file ?? { text: '', hash: row.file_hash },
		/** Per line, by position across groups: where the name links (plan 03, Phase 5). */
		links: ingredientLinks(app, slug),
		cost: broken ? null : recipeCostView(app, slug),
		// The currency the index prices in; the locale only formats (a bare test app has no config).
		money: { currency: app.ctx.currency, locale: app.config?.locale ?? DEFAULT_LOCALE }
	};
}

export interface IngredientLink {
	/** The registry slug, when resolved. */
	item?: string;
	/** The lookup key, when unresolved or ambiguous: its row in the resolve queue. */
	key?: string;
}

/** How each line of a recipe resolved, from the index (`ingredients.item`). */
export function ingredientLinks(app: App, slug: string): Record<number, IngredientLink> {
	const rows = app.ctx.db.prepare('SELECT position, item, key, resolution FROM ingredients WHERE slug = ?').all(slug) as {
		position: number;
		item: string | null;
		key: string;
		resolution: string;
	}[];
	const out: Record<number, IngredientLink> = {};
	for (const r of rows) {
		if (r.item) out[r.position] = { item: r.item };
		else if (r.resolution === 'none' || r.resolution === 'ambiguous') out[r.position] = { key: r.key };
	}
	return out;
}

/** The cost line's data: totals at the base servings, and every line but the optional ones. */
export function recipeCostView(app: App, slug: string): CostView | null {
	const c = costOfRecipe(app.ctx.db, slug, loadConversions(app.ctx.paths.vocab));
	if (!c) return null;
	const subTitles = titlesOf(app.ctx.db, c.lines.flatMap((l) => l.via.slice(-1)));
	const links = ingredientLinks(app, slug);
	const lines: CostLineView[] = c.lines
		.filter((l) => l.reason !== 'optional')
		.map((l) => ({
			name: l.name,
			item: l.item,
			cost: l.cost,
			reason: l.reason,
			counted: l.counted,
			staple: l.staple,
			stale: l.stale,
			via: l.via.length ? (subTitles.get(l.via.at(-1)!) ?? l.via.at(-1)) : undefined,
			key: !l.via.length && l.reason === 'unresolved' ? links[l.position]?.key : undefined
		}));
	return { total: c.total, priced: c.priced, counted: c.counted, enough: c.enough, perServing: c.perServing, stale: c.stale, lines };
}

/** Sub-recipes of a recipe, recursively (a cycle cannot be saved, but guard anyway). */
export function loadSubRecipes(app: App, recipe: Recipe, depth = 3, seen = new Set<string>([recipe.slug])): SubRecipe[] {
	if (depth === 0) return [];
	const out: SubRecipe[] = [];
	for (const slug of referencedSlugs(recipe, '')) {
		if (seen.has(slug)) continue;
		seen.add(slug);
		const d = getRecipe(app.ctx.db, slug);
		if (!d) continue;
		out.push({ slug, recipe: d.recipe, body: d.row.body_md });
		out.push(...loadSubRecipes(app, d.recipe, depth - 1, seen));
	}
	return out;
}
