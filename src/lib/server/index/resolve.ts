// Ingredient resolution in the index (plan 03, Phase 2). Resolution happens
// at index time and is never written back to a recipe (docs/STORAGE.md,
// "Ingredient resolution is not stored in recipe files"). A registry change
// re-resolves every row from its stored lookup key, with no recipe file read —
// the same pattern as `retag`.

import { Resolver, resolutionDiagnostics, type NameRow } from '../../ingredients/resolve';
import type { Diagnostic, Recipe } from '../../vault/types';
import { loadVocab, type VaultVocab } from '../vocab';
import { getMeta } from './build';
import type { DB } from './db';

const cache = new WeakMap<DB, { hash: string; resolver: Resolver }>();

/**
 * The resolver for the registry as indexed. Rebuilt when `meta.registry_hash`
 * changed (it covers every ingredient file and vocab/normalize.yaml).
 */
export function getResolver(db: DB, vocab: Pick<VaultVocab, 'normalize'> | (() => Pick<VaultVocab, 'normalize'>)): Resolver {
	const hash = getMeta(db, 'registry_hash') ?? '';
	const hit = cache.get(db);
	if (hit && hit.hash === hash) return hit.resolver;
	if (typeof vocab === 'function') vocab = vocab();
	const rows = db.prepare('SELECT key, skey, slug FROM ingredient_names').all() as NameRow[];
	const slugs = db.prepare('SELECT slug FROM registry').pluck().all() as string[];
	const resolver = new Resolver(rows, vocab.normalize.plurals, slugs);
	cache.set(db, { hash, resolver });
	return resolver;
}

/** Drop the cached resolver (a test swapped the registry under the same hash). */
export function forgetResolver(db: DB): void {
	cache.delete(db);
}

/**
 * Recompute `item` and `resolution` of every ingredient row and `or` option
 * from its lookup key. Overrides and sub-recipe lines are left alone. Call
 * inside a transaction. Returns the number of distinct keys resolved.
 */
export function reresolve(db: DB, resolver: Resolver): number {
	db.exec('CREATE TEMP TABLE IF NOT EXISTS _res (key TEXT NOT NULL, lang TEXT NOT NULL, item TEXT, resolution TEXT NOT NULL, PRIMARY KEY (key, lang))');
	db.exec('DELETE FROM _res');
	const ins = db.prepare('INSERT OR IGNORE INTO _res (key, lang, item, resolution) VALUES (?, ?, ?, ?)');
	let n = 0;
	for (const table of ['ingredients', 'ingredient_or']) {
		const keys = db
			.prepare(`SELECT DISTINCT i.key, r.lang FROM ${table} i JOIN recipes r ON r.slug = i.slug WHERE i.resolution NOT IN ('override', 'recipe')`)
			.all() as { key: string; lang: string }[];
		for (const { key, lang } of keys) {
			const r = resolver.resolveKey(key, lang);
			n += ins.run(key, lang, r.item, r.resolution).changes;
		}
	}
	for (const table of ['ingredients', 'ingredient_or'])
		db.exec(
			`UPDATE ${table} AS i SET item = x.item, resolution = x.resolution
			 FROM _res x JOIN recipes r ON r.lang = x.lang
			 WHERE r.slug = i.slug AND x.key = i.key AND i.resolution NOT IN ('override', 'recipe')
			   AND (i.item IS NOT x.item OR i.resolution IS NOT x.resolution)`
		);
	db.exec('DELETE FROM _res');
	return n;
}

/**
 * W303 / W305 / W307 for a recipe against the registry as indexed: added to
 * the checker's diagnostics by the paste check, the save result and the
 * recipe page. They never change a recipe's status (plan 03, Q3).
 */
export function unresolvedDiagnostics(db: DB, vocabDir: string, recipe: Pick<Recipe, 'ingredients' | 'lang'>): Diagnostic[] {
	return resolutionDiagnostics(recipe, getResolver(db, () => loadVocab(vocabDir)));
}
