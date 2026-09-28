// Written name → registry slug (docs/INGREDIENTS.md, "Resolution"; plan 03
// Phase 2). First match wins:
//   1. `item:` in the entry: a manual override, taken as is;
//   2. a disambiguation rule (`when:` in an ingredient file) naming the key,
//      whose conditions on the line's language, unit and prep/note words hold,
//      when the rules that hold point at exactly one slug;
//   3. the exact lookup key, when it maps to exactly one slug;
//   4. the singular key (plural rules from vocab/normalize.yaml), when it maps
//      to exactly one slug;
//   5. otherwise unresolved, with the top fuzzy (trigram) candidates for the
//      resolve queue. A candidate is never taken automatically (plan 03, Q1).
// A key written under two entries is ambiguous and never auto-resolved: a
// wrong resolution poisons every total that includes it. Browser-safe.

import { fold } from '../vault/normalize';
import type { Diagnostic, Ingredient, Lang, Recipe } from '../vault/types';
import { lookupKey, singularKey, type PluralRules } from './normalize';
import { ruleUnits, ruleWords } from './registry';
import { NAME_LANGS, type RegistryEntry } from './types';

export type Resolution = 'override' | 'rule' | 'alias' | 'plural' | 'none' | 'ambiguous' | 'recipe';

/** What a disambiguation rule may look at on a recipe line, besides the name. */
export interface LineContext {
	unit?: string;
	prep?: string;
	note?: string;
}

/** One name of one `when` rule, as the resolver uses it. */
export interface RuleRow {
	key: string;
	slug: string;
	lang?: string;
	/** Canonical units (classes expanded); absent: any unit, or none. */
	units?: string[];
	/** Folded words; absent: no word condition. */
	words?: string[];
}

/** The rule rows of registry entries: one per rule name. */
export function ruleRows(entries: Pick<RegistryEntry, 'slug' | 'when'>[]): RuleRow[] {
	const out: RuleRow[] = [];
	for (const e of entries)
		for (const r of e.when ?? []) {
			const units = ruleUnits(r);
			const words = ruleWords(r);
			for (const key of new Set(r.names.map(lookupKey)))
				out.push({ key, slug: e.slug, ...(r.lang ? { lang: r.lang } : {}), ...(units ? { units: [...units] } : {}), ...(words ? { words } : {}) });
		}
	return out;
}

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

/**
 * Tuned on tests/fixtures/corpus (metric R2, tests/ingredients-corpus.test.ts):
 * see docs/INGREDIENTS.md, "Resolution". 0.15 is the knee: lower adds noise
 * candidates for almost no more hits.
 */
export const FUZZY = { minScore: 0.15, count: 3 };

export interface NameRow {
	key: string;
	/** The key with the alias's language plural rules applied. */
	skey: string;
	slug: string;
}

/** The alias rows of registry entries, as the index stores them in `ingredient_names`. */
export function nameRows(entries: Pick<RegistryEntry, 'slug' | 'names'>[], plurals: PluralRules = {}): NameRow[] {
	const out: NameRow[] = [];
	for (const e of entries)
		for (const lang of NAME_LANGS)
			for (const n of e.names[lang] ?? []) {
				const key = lookupKey(n);
				out.push({ key, skey: singularKey(key, plurals[lang]), slug: e.slug });
			}
	return out;
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
	private rulesByKey = new Map<string, RuleRow[]>();
	/** Per recipe language: rules by the singular key of their name. Built on first use. */
	private rulesBySkey = new Map<string, Map<string, RuleRow[]>>();
	readonly slugs = new Set<string>();

	constructor(
		rows: NameRow[],
		readonly plurals: PluralRules = {},
		extraSlugs: Iterable<string> = [],
		readonly rules: RuleRow[] = []
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
		for (const r of rules) {
			this.slugs.add(r.slug);
			(this.rulesByKey.get(r.key) ?? this.rulesByKey.set(r.key, []).get(r.key)!).push(r);
		}
	}

	/** Whether any rule names this key (exactly or by its singular): its resolution then depends on the line. */
	hasRules(key: string, lang: Lang | string = 'fr'): boolean {
		return this.rulesByKey.has(key) || this.skeyRules(lang).has(this.singular(key, lang));
	}

	private skeyRules(lang: string): Map<string, RuleRow[]> {
		let m = this.rulesBySkey.get(lang);
		if (!m) {
			m = new Map();
			for (const r of this.rules) {
				const k = this.singular(r.key, lang);
				(m.get(k) ?? m.set(k, []).get(k)!).push(r);
			}
			this.rulesBySkey.set(lang, m);
		}
		return m;
	}

	/** The rules naming a key: exact first, else by singular key. */
	private rulesFor(key: string, lang: string): RuleRow[] {
		return this.rulesByKey.get(key) ?? this.skeyRules(lang).get(this.singular(key, lang)) ?? [];
	}

	/** Whether a rule's conditions hold for a line. */
	private holds(r: RuleRow, lang: string, ctx: LineContext): boolean {
		if (r.lang && r.lang !== lang) return false;
		if (r.units && !(ctx.unit && r.units.includes(ctx.unit))) return false;
		if (r.words) {
			// Whole words, singularized like names: `hachés` meets `haché`.
			const norm = (t: string) => ` ${this.singular(fold(t).replace(/[^\p{L}\p{N}%]+/gu, ' ').trim(), lang)} `;
			const text = norm(`${ctx.prep ?? ''} ${ctx.note ?? ''}`);
			if (!r.words.some((w) => text.includes(norm(w)))) return false;
		}
		return true;
	}

	has(slug: string): boolean {
		return this.slugs.has(slug);
	}

	/** The singular key of a lookup key, under a recipe language's rules. */
	singular(key: string, lang: Lang | string = 'fr'): string {
		return singularKey(key, this.plurals[lang]);
	}

	/**
	 * Steps 2–5 for a lookup key on a line. Rules are more specific than
	 * aliases, so they are tried first: when the rules that hold point at one
	 * entry, that is the answer; at two or more, the line stays ambiguous. When
	 * none holds, the aliases decide as usual; a key that only rules name, and
	 * that no alias settles, is ambiguous when its rules span two entries.
	 */
	resolveKey(key: string, lang: Lang | string = 'fr', ctx: LineContext = {}): Resolved {
		const rules = this.rulesFor(key, lang);
		if (rules.length) {
			const held = new Set(rules.filter((r) => this.holds(r, lang, ctx)).map((r) => r.slug));
			if (held.size === 1) return { key, item: [...held][0], resolution: 'rule' };
			if (held.size > 1) return { key, item: null, resolution: 'ambiguous' };
		}
		const exact = this.byKey.get(key);
		if (exact?.size === 1) return { key, item: [...exact][0], resolution: 'alias' };
		if (exact && exact.size > 1) return { key, item: null, resolution: 'ambiguous' };
		const plural = this.bySkey.get(this.singular(key, lang));
		if (plural?.size === 1) return { key, item: [...plural][0], resolution: 'plural' };
		if (new Set(rules.map((r) => r.slug)).size > 1) return { key, item: null, resolution: 'ambiguous' };
		return { key, item: null, resolution: 'none' };
	}

	/** One ingredient entry (or one `or` option): the override, a sub-recipe, or the name on its line. */
	resolve(it: Pick<Ingredient, 'name' | 'item' | 'recipe' | 'unit' | 'prep' | 'note'>, lang: Lang | string = 'fr'): Resolved {
		const key = lookupKey(it.name);
		if (it.item) return { key, item: it.item, resolution: 'override' };
		if (it.recipe) return { key, item: null, resolution: 'recipe' };
		return this.resolveKey(key, lang, it);
	}

	/**
	 * The resolve queue's suggestions for an unresolved key. An ambiguous key's
	 * candidates are the entries that share it; otherwise the entries whose
	 * aliases are nearest by trigram similarity (on singular keys), best first,
	 * at most `count`, none below `minScore`.
	 */
	candidates(key: string, lang: Lang | string = 'fr', { minScore = FUZZY.minScore, count = FUZZY.count } = {}): Candidate[] {
		const exact = new Set(this.byKey.get(key));
		for (const r of this.rulesFor(key, lang)) exact.add(r.slug);
		if (exact.size > 1) return [...exact].sort().map((slug) => ({ slug, score: 1 }));
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
		// A key only one entry's rules name: that entry first.
		for (const slug of exact) best.set(slug, 1);
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
