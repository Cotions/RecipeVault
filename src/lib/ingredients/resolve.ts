// Written name → registry slug (docs/INGREDIENTS.md, "Resolution"; plan 03
// Phase 2). First match wins:
//   1. `item:` in the entry: a manual override, taken as is;
//   2. the exact lookup key, when it maps to exactly one slug;
//   3. the singular key (plural rules from vocab/normalize.yaml), when it maps
//      to exactly one slug;
//   4. otherwise unresolved, with the top fuzzy (trigram) candidates for the
//      resolve queue. A candidate is never taken automatically (plan 03, Q1).
// A key written under two entries is ambiguous and never auto-resolved: a
// wrong resolution poisons every total that includes it. Browser-safe.

import type { Diagnostic, Ingredient, Lang, Recipe } from '../vault/types';
import { lookupKey, singularKey, type PluralRules } from './normalize';

export type Resolution = 'override' | 'alias' | 'plural' | 'none' | 'ambiguous' | 'recipe';

export interface Resolved {
	key: string;
	/** The registry slug, or null when unresolved (and for a sub-recipe line). */
	item: string | null;
	resolution: Resolution;
}

export interface Candidate {
	slug: string;
	/** Trigram similarity, 0–1. */
	score: number;
}

/** Tuned on tests/fixtures/corpus (R1, R2): see docs/INGREDIENTS.md, "Resolution". */
export const FUZZY = { minScore: 0.3, count: 3 };

export interface NameRow {
	key: string;
	/** The key with the alias's language plural rules applied. */
	skey: string;
	slug: string;
}

/** Padded word trigrams, as pg_trgm computes them: `  w`, ` wo`, `wor`, `ord`, `rd `. */
export function trigrams(s: string): Set<string> {
	const out = new Set<string>();
	for (const w of s.split(/[\s'-]+/)) {
		if (!w) continue;
		const p = `  ${w} `;
		for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
	}
	return out;
}

export class Resolver {
	private byKey = new Map<string, Set<string>>();
	private bySkey = new Map<string, Set<string>>();
	private fuzzyKeys: { skey: string; slug: string; grams: number }[] = [];
	private gramIndex = new Map<string, number[]>();
	readonly slugs = new Set<string>();

	constructor(
		rows: NameRow[],
		readonly plurals: PluralRules = {},
		extraSlugs: Iterable<string> = []
	) {
		const add = (m: Map<string, Set<string>>, k: string, slug: string) => {
			if (!m.has(k)) m.set(k, new Set());
			m.get(k)!.add(slug);
		};
		const seen = new Set<string>();
		for (const r of rows) {
			this.slugs.add(r.slug);
			add(this.byKey, r.key, r.slug);
			add(this.bySkey, r.skey, r.slug);
			const id = `${r.slug}\0${r.skey}`;
			if (seen.has(id)) continue;
			seen.add(id);
			const grams = trigrams(r.skey);
			const i = this.fuzzyKeys.push({ skey: r.skey, slug: r.slug, grams: grams.size }) - 1;
			for (const g of grams) {
				if (!this.gramIndex.has(g)) this.gramIndex.set(g, []);
				this.gramIndex.get(g)!.push(i);
			}
		}
		for (const s of extraSlugs) this.slugs.add(s);
	}

	has(slug: string): boolean {
		return this.slugs.has(slug);
	}

	/** The singular key of a lookup key, under a recipe language's rules. */
	singular(key: string, lang: Lang | string = 'fr'): string {
		return singularKey(key, this.plurals[lang]);
	}

	/** Steps 2–4 for a lookup key. */
	resolveKey(key: string, lang: Lang | string = 'fr'): Resolved {
		const exact = this.byKey.get(key);
		if (exact?.size === 1) return { key, item: [...exact][0], resolution: 'alias' };
		if (exact && exact.size > 1) return { key, item: null, resolution: 'ambiguous' };
		const plural = this.bySkey.get(this.singular(key, lang));
		if (plural?.size === 1) return { key, item: [...plural][0], resolution: 'plural' };
		return { key, item: null, resolution: 'none' };
	}

	/** One ingredient entry (or one `or` option): the override, a sub-recipe, or the name. */
	resolve(it: Pick<Ingredient, 'name' | 'item' | 'recipe'>, lang: Lang | string = 'fr'): Resolved {
		const key = lookupKey(it.name);
		if (it.item) return { key, item: it.item, resolution: 'override' };
		if (it.recipe) return { key, item: null, resolution: 'recipe' };
		return this.resolveKey(key, lang);
	}

	/**
	 * The resolve queue's suggestions for an unresolved key. An ambiguous key's
	 * candidates are the entries that share it; otherwise the entries whose
	 * aliases are nearest by trigram similarity (on singular keys), best first,
	 * at most `count`, none below `minScore`.
	 */
	candidates(key: string, lang: Lang | string = 'fr', { minScore = FUZZY.minScore, count = FUZZY.count } = {}): Candidate[] {
		const exact = this.byKey.get(key);
		if (exact && exact.size > 1) return [...exact].sort().map((slug) => ({ slug, score: 1 }));
		const sk = this.singular(key, lang);
		const grams = trigrams(sk);
		if (!grams.size) return [];
		const shared = new Map<number, number>();
		for (const g of grams) for (const i of this.gramIndex.get(g) ?? []) shared.set(i, (shared.get(i) ?? 0) + 1);
		const best = new Map<string, number>();
		for (const [i, n] of shared) {
			const f = this.fuzzyKeys[i];
			const score = n / (grams.size + f.grams - n);
			if (score >= minScore && score > (best.get(f.slug) ?? 0)) best.set(f.slug, score);
		}
		return [...best]
			.map(([slug, score]) => ({ slug, score }))
			.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
			.slice(0, count);
	}
}

/**
 * W303 / W305 / W307 for one recipe (plan 03, Q1): an unresolved name with a
 * candidate waiting in the resolve queue (W305), with none (W303), and an
 * `item:` override naming no registry entry (W307). `app` codes: never in the
 * fix-request block.
 */
export function resolutionDiagnostics(recipe: Pick<Recipe, 'ingredients' | 'lang'>, resolver: Resolver): Diagnostic[] {
	const out: Diagnostic[] = [];
	const visit = (it: Ingredient, path: string) => {
		const r = resolver.resolve(it, recipe.lang);
		if (r.resolution === 'override' && !resolver.has(r.item!))
			out.push({
				code: 'W307',
				severity: 'warning',
				path: `${path}.item`,
				message: `\`item: ${r.item}\` names no ingredient in the registry (no ingredients/${r.item}.md).`,
				fix: 'Create that ingredient, or correct the slug.'
			});
		else if (r.resolution === 'none' || r.resolution === 'ambiguous') {
			const c = resolver.candidates(r.key, recipe.lang);
			out.push(
				c.length
					? {
							code: 'W305',
							severity: 'warning',
							path: `${path}.name`,
							message:
								r.resolution === 'ambiguous'
									? `"${it.name}" is a name of several ingredients (${c.map((x) => x.slug).join(', ')}); it stays unresolved until one is chosen in the resolve queue.`
									: `"${it.name}" matches no ingredient name; the resolve queue suggests ${c.map((x) => x.slug).join(', ')}.`,
							fix: 'Confirm it in the resolve queue (/resoudre).'
						}
					: {
							code: 'W303',
							severity: 'warning',
							path: `${path}.name`,
							message: `"${it.name}" matches no ingredient in the registry, and nothing close.`,
							fix: 'Create the ingredient from the resolve queue (/resoudre).'
						}
			);
		}
		it.or?.forEach((o, j) => visit(o, `${path}.or[${j}]`));
	};
	recipe.ingredients.forEach((g, gi) => g.items.forEach((it, ii) => visit(it, `ingredients[${gi}].items[${ii}]`)));
	return out;
}
