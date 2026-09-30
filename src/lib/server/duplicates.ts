// Possible duplicates (plan 05, Phases 6–7; docs/INGREDIENTS.md, "Duplicates"):
// W505 on the paste box, the form and the save result, and the pairs a person
// settled as different recipes, `vocab/distinct.yaml` (Q14 A; docs/VOCAB.md,
// "Distinct recipes"): one line per pair, `- [a, b]`, the two slugs sorted,
// the lines sorted. A pair naming a slug no longer in the vault is ignored.

import { parse } from 'yaml';
import type { Diagnostic, Recipe } from '../vault/types';
import type { VaultContext } from './context';
import { readVaultFile } from './files';
import { pairKey, pairsFor } from './index/similar';
import { VOCAB } from './vault';
import { loadVocab } from './vocab';

export const DISTINCT_FILE = `${VOCAB}/distinct.yaml`;

/** The pairs of vocab/distinct.yaml, as they read: well-formed lines only. */
export function parseDistinct(text: string): [string, string][] {
	let data: unknown;
	try {
		data = parse(text, { version: '1.2' });
	} catch {
		return [];
	}
	if (!Array.isArray(data)) return [];
	const out: [string, string][] = [];
	for (const e of data)
		if (Array.isArray(e) && e.length === 2 && typeof e[0] === 'string' && typeof e[1] === 'string' && e[0] !== e[1])
			out.push(e[0] < e[1] ? [e[0], e[1]] : [e[1], e[0]]);
	return out;
}

/** The settled pairs, as `pairKey`s. */
export function dismissedPairs(ctx: VaultContext): Set<string> {
	return new Set(parseDistinct(readVaultFile(ctx, DISTINCT_FILE).text).map(([a, b]) => pairKey(a, b)));
}

export interface CloseRecipe {
	slug: string;
	title: string;
	family: string | null;
	/** The file's hash, for "En faire deux versions" (the W608 pair offer). */
	hash: string;
	/** Weighted Jaccard, 0–1. */
	score: number;
}

/** At most this many other recipes named by one W505. */
const MAX_CLOSE = 3;

/**
 * The vault recipes whose ingredients are close to `recipe` (not saved yet),
 * pairs already settled left out. `own`: the slug it will be saved under (an
 * edit, a paste over itself): never paired with itself.
 */
export function closeRecipes(ctx: VaultContext, recipe: Pick<Recipe, 'ingredients' | 'lang' | 'family'>, own?: string): CloseRecipe[] {
	const found = pairsFor(ctx.db, () => loadVocab(ctx.paths.vocab), recipe, { own, dismissed: dismissedPairs(ctx) }).slice(0, MAX_CLOSE);
	if (!found.length) return [];
	const hash = ctx.db.prepare('SELECT file_hash FROM recipes WHERE slug = ?').pluck();
	return found.map((f) => ({ ...f, hash: (hash.get(f.slug) as string | undefined) ?? '' }));
}

const pct = (x: number) => `${Math.round(100 * x)} %`;

/** W505 (`app`): computed with the vault in the server check, the form's check and the save result; never the fix-request block. */
export function duplicateWarnings(close: CloseRecipe[]): Diagnostic[] {
	if (!close.length) return [];
	return [
		{
			code: 'W505',
			severity: 'warning',
			path: 'ingredients',
			message: `nearly the same ingredients as ${close.map((c) => `${c.slug} (${pct(c.score)} in common, weighted)`).join(', ')} — possible duplicate.`,
			fix: 'The same card: do not save it twice. Versions of one dish: make both members of a family. Different recipes: settle the pair on /doublons.'
		}
	];
}
