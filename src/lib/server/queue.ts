// The resolve queue (plan 03, Phase 3; docs/INGREDIENTS.md, "Resolution"):
// every unresolved or ambiguous lookup key across the vault, most frequent
// first, and the actions that settle one — link the name to an existing
// ingredient, create an ingredient from it, take an ambiguous alias off an
// entry, or give an entry a disambiguation rule for it (docs/INGREDIENTS.md,
// "Disambiguation rules"). Each action edits one ingredient file, commits it,
// and re-resolves the index. No recipe file is touched (docs/STORAGE.md).

import { IngredientEditError, parseIngredient, serializeIngredient, withName, withoutKey, withRule } from '../ingredients/registry';
import type { Candidate } from '../ingredients/resolve';
import { CATEGORIES, UNIT_CLASSES, type Category, type NameRule, type RegistryEntry } from '../ingredients/types';
import { stripMarkers } from '../vault/markers';
import { SLUG_RE } from '../vault/slug';
import { UNITS, type Lang } from '../vault/types';
import type { VaultContext } from './context';
import { FileWriteError, readVaultFile, writeAndCommit, type FileWrite } from './files';
import type { DB } from './index/db';
import { getResolver, reresolve } from './index/resolve';
import { ingredientPath, syncRegistry } from './registry';
import { loadVocab, type VaultVocab } from './vocab';

export class QueueError extends Error {}

const UNRESOLVED = `resolution IN ('none', 'ambiguous')`;

export interface QueueCandidate extends Candidate {
	/** The entry's display name. */
	name: string;
	/** The entry file's hash, for the stale-write guard. */
	hash: string;
}

export interface QueueRow {
	key: string;
	/** Written forms (markers stripped) with their counts, most frequent first. */
	forms: { name: string; count: number }[];
	/** Occurrences across the vault (ingredient lines and `or` options). */
	count: number;
	recipes: number;
	/** The language most of those recipes are in: where a new alias goes. */
	lang: Lang;
	ambiguous: boolean;
	/** The units of the unresolved lines (null: no unit), most frequent first: what a rule may be conditioned on. */
	units: { unit: string | null; count: number }[];
	/** For an ambiguous key: the entries that share it. Otherwise the nearest entries. */
	candidates: QueueCandidate[];
}

/** How many keys wait in the queue (the nav badge). */
export function queueCount(db: DB): number {
	return db
		.prepare(`SELECT count(*) FROM (SELECT key FROM ingredients WHERE ${UNRESOLVED} UNION SELECT key FROM ingredient_or WHERE ${UNRESOLVED})`)
		.pluck()
		.get() as number;
}

export type QueueGroup = Omit<QueueRow, 'candidates'>;
type Group = QueueGroup;

/** The queue without candidates, most frequent key first. */
export function queueGroups(db: DB): Group[] {
	const uses = db
		.prepare(
			`SELECT x.key, x.name, x.resolution, x.slug, x.unit, r.lang FROM (
			   SELECT slug, key, name, resolution, unit FROM ingredients WHERE ${UNRESOLVED}
			   UNION ALL SELECT slug, key, name, resolution, NULL FROM ingredient_or WHERE ${UNRESOLVED}
			 ) x JOIN recipes r ON r.slug = x.slug`
		)
		.all() as { key: string; name: string; resolution: string; slug: string; unit: string | null; lang: string }[];
	const byKey = new Map<string, { forms: Map<string, number>; units: Map<string | null, number>; recipes: Map<string, string>; count: number; ambiguous: boolean }>();
	for (const u of uses) {
		let g = byKey.get(u.key);
		if (!g) byKey.set(u.key, (g = { forms: new Map(), units: new Map(), recipes: new Map(), count: 0, ambiguous: false }));
		const form = stripMarkers(u.name).trim();
		g.forms.set(form, (g.forms.get(form) ?? 0) + 1);
		g.units.set(u.unit, (g.units.get(u.unit) ?? 0) + 1);
		g.recipes.set(u.slug, u.lang);
		g.count++;
		g.ambiguous ||= u.resolution === 'ambiguous';
	}
	return [...byKey]
		.map(([key, g]): Group => {
			const langs = new Map<string, number>();
			for (const l of g.recipes.values()) langs.set(l, (langs.get(l) ?? 0) + 1);
			return {
				key,
				forms: [...g.forms].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
				count: g.count,
				recipes: g.recipes.size,
				lang: ([...langs].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'fr') as Lang,
				ambiguous: g.ambiguous,
				units: [...g.units].map(([unit, count]) => ({ unit, count })).sort((a, b) => b.count - a.count || String(a.unit).localeCompare(String(b.unit)))
			};
		})
		.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function resolveQueue(db: DB, vocab: Pick<VaultVocab, 'normalize'> | (() => Pick<VaultVocab, 'normalize'>), { limit = 50, offset = 0 } = {}): { total: number; rows: QueueRow[] } {
	const all = queueGroups(db);
	const resolver = getResolver(db, vocab);
	const entry = db.prepare('SELECT name, file_hash FROM registry WHERE slug = ?');
	const rows = all.slice(offset, offset + limit).map((g): QueueRow => ({
		...g,
		candidates: resolver.candidates(g.key, g.lang).flatMap((c) => {
			const e = entry.get(c.slug) as { name: string; file_hash: string } | undefined;
			return e ? [{ ...c, name: e.name, hash: e.file_hash }] : [];
		})
	}));
	return { total: all.length, rows };
}

/** The queue row of one key, if it is still in the queue. */
function rowOf(db: DB, key: string): Group | undefined {
	return queueGroups(db).find((r) => r.key === key);
}

/**
 * Commit ingredient files (one commit), then reload the registry and
 * re-resolve. Shared with the ingredient view (edit, merge). The caller holds
 * the lock.
 */
export async function commitEntries(ctx: VaultContext, vocab: VaultVocab, writes: FileWrite[], message: string): Promise<string | undefined> {
	let commit: string | undefined;
	try {
		commit = await writeAndCommit(ctx, writes, message);
	} catch (e) {
		if (!(e instanceof FileWriteError)) throw e;
		throw new QueueError(
			e.stage === 'write'
				? `le fichier n’a pas pu être écrit ; rien n’a changé : ${e.message}`
				: `l’ingrédient n’a pas pu être enregistré (git) ; rien n’a changé : ${e.message}`
		);
	}
	try {
		ctx.db.transaction(() => {
			if (syncRegistry(ctx.db, ctx.paths, vocab).changed) reresolve(ctx.db, getResolver(ctx.db, vocab));
		})();
	} catch (e) {
		ctx.log(`recipevault: index update failed after commit (vault sync will recover): ${(e as Error).message}`);
	}
	ctx.pusher.schedule();
	return commit;
}

/** Refuse a file that would not pass its own check. */
export function checked(text: string, slug: string, vocab: VaultVocab): RegistryEntry {
	const r = parseIngredient(text, { fileStem: slug, allergens: vocab.allergens.size ? new Set(vocab.allergens.keys()) : undefined });
	const errors = r.diagnostics.filter((d) => d.severity === 'error');
	if (!r.entry || errors.length) throw new QueueError(`l’ingrédient ne passerait pas la validation (${errors.map((d) => d.code).join(', ') || 'illisible'}).`);
	return r.entry;
}

/** An entry file as on disk, refused when missing or changed since `hash` (when given). */
export function current(ctx: VaultContext, slug: string, hash: string | undefined) {
	if (!SLUG_RE.test(slug)) throw new QueueError('identifiant d’ingrédient invalide.');
	const file = readVaultFile(ctx, ingredientPath(slug));
	if (!file.hash) throw new QueueError(`l’ingrédient ${slug} n’existe pas.`);
	if (hash !== undefined && file.hash !== hash) throw new QueueError(`l’ingrédient ${slug} a changé depuis l’ouverture de la page ; rechargez-la.`);
	return file;
}

/**
 * Relier: add the key's most frequent written form to an existing entry's
 * names, in the language of most recipes using it. `hash` is the entry file's
 * hash as the person saw it (absent when the entry was picked by name only).
 */
export function linkKey(ctx: VaultContext, key: string, slug: string, hash?: string): Promise<{ commit?: string }> {
	return ctx.lock.run(async () => {
		const vocab = loadVocab(ctx.paths.vocab);
		const row = rowOf(ctx.db, key);
		if (!row) throw new QueueError('ce nom est déjà relié ; rechargez la page.');
		const file = current(ctx, slug, hash);
		const form = row.forms[0].name;
		let text: string;
		try {
			text = withName(file.text, row.lang, form);
		} catch (e) {
			throw new QueueError(`${ingredientPath(slug)} ne se lit pas ; corrigez-le d’abord (${(e as IngredientEditError).message}).`);
		}
		if (text === file.text) throw new QueueError(`« ${form} » est déjà un nom de ${slug}.`);
		checked(text, slug, vocab);
		return { commit: await commitEntries(ctx, vocab, [{ rel: ingredientPath(slug), text }], `ingredient: ${slug} + "${form}"`) };
	});
}

export interface NewIngredient {
	slug: string;
	category: string;
	staple: boolean;
}

/** Créer: a new entry whose first alias is the key's most frequent written form. */
export function createFromKey(ctx: VaultContext, key: string, input: NewIngredient): Promise<{ commit?: string; slug: string }> {
	return ctx.lock.run(async () => {
		const vocab = loadVocab(ctx.paths.vocab);
		const row = rowOf(ctx.db, key);
		if (!row) throw new QueueError('ce nom est déjà relié ; rechargez la page.');
		const slug = input.slug.trim();
		if (!SLUG_RE.test(slug)) throw new QueueError('identifiant invalide : lettres minuscules sans accents, chiffres et traits d’union.');
		if (!(CATEGORIES as readonly string[]).includes(input.category)) throw new QueueError('choisissez une catégorie.');
		if (readVaultFile(ctx, ingredientPath(slug)).hash) throw new QueueError(`l’ingrédient ${slug} existe déjà ; reliez le nom à celui-ci, ou choisissez un autre identifiant.`);
		const form = row.forms[0].name;
		const text = serializeIngredient({
			slug,
			category: input.category as Category,
			names: { fr: row.lang === 'en' ? [] : [form], en: row.lang === 'en' ? [form] : [] },
			staple: input.staple,
			auGout: false,
			weights: {},
			substitutes: [],
			allergens: [],
			body: ''
		});
		checked(text, slug, vocab);
		return { commit: await commitEntries(ctx, vocab, [{ rel: ingredientPath(slug), text }], `ingredient: add ${slug}`), slug };
	});
}

/** Retirer: take an ambiguous alias off one of the entries that share it. */
export function unlinkKey(ctx: VaultContext, key: string, slug: string, hash: string): Promise<{ commit?: string }> {
	return ctx.lock.run(async () => {
		const vocab = loadVocab(ctx.paths.vocab);
		const file = current(ctx, slug, hash);
		let text: string;
		try {
			text = withoutKey(file.text, key);
		} catch (e) {
			throw new QueueError(`${ingredientPath(slug)} ne se lit pas ; corrigez-le d’abord (${(e as IngredientEditError).message}).`);
		}
		if (text === file.text) throw new QueueError(`ce nom n’est plus un nom de ${slug} ; rechargez la page.`);
		checked(text, slug, vocab);
		const names = ctx.db.prepare('SELECT name FROM ingredient_names WHERE slug = ? AND key = ?').pluck().all(slug, key) as string[];
		return { commit: await commitEntries(ctx, vocab, [{ rel: ingredientPath(slug), text }], `ingredient: ${slug} - "${names[0] ?? key}"`) };
	});
}


export interface RuleInput {
	/** Canonical units or unit classes. */
	unit?: string[];
	/** Words or phrases of `prep` or `note`. */
	words?: string[];
	/** Only in recipes of the row's language. */
	sameLang?: boolean;
}

/**
 * Selon…: give an entry a disambiguation rule for the key's most frequent
 * written form, so the lines whose unit, words or language match resolve to it
 * (docs/INGREDIENTS.md, "Disambiguation rules"). The other lines stay in the
 * queue. `hash` as for `linkKey`.
 */
export function addRule(ctx: VaultContext, key: string, slug: string, input: RuleInput, hash?: string): Promise<{ commit?: string; resolved: number }> {
	return ctx.lock.run(async () => {
		const vocab = loadVocab(ctx.paths.vocab);
		const row = rowOf(ctx.db, key);
		if (!row) throw new QueueError('ce nom est déjà relié ; rechargez la page.');
		const known = new Set<string>([...UNITS, ...Object.keys(UNIT_CLASSES)]);
		const unit = [...new Set((input.unit ?? []).map((u) => u.trim()).filter(Boolean))];
		const bad = unit.filter((u) => !known.has(u));
		if (bad.length) throw new QueueError(`unité inconnue : ${bad.join(', ')}.`);
		const words = [...new Set((input.words ?? []).map((w) => w.replace(/\s+/g, ' ').trim()).filter(Boolean))];
		if (!unit.length && !words.length && !input.sameLang) throw new QueueError('choisissez au moins une condition : une unité, un mot ou la langue.');
		const form = row.forms[0].name;
		const rule: NameRule = { names: [form], ...(input.sameLang ? { lang: row.lang } : {}), ...(unit.length ? { unit } : {}), ...(words.length ? { words } : {}) };
		const file = current(ctx, slug, hash);
		let text: string;
		try {
			text = withRule(file.text, rule);
		} catch (e) {
			throw new QueueError(`${ingredientPath(slug)} ne se lit pas ; corrigez-le d’abord (${(e as IngredientEditError).message}).`);
		}
		if (text === file.text) throw new QueueError(`${slug} a déjà cette règle.`);
		checked(text, slug, vocab);
		const before = row.count;
		const cond = [rule.lang && `lang: ${rule.lang}`, unit.length && `unit: ${unit.join(', ')}`, words.length && `words: ${words.join(', ')}`].filter(Boolean).join('; ');
		const commit = await commitEntries(ctx, vocab, [{ rel: ingredientPath(slug), text }], `ingredient: ${slug} + rule "${form}" (${cond})`);
		return { commit, resolved: before - (rowOf(ctx.db, key)?.count ?? 0) };
	});
}
