// Data for the recipe page and kitchen mode.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Ingredient, Recipe } from '../vault/types';
import type { App } from './app';
import { familyDiff, getRecipe, titles as titlesOf, usedBy, type RecipeDetail } from './index/query';
import { currentFile } from './save';

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
		file: file ?? { text: '', hash: row.file_hash }
	};
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
