// Ingredient resolution in the index (plan 03, Phase 2). Resolution happens
// at index time and is never written back to a recipe (docs/STORAGE.md,
// "Ingredient resolution is not stored in recipe files"). A registry change
// re-resolves every row from its stored lookup key, with no recipe file read —
// the same pattern as `retag`.

import { Resolver, resolutionDiagnostics, ruleRows, type NameRow } from '../../ingredients/resolve';
import { toTasteDiagnostics } from '../../ingredients/totaste';
import type { RegistryEntry } from '../../ingredients/types';
import type { Diagnostic, Ingredient, Recipe } from '../../vault/types';
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
	const entries = (db.prepare("SELECT entry_json FROM registry WHERE entry_json LIKE '%\"when\"%'").pluck().all() as string[]).map(
		(j) => JSON.parse(j) as Pick<RegistryEntry, 'slug' | 'when'>
	);
	const resolver = new Resolver(rows, vocab.normalize.plurals, slugs, ruleRows(entries));
	cache.set(db, { hash, resolver });
	return resolver;
}

/** Drop the cached resolver (a test swapped the registry under the same hash). */
export function forgetResolver(db: DB): void {
	cache.delete(db);
}

/**
 * Recompute `item` and `resolution` of every ingredient row and `or` option.
 * Overrides and sub-recipe lines are left alone. Rows whose key no
 * disambiguation rule names depend on (key, language) only and are updated
 * set-wise from their stored key; the few whose key a rule names also depend
 * on the line's unit, prep and note, read from the recipe's stored parse
 * (`data_json`, no recipe file read). Call inside a transaction. Returns the
 * number of distinct keys resolved.
 */
export function reresolve(db: DB, resolver: Resolver): number {
	db.exec('CREATE TEMP TABLE IF NOT EXISTS _res (key TEXT NOT NULL, lang TEXT NOT NULL, item TEXT, resolution TEXT NOT NULL, PRIMARY KEY (key, lang))');
	db.exec('DELETE FROM _res');
	const ins = db.prepare('INSERT OR IGNORE INTO _res (key, lang, item, resolution) VALUES (?, ?, ?, ?)');
	let n = 0;
	const ruled: { table: string; key: string; lang: string }[] = [];
	for (const table of ['ingredients', 'ingredient_or']) {
		const keys = db
			.prepare(`SELECT DISTINCT i.key, r.lang FROM ${table} i JOIN recipes r ON r.slug = i.slug WHERE i.resolution NOT IN ('override', 'recipe')`)
			.all() as { key: string; lang: string }[];
		for (const { key, lang } of keys) {
			if (resolver.hasRules(key, lang)) {
				ruled.push({ table, key, lang });
				continue;
			}
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
	n += new Set(ruled.map((x) => `${x.key}\0${x.lang}`)).size;
	reresolveLines(db, resolver, ruled);
	return n;
}

/** Row by row, for keys a rule names: the line's own unit, prep and note decide. */
function reresolveLines(db: DB, resolver: Resolver, ruled: { table: string; key: string; lang: string }[]): void {
	if (!ruled.length) return;
	const lines = new Map<string, Ingredient[]>();
	/** The recipe's items in index order (`position` runs across groups). */
	const itemsOf = (slug: string) => {
		let xs = lines.get(slug);
		if (!xs) {
			const json = db.prepare('SELECT data_json FROM recipes WHERE slug = ?').pluck().get(slug) as string | undefined;
			xs = json ? (JSON.parse(json) as Recipe).ingredients.flatMap((g) => g.items) : [];
			lines.set(slug, xs);
		}
		return xs;
	};
	for (const { table, key, lang } of ruled) {
		const alt = table === 'ingredient_or';
		const rows = db
			.prepare(
				`SELECT i.slug, i.position${alt ? ', i.alt_idx' : ''} FROM ${table} i JOIN recipes r ON r.slug = i.slug
				 WHERE i.key = ? AND r.lang = ? AND i.resolution NOT IN ('override', 'recipe')`
			)
			.all(key, lang) as { slug: string; position: number; alt_idx?: number }[];
		const upd = db.prepare(`UPDATE ${table} SET item = ?, resolution = ? WHERE slug = ? AND position = ?${alt ? ' AND alt_idx = ?' : ''}`);
		for (const row of rows) {
			const it = itemsOf(row.slug)[row.position];
			const line = alt ? it?.or?.[row.alt_idx!] : it;
			const r = resolver.resolveKey(key, lang, line ?? {});
			upd.run(r.item, r.resolution, row.slug, row.position, ...(alt ? [row.alt_idx] : []));
		}
	}
}

/**
 * W303 / W305 / W307 for a recipe against the registry as indexed: added to
 * the checker's diagnostics by the paste check, the save result and the
 * recipe page. They never change a recipe's status (plan 03, Q3).
 */
export function unresolvedDiagnostics(db: DB, vocabDir: string, recipe: Pick<Recipe, 'ingredients' | 'lang'>): Diagnostic[] {
	return resolutionDiagnostics(recipe, getResolver(db, () => loadVocab(vocabDir)));
}

/**
 * W606 for a recipe against the registry as indexed (`registry.au_gout`,
 * plan 03 Q21): added to the checker's diagnostics by the paste check and the
 * save result, so an `ai` code reaches the fix-request block through
 * /api/check.
 */
export function toTasteWarnings(db: DB, vocabDir: string, recipe: Pick<Recipe, 'ingredients' | 'lang'>): Diagnostic[] {
	const auGout = new Set(db.prepare('SELECT slug FROM registry WHERE au_gout = 1').pluck().all() as string[]);
	return toTasteDiagnostics(recipe, getResolver(db, () => loadVocab(vocabDir)), auGout);
}
