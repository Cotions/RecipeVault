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
 * without the ones only `exclude` uses (a recipe is not near its own family).
 */
export function vaultVocabOptions(ctx: Pick<VaultContext, 'db' | 'paths'>, exclude?: string): VaultVocabOptions {
	const vocab = loadVocab(ctx.paths.vocab);
	const used = ctx.db.prepare('SELECT DISTINCT family FROM recipes WHERE family IS NOT NULL AND slug IS NOT ?').pluck().all(exclude ?? null) as string[];
	return { tags: vocab.tags, families: [...new Set([...vocab.families.keys(), ...used])] };
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
	return vocabDiagnostics({ tags: recipe.tags, family: recipe.family }, vaultVocabOptions(ctx, recipe.slug));
}
