// The vault data the checker's context rules need (plan 03, Phase 8): the
// name-word lists (W302 / W304 / W607), the tag vocabulary (W501) and the
// existing families (W502). Read per check: a few small files and one query.

import type { CheckOptions } from '../vault/check';
import { vocabDiagnostics, type VaultVocabOptions } from '../vault/rules/vaultvocab';
import type { Diagnostic, Recipe } from '../vault/types';
import type { VaultContext } from './context';
import { loadCheckWords, loadVocab } from './vocab';

/**
 * Tags from vocab/tags.yaml; families from vocab/families.yaml and the index,
 * with the families only one recipe uses marked (`soleUser`), so the check of
 * that recipe — on its page, or re-pasted over it — leaves its own family out
 * (a recipe is not near its own family).
 */
export function vaultVocabOptions(ctx: Pick<VaultContext, 'db' | 'paths'>): VaultVocabOptions {
	const vocab = loadVocab(ctx.paths.vocab);
	const used = ctx.db.prepare('SELECT family, min(slug) AS slug, count(*) AS n FROM recipes WHERE family IS NOT NULL GROUP BY family').all() as { family: string; slug: string; n: number }[];
	const soleUser = new Map(used.filter((u) => u.n === 1 && !vocab.families.has(u.family)).map((u) => [u.family, u.slug]));
	return { tags: vocab.tags, families: [...new Set([...vocab.families.keys(), ...used.map((u) => u.family)])], soleUser };
}

/** Options for a server-side check (paste check, save, `vault check` on a vault). */
export function checkOptions(ctx: Pick<VaultContext, 'db' | 'paths'>): CheckOptions {
	return { words: loadCheckWords(ctx.paths.vocab), vocab: vaultVocabOptions(ctx) };
}

/**
 * W501 / W502 of an indexed recipe, for its page (plan 03, Q23): from the
 * vocabulary and the families the index knows now, so a vocabulary change or
 * a family renamed elsewhere re-derives them with no recipe file read.
 */
export function recipeVocabDiagnostics(ctx: Pick<VaultContext, 'db' | 'paths'>, recipe: Pick<Recipe, 'slug' | 'tags' | 'family'>): Diagnostic[] {
	return vocabDiagnostics({ tags: recipe.tags, family: recipe.family, slug: recipe.slug }, vaultVocabOptions(ctx));
}
