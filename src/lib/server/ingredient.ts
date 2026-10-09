// The ingredient view (plan 03, Phase 6; docs/INGREDIENTS.md, "Two views",
// Ingredient view): one registry entry with its prices, the recipes using it
// sorted by how much they use, the vault-wide total, substitutes both ways,
// and the unresolved names that drift towards it. Plus the edits made from
// it: the entry's fields, one more alias, and "Fusionner dans…" (Q25 B).
// Every edit writes ingredient files only, through the queue's commit path
// (write → commit → re-resolve), with the stale-write guard.

import { withName, withPatch, IngredientEditError, type EntryPatch } from '../ingredients/registry';
import { isStale, today } from '../ingredients/prices';
import { CATEGORIES, displayName, NAME_LANGS, type Category, type RegistryEntry } from '../ingredients/types';
import { measure, noteSize, packsOf, type Conversions } from '../ingredients/units';
import { SLUG_RE } from '../vault/slug';
import { UNITS, type Lang, type Recipe, type Unit } from '../vault/types';
import type { VaultContext } from './context';
import type { FileWrite } from './files';
import type { DB } from './index/db';
import { getResolver } from './index/resolve';
import { toPriceRow } from './prices';
import { checked, commitEntries, current, queueGroups, QueueError } from './queue';
import { ingredientPath } from './registry';
import { loadVocab, type VaultVocab } from './vocab';

export class IngredientError extends QueueError {}

export interface PriceHistoryRow {
	line: number;
	date: string;
	amount: number;
	currency: string;
	packQty: number;
	packUnit: Unit;
	shop: string;
	note: string;
	/** In the config's currency: used for cost. */
	usable: boolean;
	/** Change of the unit price from the previous usable row, as a fraction (0.1 = +10 %); absent when not comparable. */
	change?: number;
	/** This is the current price. */
	current: boolean;
}

export interface RecipeUse {
	slug: string;
	title: string;
	/** Each line as written: `2 tasses`, empty when no quantity. */
	written: { qty: string; value: number | null; unit: Unit | null; toTaste: boolean; optional: boolean }[];
	/** The recipe's amount in the view's unit; absent when a line does not convert. */
	amount?: number;
	/** Only as one choice of an `or`. */
	option: boolean;
}

export interface DriftName {
	key: string;
	forms: { name: string; count: number }[];
	count: number;
	recipes: number;
	lang: Lang;
	/** The key is an alias of this entry and of another one. */
	ambiguous: boolean;
	score: number;
}

export interface IngredientView {
	entry: RegistryEntry;
	name: string;
	hash: string;
	/** The file's diagnostics (a broken file keeps its last good entry). */
	problems: { code: string; severity: string; path: string | null; message: string; fix?: string }[];
	broken: boolean;
	allergens: { slug: string; label: string }[];
	history: PriceHistoryRow[];
	current?: PriceHistoryRow & { stale: boolean };
	/** The unit recipes are summed and sorted in (Q26 A: `default_unit`, else the current pack's unit, else the most used). */
	unit: Unit | null;
	unitFrom: 'default' | 'price' | 'usage' | null;
	uses: RecipeUse[];
	/** Sum over the recipes whose every line converts; `unconverted` recipes are left out. */
	total: { amount: number; recipes: number; unconverted: number };
	substitutes: { slug: string; name: string }[];
	substituteFor: { slug: string; name: string }[];
	drift: DriftName[];
}

interface UseRow {
	slug: string;
	title: string;
	qty: number | null;
	qty_max: number | null;
	qty_s: string | null;
	unit: string | null;
	to_taste: number;
	optional: number;
	group_optional: number;
	position: number;
}

/** The unit price of `b` relative to `a`: how the price of the same amount changed; undefined when the packs do not compare. */
function priceChange(a: PriceHistoryRow, b: PriceHistoryRow, e: RegistryEntry, conv: Conversions): number | undefined {
	const aPacks = packsOf(measure(a.packQty, a.packUnit, e, conv), measure(b.packQty, b.packUnit, e, conv));
	if (!aPacks) return undefined;
	const before = a.amount / aPacks;
	return (b.amount - before) / before;
}

/** The ingredient view's data, or undefined when the slug is not in the registry. */
export function ingredientView(db: DB, slug: string, vocab: VaultVocab, on = today()): IngredientView | undefined {
	const row = db.prepare('SELECT entry_json, file_hash, file_path FROM registry WHERE slug = ?').get(slug) as
		| { entry_json: string; file_hash: string; file_path: string }
		| undefined;
	if (!row) return undefined;
	const entry = JSON.parse(row.entry_json) as RegistryEntry;
	const conv = vocab.conversions;
	const nameOf = db.prepare('SELECT name FROM registry WHERE slug = ?').pluck();
	const named = (s: string) => ({ slug: s, name: (nameOf.get(s) as string | undefined) ?? s });

	const prob = db.prepare('SELECT broken, diagnostics, file_hash FROM registry_problems WHERE file_path = ?').get(row.file_path) as
		| { broken: number; diagnostics: string; file_hash: string }
		| undefined;

	// Prices, oldest first; the change is against the previous usable row.
	const history = (db.prepare('SELECT * FROM prices WHERE ingredient = ? ORDER BY date, line').all(slug) as (Parameters<typeof toPriceRow>[0] & { usable: number })[]).map(
		(r): PriceHistoryRow => ({ ...toPriceRow(r), usable: r.usable === 1, current: false })
	);
	let prev: PriceHistoryRow | undefined;
	for (const h of history) {
		if (!h.usable) continue;
		if (prev) h.change = priceChange(prev, h, entry, conv);
		prev = h;
	}
	const cur = db.prepare('SELECT line FROM current_price WHERE ingredient = ?').pluck().get(slug) as number | undefined;
	const curRow = history.find((h) => h.line === cur);
	if (curRow) curRow.current = true;

	// Recipes using it: main lines, then `or` options.
	const main = db
		.prepare(
			`SELECT i.slug, r.title, i.qty, i.qty_max, i.qty_s, i.unit, i.to_taste, i.optional, i.group_optional, i.position
			 FROM ingredients i JOIN recipes r ON r.slug = i.slug WHERE i.item = ? ORDER BY i.slug, i.position`
		)
		.all(slug) as UseRow[];
	const options = db
		.prepare(`SELECT DISTINCT o.slug, r.title FROM ingredient_or o JOIN recipes r ON r.slug = o.slug WHERE o.item = ? ORDER BY o.slug`)
		.all(slug) as { slug: string; title: string }[];

	let unit: Unit | null = entry.defaultUnit ?? null;
	let unitFrom: IngredientView['unitFrom'] = unit ? 'default' : null;
	if (!unit && curRow) [unit, unitFrom] = [curRow.packUnit, 'price'];
	if (!unit) {
		const counts = new Map<string, number>();
		for (const u of main) if (u.unit || u.qty !== null) counts.set(u.unit ?? 'piece', (counts.get(u.unit ?? 'piece') ?? 0) + 1);
		const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
		if (top) [unit, unitFrom] = [top[0] as Unit, 'usage'];
	}
	const one = unit ? measure(1, unit, entry, conv) : undefined;
	// A container's size is in the line's note, which the index keeps only in the parsed recipe.
	const noteOf = (s: string, position: number): string | undefined => {
		const json = db.prepare('SELECT data_json FROM recipes WHERE slug = ?').pluck().get(s) as string | undefined;
		return json ? (JSON.parse(json) as Recipe).ingredients.flatMap((g) => g.items)[position]?.note : undefined;
	};
	const langOf = db.prepare('SELECT lang FROM recipes WHERE slug = ?').pluck();

	const bySlug = new Map<string, RecipeUse & { failed: boolean }>();
	for (const u of main) {
		let use = bySlug.get(u.slug);
		if (!use) bySlug.set(u.slug, (use = { slug: u.slug, title: u.title, written: [], option: false, failed: false }));
		use.written.push({ qty: u.qty_s ?? '', value: u.qty_max ?? u.qty, unit: (u.unit as Unit) ?? null, toTaste: u.to_taste === 1, optional: u.optional === 1 || u.group_optional === 1 });
		const q = u.qty_max ?? u.qty;
		const lineUnit = (u.unit ?? (q !== null ? 'piece' : null)) as Unit | null;
		let amount: number | undefined;
		if (one && q !== null && lineUnit) {
			const size = ['can', 'packet', 'jar', 'bottle', 'bag'].includes(lineUnit) ? noteSize(noteOf(u.slug, u.position), langOf.get(u.slug) as Lang) : undefined;
			amount = packsOf(measure(q, lineUnit, entry, conv, size), one);
		}
		if (amount === undefined) use.failed = true;
		else use.amount = (use.amount ?? 0) + amount;
	}
	const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
	const converted: RecipeUse[] = [];
	const rest: RecipeUse[] = [];
	for (const { failed, ...u } of bySlug.values()) {
		if (failed) rest.push({ ...u, amount: undefined });
		else converted.push(u);
	}
	converted.sort((a, b) => b.amount! - a.amount! || collator.compare(a.title, b.title));
	rest.sort((a, b) => collator.compare(a.title, b.title));
	const optionUses = options
		.filter((o) => !bySlug.has(o.slug))
		.map((o): RecipeUse => ({ slug: o.slug, title: o.title, written: [], option: true }))
		.sort((a, b) => collator.compare(a.title, b.title));

	// Unresolved names whose candidates include this entry ("drift").
	const resolver = getResolver(db, vocab);
	const drift: DriftName[] = [];
	for (const g of queueGroups(db)) {
		const c = resolver.candidates(g.key, g.lang).find((x) => x.slug === slug);
		if (c) drift.push({ key: g.key, forms: g.forms, count: g.count, recipes: g.recipes, lang: g.lang, ambiguous: g.ambiguous, score: c.score });
	}

	return {
		entry,
		name: displayName(entry),
		hash: row.file_hash,
		problems: prob ? JSON.parse(prob.diagnostics) : [],
		broken: prob?.broken === 1,
		allergens: entry.allergens.map((a) => ({ slug: a, label: vocab.allergens.get(a)?.fr ?? a })),
		history,
		current: curRow && { ...curRow, stale: isStale(curRow.date, on) },
		unit,
		unitFrom,
		uses: [...converted, ...rest, ...optionUses],
		total: { amount: converted.reduce((s, u) => s + u.amount!, 0), recipes: converted.length, unconverted: rest.length },
		substitutes: entry.substitutes.map(named),
		substituteFor: (db.prepare('SELECT slug FROM substitutes WHERE substitute = ? ORDER BY slug').pluck().all(slug) as string[]).map(named),
		drift
	};
}

// --- Edits --------------------------------------------------------------------

export interface EntryInput {
	names: Record<Lang, string[]>;
	category: string;
	defaultUnit: string;
	staple: boolean;
	auGout: boolean;
	/** As typed; empty removes it. */
	density: string;
	weights: { unit: string; grams: string }[];
	substitutes: string[];
	allergens: string[];
}

/** A number as typed in a French form: `0,53` or `0.53`. */
export const formNumber = (s: string) => {
	const t = s.replace(/[\s  ]/g, '').replace(',', '.');
	return /^(?:\d+|\d*\.\d+)$/.test(t) ? Number(t) : NaN;
};

function editError(slug: string, e: unknown): never {
	if (e instanceof IngredientEditError) throw new IngredientError(`${ingredientPath(slug)} ne se lit pas ; corrigez-le d’abord (${e.message}).`);
	throw e;
}

/**
 * Save the fields edited on the ingredient view. `hash` is the file as the
 * person saw it: a file changed since is refused (docs/DATA-FLOW.md,
 * "Concurrent edit"). The file is edited in place, so comments and the notes
 * survive. Commit `ingredient: edit <slug>`.
 */
export function editEntry(ctx: VaultContext, slug: string, hash: string, input: EntryInput): Promise<{ commit?: string }> {
	return ctx.lock.run(async () => {
		const vocab = loadVocab(ctx.paths.vocab);
		const file = current(ctx, slug, hash);
		if (!(CATEGORIES as readonly string[]).includes(input.category)) throw new IngredientError('choisissez une catégorie.');
		if (input.defaultUnit && !(UNITS as readonly string[]).includes(input.defaultUnit)) throw new IngredientError(`unité inconnue : ${input.defaultUnit}.`);
		const names = Object.fromEntries(NAME_LANGS.map((l) => [l, [...new Set(input.names[l].map((n) => n.replace(/\s+/g, ' ').trim()).filter(Boolean))]])) as Record<Lang, string[]>;
		if (!names.fr.length && !names.en.length) throw new IngredientError('gardez au moins un nom.');
		let density: number | null = null;
		if (input.density.trim()) {
			density = formNumber(input.density);
			if (!(density > 0)) throw new IngredientError('la densité doit être un nombre plus grand que zéro (grammes par millilitre).');
		}
		const weights: Partial<Record<Unit, number>> = {};
		for (const w of input.weights) {
			if (!w.unit && !w.grams.trim()) continue;
			if (!(UNITS as readonly string[]).includes(w.unit)) throw new IngredientError('choisissez l’unité de chaque poids.');
			const g = formNumber(w.grams);
			if (!(g > 0)) throw new IngredientError(`le poids d’une unité (${w.unit}) doit être un nombre de grammes plus grand que zéro.`);
			weights[w.unit as Unit] = g;
		}
		const substitutes = [...new Set(input.substitutes.map((s) => s.trim()).filter(Boolean))];
		const bad = substitutes.filter((s) => !SLUG_RE.test(s) || s === slug || !ctx.db.prepare('SELECT 1 FROM registry WHERE slug = ?').get(s));
		if (bad.length) throw new IngredientError(`substitut inconnu : ${bad.join(', ')}.`);
		const allergens = [...new Set(input.allergens)];
		const unknown = vocab.allergens.size ? allergens.filter((a) => !vocab.allergens.has(a)) : [];
		if (unknown.length) throw new IngredientError(`allergène hors de la liste : ${unknown.join(', ')}.`);
		const patch: EntryPatch = {
			names,
			category: input.category as Category,
			defaultUnit: (input.defaultUnit as Unit) || null,
			staple: input.staple,
			auGout: input.auGout,
			density,
			weights,
			substitutes,
			allergens
		};
		let text: string;
		try {
			text = withPatch(file.text, patch);
		} catch (e) {
			editError(slug, e);
		}
		if (text === file.text) throw new IngredientError('rien n’a changé.');
		checked(text, slug, vocab);
		return { commit: await commitEntries(ctx, vocab, [{ rel: ingredientPath(slug), text }], `ingredient: edit ${slug}`) };
	});
}

/** Add one written name to an entry, from its view. Commit as the queue's link: `ingredient: <slug> + "<name>"`. */
export function addAlias(ctx: VaultContext, slug: string, hash: string, lang: Lang, name: string): Promise<{ commit?: string }> {
	return ctx.lock.run(async () => {
		const vocab = loadVocab(ctx.paths.vocab);
		const form = name.replace(/\s+/g, ' ').trim();
		if (!form) throw new IngredientError('écrivez le nom à ajouter.');
		if (!(NAME_LANGS as readonly string[]).includes(lang)) throw new IngredientError('langue inconnue.');
		const file = current(ctx, slug, hash);
		let text: string;
		try {
			text = withName(file.text, lang, form);
		} catch (e) {
			editError(slug, e);
		}
		if (text === file.text) throw new IngredientError(`« ${form} » est déjà un nom de ${slug}.`);
		checked(text, slug, vocab);
		return { commit: await commitEntries(ctx, vocab, [{ rel: ingredientPath(slug), text }], `ingredient: ${slug} + "${form}"`) };
	});
}

/**
 * Fusionner dans… (plan 03, Q25 B): `from` is absorbed into `into`. Its names,
 * rules, substitutes and allergens join `into` (an allergen is never dropped),
 * its notes are appended, entries naming `from` as a substitute name `into`
 * instead, and its file is deleted — one commit, `ingredient: merge <from>
 * into <into>`. Refused when prices.csv has rows for `from` (the file stays
 * append-only), a recipe names it in `item:` (resolution never writes a
 * recipe), or a sub-recipe line `recipe: <from>` has `buy_instead: true` (it
 * counts through the entry of that slug). Both hashes are the files as the person saw them.
 */
export function mergeEntry(ctx: VaultContext, from: string, into: string, fromHash: string, intoHash?: string): Promise<{ commit?: string }> {
	return ctx.lock.run(async () => {
		const vocab = loadVocab(ctx.paths.vocab);
		if (from === into) throw new IngredientError('choisissez un autre ingrédient que celui-ci.');
		const a = current(ctx, from, fromHash);
		const b = current(ctx, into, intoHash);
		const prices = ctx.db.prepare('SELECT count(*) FROM prices WHERE ingredient = ?').pluck().get(from) as number;
		if (prices)
			throw new IngredientError(
				`${from} a ${prices === 1 ? '1 prix' : `${prices} prix`} dans prices.csv ; le fichier des prix ne se réécrit pas. Fusionnez à la main ou gardez les deux ingrédients.`
			);
		const overrides = ctx.db
			.prepare(`SELECT slug FROM ingredients WHERE resolution = 'override' AND item = ? UNION SELECT slug FROM ingredient_or WHERE resolution = 'override' AND item = ? ORDER BY 1`)
			.pluck()
			.all(from, from) as string[];
		if (overrides.length) throw new IngredientError(`des recettes nomment ${from} dans « item: » (${overrides.join(', ')}) ; corrigez-les d’abord.`);
		// A sub-recipe line bought instead counts through the entry of its slug (cost, pantry).
		const bought = ctx.db.prepare('SELECT DISTINCT slug FROM ingredients WHERE recipe = ? AND buy_instead = 1 ORDER BY 1').pluck().all(from) as string[];
		if (bought.length)
			throw new IngredientError(
				`des recettes achètent ${from} au lieu de le faire (« recipe: ${from} » avec « buy_instead: true » : ${bought.join(', ')}) ; sans l’ingrédient ${from}, ces lignes perdraient leur prix et leur place au garde-manger. Corrigez-les d’abord.`
			);
		const absorbed = checked(a.text, from, vocab);
		const target = checked(b.text, into, vocab);

		// Names: every name of `from` that `into` does not already have (by lookup key).
		let text = b.text;
		try {
			for (const lang of NAME_LANGS) for (const n of absorbed.names[lang]) text = withName(text, lang, n);
			text = withPatch(text, {
				addRules: absorbed.when,
				substitutes: [...new Set([...target.substitutes, ...absorbed.substitutes])].filter((s) => s !== into && s !== from),
				allergens: [...new Set([...target.allergens, ...absorbed.allergens])],
				appendBody: absorbed.body
			});
		} catch (e) {
			editError(into, e);
		}
		checked(text, into, vocab);
		const writes: FileWrite[] = [
			{ rel: ingredientPath(into), text },
			{ rel: ingredientPath(from), text: null }
		];
		// Entries that list `from` as a substitute now list `into`.
		for (const s of ctx.db.prepare('SELECT slug FROM substitutes WHERE substitute = ? AND slug NOT IN (?, ?)').pluck().all(from, from, into) as string[]) {
			const f = current(ctx, s, undefined);
			const e = checked(f.text, s, vocab);
			let t: string;
			try {
				t = withPatch(f.text, { substitutes: [...new Set(e.substitutes.map((x) => (x === from ? into : x)))].filter((x) => x !== s) });
			} catch (err) {
				editError(s, err);
			}
			checked(t, s, vocab);
			writes.push({ rel: ingredientPath(s), text: t });
		}
		return { commit: await commitEntries(ctx, vocab, writes, `ingredient: merge ${from} into ${into}`) };
	});
}
