// Today's display of every invented recipe at its own amount (plan 05, Phase 0):
// each ingredient line's parts, the yield, the unit words and a digest of the
// method's HTML, for the corpus (tests/fixtures/corpus) and the fixture vault
// (tests/fixtures/vault). Written once to tests/fixtures/scaling-baseline.txt by
// scripts/gen-scaling-baseline.ts, before scaling changed anything; the scaling
// tests compare the current display at factor 1 against it, character for
// character. Regenerate only for a display change that is meant.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkFile } from '../../src/lib/vault/check';
import { bodyText } from '../../src/lib/vault/parse';
import { ingredientParts, formatAmount, unitLabel, type AmountOptions } from '../../src/lib/render/ingredient';
import { scaleTextYield, servingsRange } from '../../src/lib/render/scale';
import { renderMarkdown } from '../../src/lib/render/markdown';
import { UNITS, type Ingredient, type Recipe } from '../../src/lib/vault/types';

export const BASELINE = 'tests/fixtures/scaling-baseline.txt';
export const DISPLAY_DIRS = ['tests/fixtures/corpus/recipes', 'tests/fixtures/vault/recipes'];

export interface Loaded {
	file: string;
	recipe: Recipe;
	body: string;
}

/** Every recipe of the corpus and the fixture vault, parsed as the index would. */
export function loadDisplayRecipes(dirs = DISPLAY_DIRS): Loaded[] {
	const out: Loaded[] = [];
	for (const dir of dirs) {
		for (const f of readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
			const text = readFileSync(join(dir, f), 'utf8');
			const { recipe } = checkFile(text);
			if (recipe) out.push({ file: `${dir.split('/').at(-2)}/${f}`, recipe, body: bodyText(text) });
		}
	}
	return out;
}

const KIND: Record<string, string> = { amount: 'A', text: 'T', name: 'N', muted: 'M', approx: '≈' };

/** One line's parts, compact: kind letter and text, `¦`-separated. */
export function partsLine(it: Ingredient, opts: AmountOptions): string {
	return ingredientParts(it, opts)
		.map((p) => `${KIND[p.kind] ?? p.kind}:${p.text}${'recipe' in p && p.recipe ? `→${p.recipe}` : ''}`)
		.join('¦');
}

/** The display lines of one recipe at `opts` (factor 1 for the baseline). */
export function displayLines(l: Loaded, opts: Omit<AmountOptions, 'lang'> = {}): string[] {
	const { recipe } = l;
	const lang = recipe.lang;
	const out: string[] = [];
	recipe.ingredients.forEach((g, gi) =>
		g.items.forEach((it, ii) => out.push(`${l.file}\tingredients[${gi}].items[${ii}]\t${partsLine(it, { ...opts, lang })}`))
	);
	if (recipe.servings) out.push(`${l.file}\tservings\t${servingsText(recipe, opts)}`);
	const y = recipe.yield;
	if (y && typeof y === 'object') out.push(`${l.file}\tyield\t${[formatAmount(y, { ...opts, lang }), y.note].filter(Boolean).join(' ')}`);
	else if (y) out.push(`${l.file}\tyield\t${yieldTextOf(recipe, opts)}`);
	const html = renderMarkdown(l.body);
	out.push(`${l.file}\tbody\t${createHash('sha256').update(html).digest('hex').slice(0, 16)}`);
	return out;
}

/** The servings as the recipe page shows them (RecipeView: « lo à hi »). */
function servingsText(recipe: Recipe, opts: Omit<AmountOptions, 'lang'>): string {
	const r = servingsRange(recipe, opts.factor ?? 1, recipe.lang);
	return r.hi ? `${r.lo} à ${r.hi}` : r.lo;
}

/** A text yield as the recipe page shows it. */
function yieldTextOf(recipe: Recipe, opts: Omit<AmountOptions, 'lang'>): string {
	const y = scaleTextYield(String(recipe.yield), opts.factor ?? 1, opts.rules, recipe.lang);
	return `${y.approx ? '≈ ' : ''}${y.text}${y.scaled ? '' : ` ×${opts.factor}`}`;
}

/** Every unit word, both languages, singular and plural. */
export function unitWordLines(): string[] {
	const out: string[] = [];
	for (const lang of ['fr', 'en'] as const) for (const u of UNITS) for (const n of [1, 2]) out.push(`units\t${lang}.${u}.${n}\t${unitLabel(u, n, lang)}`);
	return out;
}

export function baselineText(recipes = loadDisplayRecipes()): string {
	return [...unitWordLines(), ...recipes.flatMap((l) => displayLines(l))].join('\n') + '\n';
}
