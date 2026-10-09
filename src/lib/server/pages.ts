// Data for the recipe page and kitchen mode.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Ingredient, Recipe } from '../vault/types';
import type { App } from './app';
import { familyDiff, getRecipe, titles as titlesOf, usedBy, type RecipeDetail } from './index/query';
import { currentFile } from './save';
import { MEDIA_FILE_RE } from './photos';
import { photoSrc } from '../render/media';
import { unresolvedDiagnostics } from './index/resolve';
import { recipeVocabDiagnostics } from './checkopts';
import { DEFAULT_LOCALE } from './config';
import { costOfRecipe } from './cost';
import { loadConversions, loadScaling } from './vocab';
import { tagNamer } from './tags';
import type { CostLineView, CostView } from '../ingredients/cost';
import type { Conversions } from '../ingredients/units';
import { SUB_RECIPE_DEPTH, type SubScaleRecipe } from '../render/scale';

const WIKI_RE = /\[\[([^[\]|\n]+?)(?:\|[^[\]\n]+)?\]\]/g;

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

/** A recipe's photo as the pages show it: `src` null means a HEIC original, shown as a placeholder. */
export interface PhotoView {
	src: string | null;
	thumb: string | null;
}

/** The recipe's `media.final`, if its original is on disk (plan 04, Phase 6: only derived copies are linked). */
export function photoView(app: App, recipe: Recipe): PhotoView | null {
	const file = recipe.media?.final;
	if (!file || !MEDIA_FILE_RE.test(file)) return null;
	if (!existsSync(join(app.ctx.paths.media, recipe.slug, file))) return null;
	return { src: photoSrc(recipe.slug, file, 'display'), thumb: photoSrc(recipe.slug, file, 'thumb') };
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
		photo: photoView(app, recipe),
		broken,
		variants: (family?.variants ?? []).filter((v) => v.slug !== slug).map((v) => ({ slug: v.slug, title: v.title, variant: v.variant })),
		usedBy: usedBy(app.ctx.db, slug),
		/** Per tag of `recipe.tags`: its filter key and label (vocab/tag-labels.yaml, via aliases). */
		tags: recipe.tags.map(tagNamer(app.ctx)),
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
		/** vocab/scaling.yaml (plan 05): how scaled amounts show; null shows them as before. */
		scaling: loadScaling(app.ctx.paths.vocab),
		/** Plan 05, Q5 A: what the sub-recipe links need to carry the amount a line uses. */
		subScale: subScale(app, recipe),
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

/**
 * Sub-recipes of a recipe and theirs, level by level down to `depth` (kitchen
 * mode opens them inside one another, `SUB_RECIPE_DEPTH`). Each recipe once,
 * at the shallowest level it is used, so its own sub-recipes load too; the
 * recipe itself never (a cycle cannot be saved, but guard anyway).
 */
export function loadSubRecipes(app: App, recipe: Recipe, depth = SUB_RECIPE_DEPTH): SubRecipe[] {
	const seen = new Set<string>([recipe.slug]);
	const out: SubRecipe[] = [];
	let level: Recipe[] = [recipe];
	for (let d = 0; d < depth && level.length; d++) {
		const next: Recipe[] = [];
		for (const r of level) {
			for (const slug of referencedSlugs(r, '')) {
				if (seen.has(slug)) continue;
				seen.add(slug);
				const got = getRecipe(app.ctx.db, slug);
				if (!got) continue;
				out.push({ slug, recipe: got.recipe, body: got.row.body_md });
				next.push(got.recipe);
			}
		}
		level = next;
	}
	return out;
}

/**
 * The sub-recipes a recipe's lines use (with `or` entries), reduced to what
 * scales them (their yield and servings), and the conversions the cost rule
 * reads: the recipe page's sub-recipe links carry the amount a line needs
 * (plan 05, Q5 A).
 */
export function subScale(app: App, recipe: Recipe): { conversions: Conversions; recipes: Record<string, SubScaleRecipe> } {
	const recipes: Record<string, SubScaleRecipe> = {};
	for (const slug of referencedSlugs(recipe, '')) {
		const d = getRecipe(app.ctx.db, slug);
		if (d) recipes[slug] = { slug, yield: d.recipe.yield, servings: d.recipe.servings, servingsMax: d.recipe.servingsMax };
	}
	return { conversions: loadConversions(app.ctx.paths.vocab), recipes };
}
