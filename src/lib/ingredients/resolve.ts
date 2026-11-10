// Written name → registry slug (docs/INGREDIENTS.md, "Resolution"; plan 03
// Phase 2). First match wins:
//   1. `item:` in the entry: a manual override, taken as is;
//   2. a disambiguation rule (`when:` in an ingredient file) naming the key
//      (exactly; by its singular key only when the exact key is no alias),
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
	/**
	 * A strong match (`STRONG`): the name is one of the entry's aliases with a
	 * clear typo. Only a strong first candidate is offered as the answer
	 * (/resoudre's primary « 1 C'est ça », Enter); the others are guesses.
	 */
	strong?: true;
}

/**
 * Tuned on tests/fixtures/corpus (metric R2, tests/ingredients-corpus.test.ts):
 * see docs/INGREDIENTS.md, "Resolution". 0.15 is the knee: lower adds noise
 * candidates for almost no more hits.
 */
export const FUZZY = { minScore: 0.15, count: 3 };

/**
 * What the resolve queue and W305 show of the candidates (usability round 3:
 * « vanile » offered « huile végétale » beside « vanille »): none below
 * `floor`, and none below `relative` × the best one's score — a weak
 * look-alike beside a strong one is noise. Best first, as `candidates` gives
 * them. On the corpus the relative cut keeps every right answer (R2 58.1 %)
 * with 1.70 candidates shown instead of 1.94; a higher floor would lose right
 * answers (0.2: 53.9 %). See docs/INGREDIENTS.md, "Resolution".
 */
export const SHOWN = { floor: FUZZY.minScore, relative: 0.5 };

/** The candidates worth showing (SHOWN): an ambiguous key's owners (score 1) and a clear typo always. */
export function shownCandidates<T extends Candidate>(cands: readonly T[]): T[] {
	const best = Math.max(0, ...cands.map((c) => c.score));
	return cands.filter((c) => c.strong || c.score >= Math.max(SHOWN.floor, best * SHOWN.relative));
}

/**
 * A clear typo (usability round 5: /resoudre offered « lime » for « lièvre »
 * as its answer): the typed singular key is at most `perChars` characters
 * per edit (an adjacent swap counts one) from an alias's singular key, and
 * at most `maxEdits` edits — « vanile » → vanille, « oingon » → oignon,
 * « beouf haché » → bœuf haché, never a 3-letter word. On the corpus
 * (tests/ingredients-corpus.test.ts, R2) a strong first candidate is right
 * 23 times out of 23; two edits would add one wrong (« soupe tomate » →
 * sauce tomate). See docs/INGREDIENTS.md, "Resolution".
 */
export const STRONG = { perChars: 4, maxEdits: 1 };

/** Optimal string alignment distance: Levenshtein with an adjacent swap as one edit. */
export function typoDistance(a: string, b: string): number {
	if (a === b) return 0;
	const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)));
	for (let i = 1; i <= a.length; i++)
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
		}
	return d[a.length][b.length];
}

/** Whether a typed key is a clear typo of an alias key (`STRONG`); both singular lookup keys. */
export function clearTypo(typed: string, alias: string): boolean {
	const max = Math.min(STRONG.maxEdits, Math.floor(typed.length / STRONG.perChars));
	return max > 0 && Math.abs(typed.length - alias.length) <= max && typoDistance(typed, alias) <= max;
}

/**
 * Whether a typed key and an alias share a stem: some word of each starts
 * with the same letter and the two share a run of three letters (`ognon` and
 * `oignon`, `noix` and `noix de coco`); a word under three letters must be
 * the same word. A trigram match with no such word is too loose to show
 * (usability round 5: « nouilles » → citrouille, « lièvre » → lime, « soda »
 * → son de blé). Checked on the alias that matched, never on the entry's
 * display name: « soda » shares its stem with the alias « soda à pâte », not
 * with « bicarbonate de soude » — the two used to disagree between /resoudre
 * and the paste box's W305.
 */
export function sharesStem(typed: string, alias: string): boolean {
	const grams = (w: string) => {
		const out = new Set<string>();
		for (let i = 0; i + 3 <= w.length; i++) out.add(w.slice(i, i + 3));
		return out;
	};
	const b = wordsOf(alias);
	return wordsOf(typed).some((x) =>
		b.some((y) => {
			if (x[0] !== y[0]) return false;
			if (x.length < 3 || y.length < 3) return x === y;
			const gy = grams(y);
			return [...grams(x)].some((g) => gy.has(g));
		})
	);
}

export interface NameRow {
	key: string;
	/** The key with the alias's language plural rules applied. */
	skey: string;
	slug: string;
	/** The alias's language: which end of it is the noun (`modifierOnly`). Absent: either. */
	lang?: string;
}

/** The alias rows of registry entries, as the index stores them in `ingredient_names`. */
export function nameRows(entries: Pick<RegistryEntry, 'slug' | 'names'>[], plurals: PluralRules = {}): NameRow[] {
	const out: NameRow[] = [];
	for (const e of entries)
		for (const lang of NAME_LANGS)
			for (const n of e.names[lang] ?? []) {
				const key = lookupKey(n);
				out.push({ key, skey: singularKey(key, plurals[lang]), slug: e.slug, lang });
			}
	return out;
}

const wordsOf = (s: string) => s.split(/[\s'-]+/).filter(Boolean);

/**
 * The typed name is, word for word, only a modifier inside a longer alias:
 * « soda » in « biscuits soda » (French puts the noun first) or in « soda
 * crackers » (English puts it last). Such an alias names another product, so
 * it is never a candidate for that name (usability round 4: « soda », baking
 * soda on a Québec card, was offered « biscuits soda »). An alias that starts
 * (French) or ends (English) with the typed words keeps its place: « soda à
 * pâte » for « soda », « brown sugar » for « sugar ». Both ends when the
 * alias's language is not known. Keys compared as lookup keys, singular.
 */
export function modifierOnly(typed: string, alias: string, lang?: string): boolean {
	const t = wordsOf(typed);
	const a = wordsOf(alias);
	if (!t.length || a.length <= t.length) return false;
	const at: number[] = [];
	for (let i = 0; i + t.length <= a.length; i++) if (t.every((w, k) => a[i + k] === w)) at.push(i);
	if (!at.length) return false;
	const head = (i: number) => (lang === 'fr' ? i === 0 : lang === 'en' ? i === a.length - t.length : i === 0 || i === a.length - t.length);
	return !at.some(head);
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
	private fuzzyKeys: { skey: string; slug: string; grams: number; lang?: string }[] = [];
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
		const seen = new Map<string, number>();
		for (const r of rows) {
			this.slugs.add(r.slug);
			add(this.byKey, r.key, r.slug);
			add(this.bySkey, r.skey, r.slug);
			const id = `${r.slug}\0${r.skey}`;
			const had = seen.get(id);
			if (had !== undefined) {
				// The same alias in both languages: either end may be its noun.
				if (this.fuzzyKeys[had].lang !== r.lang) this.fuzzyKeys[had].lang = undefined;
				continue;
			}
			const grams = trigrams(r.skey);
			const i = this.fuzzyKeys.push({ skey: r.skey, slug: r.slug, grams: grams.size, lang: r.lang }) - 1;
			seen.set(id, i);
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

	/** Whether any rule names this key (see rulesFor): its resolution then depends on the line. */
	hasRules(key: string, lang: Lang | string = 'fr'): boolean {
		return this.rulesFor(key, lang).length > 0;
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

	/**
	 * The rules naming a key: exact first, else by singular key — but only when
	 * the exact key is no entry's alias. An exact alias is surer than a rule
	 * reached through a plural rule: a rule on `pâte` must not capture `pâtes`,
	 * an alias of another entry (0 wrong links).
	 */
	private rulesFor(key: string, lang: string): RuleRow[] {
		const exact = this.rulesByKey.get(key);
		if (exact) return exact;
		if (this.byKey.has(key)) return [];
		return this.skeyRules(lang).get(this.singular(key, lang)) ?? [];
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

	/** The entries whose rules naming the key hold on a line (two or more: the line is ambiguous by rule). */
	heldBy(key: string, lang: Lang | string = 'fr', ctx: LineContext = {}): string[] {
		return [...new Set(this.rulesFor(key, lang).filter((r) => this.holds(r, lang, ctx)).map((r) => r.slug))].sort();
	}

	/** Whether a rule name (a lookup key) is one through which `key` reaches its rules (see rulesFor). */
	ruleNameReaches(ruleKey: string, key: string, lang: Lang | string = 'fr'): boolean {
		if (ruleKey === key) return true;
		if (this.rulesByKey.has(key) || this.byKey.has(key)) return false;
		return this.singular(ruleKey, lang) === this.singular(key, lang);
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
	 * at most `count`, none below `minScore` — never an alias in which the
	 * name is only a modifier (`modifierOnly`: « biscuits soda » for « soda »),
	 * nor one sharing no stem with it (`sharesStem`; `stem: false` for the
	 * corpus sweep). A clear typo of an alias is `strong` and comes first.
	 */
	candidates(key: string, lang: Lang | string = 'fr', { minScore = FUZZY.minScore, count = FUZZY.count, stem = true } = {}): Candidate[] {
		const exact = new Set(this.byKey.get(key));
		for (const r of this.rulesFor(key, lang)) exact.add(r.slug);
		// The owners of an ambiguous key: one must be chosen, none is the answer.
		if (exact.size > 1) return [...exact].sort().map((slug) => ({ slug, score: 1 }));
		const sk = this.singular(key, lang);
		const grams = trigrams(sk);
		if (!grams.size) return [];
		const shared = new Map<number, number>();
		for (const g of grams) for (const i of this.gramIndex.get(g) ?? []) shared.set(i, (shared.get(i) ?? 0) + 1);
		const best = new Map<string, number>();
		const strong = new Set<string>();
		for (const [i, n] of shared) {
			const f = this.fuzzyKeys[i];
			const score = n / (grams.size + f.grams - n);
			if (score < minScore || modifierOnly(sk, f.skey, f.lang)) continue;
			const typo = clearTypo(sk, f.skey);
			// A clear typo may share no run of three letters (« oingon », oignon).
			if (stem && !typo && !sharesStem(sk, f.skey)) continue;
			if (typo) strong.add(f.slug);
			if (score > (best.get(f.slug) ?? 0)) best.set(f.slug, score);
		}
		// A key only one entry's rules name: that entry first — not the answer,
		// though: the rule's conditions did not hold on this line (« soda » with
		// no unit, or by the cup).
		for (const slug of exact) best.set(slug, 1);
		return [...best]
			.map(([slug, score]): Candidate => ({ slug, score, ...(strong.has(slug) && !exact.has(slug) ? { strong: true as const } : {}) }))
			// A clear typo before a guess, whatever their trigram scores (« beure »: beurre, then babeurre).
			.sort((a, b) => Number(!!b.strong) - Number(!!a.strong) || b.score - a.score || a.slug.localeCompare(b.slug))
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
			const c = shownCandidates(resolver.candidates(r.key, recipe.lang));
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
