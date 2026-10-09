// The form's entry into the one save path (plan 04, Phase 3). The form is not
// a second writer: `fromForm` → `serialize` → `saveLocked`, exactly as a
// paste of the same text would be saved (docs/DATA-FLOW.md, "Two inputs, one
// save path"). What this adds around it:
//
// - a new recipe's slug from its title, taking the first free `-N` when the
//   slug is used, in the trash or on disk (E103 never reaches her);
// - an edit keeps its slug whatever the title becomes, is hash-guarded, and
//   keeps its status (Q14 A); a stale hash comes back with the other version
//   as a form, for the side-by-side choice (Q18 A); an unchanged form writes
//   nothing;
// - a new family's French label written to vocab/families.yaml, and the other
//   recipe of a same-title pair put in the family, in the recipe's commit
//   (Q10 A);
// - the vault warnings mapped to form fields, as plain hints (Q9 A);
// - the checker's errors mapped to form fields too (`checkerBlocks`): the same
//   Save gate as the browser's (`blocks`) is run before anything is written,
//   and an error only the vault check finds (E213) comes back on its field.
//   An error the form's own rules did not state first is a gap in the form:
//   logged with its code; she sees the field named, never the code.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkBatch, checkFile, hasErrors } from '../vault/check';
import { bodyText } from '../vault/parse';
import { stripMarkers } from '../vault/markers';
import { fold, withinDistance } from '../vault/normalize';
import { normTitle } from '../vault/rules/batch';
import { serialize } from '../vault/serialize';
import { isSlug, slugify } from '../vault/slug';
import type { Diagnostic, Recipe } from '../vault/types';
import { suggestTag } from '../vault/rules/vaultvocab';
import { fromForm, toForm, type FormError, type FormRecipe } from '../form/model';
import { checkerBlocks, formFile } from '../form/check';
import { blocks, type Block } from '../form/rows';
import type { FormHint } from '../form/hints';
import type { VaultStats } from '../form/defaults';
import { lookupKey } from '../ingredients/normalize';
import { checkOptions } from './checkopts';
import type { VaultContext } from './context';
import { closeRecipes, duplicateWarnings, type CloseRecipe } from './duplicates';
import { cleanLabel, familiesFile, FAMILIES_FILE, LABEL_MAX, withLabel } from './families';
import type { FileWrite } from './files';
import { indexMemo } from './index/memo';
import { getResolver, toTasteWarnings, unresolvedDiagnostics } from './index/resolve';
import { recipePath } from './index/sync';
import { currentFile, localDate, pairEdit, saveLocked, SaveError, vaultEntries, type PairRequest, type SaveOptions } from './save';
import { loadVocab } from './vocab';

export interface FormBase {
	/** The recipe the form was opened from. */
	slug: string;
	/** Hash of its file when the form was opened (the stale-write guard). */
	hash: string;
}

/** W608 "mettre en famille" (Q10 A): the other recipe of the pair joins the family too. */
export type FormPair = PairRequest;

export interface FormSaveRequest {
	form: FormRecipe;
	base?: FormBase;
	/** The family is new: its French label, as she typed it (Q10 A). */
	familyLabel?: string;
	pair?: FormPair;
}

export type FormSaveResult =
	| { status: 'saved'; slug: string; title: string; created: boolean; commit?: string; hash: string; hints: FormHint[]; indexError?: string }
	/** Nothing changed: nothing written, no commit (the round-trip promise). */
	| { status: 'unchanged'; slug: string; hash: string }
	/** The file changed since the form opened (Q18 A): the other version, to show beside hers. */
	| { status: 'stale'; slug: string; theirs: { form: FormRecipe; hash: string } | null }
	/** The recipe is gone (deleted since), or its file has errors the form cannot open (Q3 A). */
	| { status: 'refused'; reason: 'gone' | 'broken' | 'pair' }
	/** Values the file format cannot hold, each on its row and field (the `blocks` shape: `code` when the checker found it). */
	| { status: 'invalid'; errors: FormError[] }
	/** The save could not run, or the checker refused something no field holds: logged; she sees one plain sentence. */
	| { status: 'failed' };

export interface FormSaveOptions extends SaveOptions {}

/** The recipe the form writes: the app's fields left for the save path to set (the form's text never holds `status` or `added`). */
const formRecipe = (form: FormRecipe, slug: string) => formFile(form, slug);

/** Blocks the form's own rules did not state (the checker's net): each a gap in the form, logged with its code. */
function logGaps(ctx: VaultContext, slug: string, errors: FormError[]): void {
	const gaps = errors.filter((e) => e.code);
	if (gaps.length) ctx.log(`recipevault: form refused by the checker for ${slug}: ${gaps.map((e) => `${e.code} ${e.id}.${e.field}`).join(', ')}`);
}

/** The first free slug for a title: `<slug>`, else `<slug>-2`, … (a slug in the trash is never reused). */
export function freeSlug(ctx: VaultContext, title: string): string {
	const base = slugify(title) || 'recette';
	const { entries } = vaultEntries(ctx);
	const taken = new Set(entries.map((e) => e.slug));
	const free = (s: string) => !taken.has(s) && !existsSync(join(ctx.paths.root, recipePath(s)));
	if (free(base)) return base;
	let n = 2;
	while (!free(`${base}-${n}`)) n++;
	return `${base}-${n}`;
}

/** The form for a vault recipe, or why the form may not open it (Q3 A: only a file that passes the checker). */
export function openForm(ctx: VaultContext, slug: string): { form: FormRecipe; hash: string } | { refused: 'gone' | 'broken' } {
	const cur = currentFile(ctx, slug);
	if (!cur) return { refused: 'gone' };
	const file = checkFile(cur.text);
	if (!file.recipe || !file.body || hasErrors(file.diagnostics)) return { refused: 'broken' };
	return { form: toForm(file.recipe, file.body), hash: cur.hash };
}

export function formSave(ctx: VaultContext, req: FormSaveRequest, opts: FormSaveOptions = {}): Promise<FormSaveResult> {
	return ctx.lock.run(() => formSaveLocked(ctx, req, opts));
}

async function formSaveLocked(ctx: VaultContext, req: FormSaveRequest, opts: FormSaveOptions): Promise<FormSaveResult> {
	const { form, base } = req;
	let slug: string;
	let cur: { text: string; hash: string } | undefined;
	if (base) {
		cur = currentFile(ctx, base.slug);
		if (!cur) return { status: 'refused', reason: 'gone' };
		if (cur.hash !== base.hash) {
			const theirs = openForm(ctx, base.slug);
			return { status: 'stale', slug: base.slug, theirs: 'form' in theirs ? theirs : null };
		}
		slug = base.slug;
	} else {
		slug = freeSlug(ctx, form.title);
	}

	// The browser's Save gate, run again before anything is written.
	const problems = blocks(form);
	if (problems.length) {
		logGaps(ctx, slug, problems);
		return { status: 'invalid', errors: problems };
	}
	const { recipe, body, text, ids } = formRecipe(form, slug);

	if (cur) {
		const file = checkFile(cur.text);
		if (!file.recipe || !file.body || hasErrors(file.diagnostics)) return { status: 'refused', reason: 'broken' };
		// Unchanged: what the form describes, with the file's own app fields, is the file as the app would write it.
		const { recipe: same } = fromForm(form);
		if (serialize({ ...same, slug }, body) === serialize(file.recipe, file.body)) return { status: 'unchanged', slug, hash: cur.hash };
	}

	const extra: NonNullable<SaveOptions['extra']> = {};
	const files: FileWrite[] = [];
	if (recipe.family && req.familyLabel !== undefined) {
		const label = cleanLabel(req.familyLabel).slice(0, LABEL_MAX);
		const fam = familiesFile(ctx);
		const known = loadVocab(ctx.paths.vocab).families.get(recipe.family);
		// A label is written only where there is none: nothing she did not see is overwritten, so the families file needs no hash from her.
		if (label && !known?.fr) {
			try {
				const next = withLabel(fam.text, recipe.family, label);
				if (next !== fam.text) files.push({ rel: FAMILIES_FILE, text: next });
			} catch (e) {
				ctx.log(`recipevault: family label not written (${FAMILIES_FILE}): ${(e as Error).message}`);
			}
		}
	}
	if (files.length) extra.files = files;
	if (req.pair && recipe.family) {
		const pair = pairEdit(ctx, req.pair, recipe.family, opts.today ?? localDate());
		if ('refused' in pair) return { status: 'refused', reason: 'pair' };
		if (!pair.unchanged) extra.recipes = [{ slug: pair.slug, title: pair.title, text: pair.text }];
	}

	let result;
	try {
		result = await saveLocked(ctx, [{ text, overwrite: cur?.hash, keepStatus: !!cur }], { ...opts, extra });
	} catch (e) {
		if (e instanceof SaveError) ctx.log(`recipevault: form save failed for ${slug}: ${e.message}`);
		throw e;
	}
	const r = result.files[0];
	if (r.status === 'saved') {
		const saved = currentFile(ctx, r.slug)!;
		return {
			status: 'saved',
			slug: r.slug,
			title: r.title,
			created: r.created,
			commit: result.commit,
			hash: saved.hash,
			hints: hintsFrom(ctx, r.diagnostics, ids, recipe, undefined, r.diagnostics.some((d) => d.code === 'W505') ? closeRecipes(ctx, recipe, recipe.slug, { body: bodyText(text) }) : undefined),
			...(result.indexError ? { indexError: result.indexError } : {})
		};
	}
	if (r.status === 'stale') {
		const theirs = openForm(ctx, slug);
		return { status: 'stale', slug, theirs: 'form' in theirs ? theirs : null };
	}
	// A collision cannot happen (the slug was free, under the lock). A rejection is an error only the vault
	// check finds (E213), or a gap in the form: on its field when it has one.
	ctx.log(`recipevault: form save refused by the checker for ${slug} (${r.status}): ${r.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.path ?? ''}`).join(', ')}`);
	const errors = checkerBlocks(r.diagnostics, ids);
	return errors.length ? { status: 'invalid', errors } : { status: 'failed' };
}

// ---------------------------------------------------------------------------
// Hints (Q9 A): the vault's warnings, mapped to the form's fields.

/** Vault recipes with the same or a near-identical title (W608 / W503), this one left out. */
export function titleMatches(ctx: VaultContext, title: string, own?: string): { same: { slug: string; title: string; hash: string; family: string | null }[]; near: { slug: string; title: string }[] } {
	const t = normTitle(title);
	const same: { slug: string; title: string; hash: string; family: string | null }[] = [];
	const near: { slug: string; title: string }[] = [];
	if (!t) return { same, near };
	const rows = indexMemo(ctx.db, 'titleMatches', () =>
		(ctx.db.prepare('SELECT slug, title, family, file_hash FROM recipes').all() as { slug: string; title: string; family: string | null; file_hash: string }[]).map((r) => ({
			...r,
			norm: normTitle(r.title)
		}))
	);
	for (const r of rows) {
		if (r.slug === own) continue;
		const u = r.norm;
		if (u === t) same.push({ slug: r.slug, title: stripMarkers(r.title), hash: r.file_hash, family: r.family });
		else if (withinDistance(t, u, 2)) near.push({ slug: r.slug, title: stripMarkers(r.title) });
	}
	return { same, near };
}

/** The row a diagnostic path points at: the item (or `or` entry) id, the group id, or `recipe`. */
function targetOf(path: string | null, ids: Record<string, string>): string {
	if (!path) return 'recipe';
	const m = path.match(/^ingredients\[\d+\](?:\.items\[\d+\](?:\.or\[\d+\])?)?/);
	if (!m) return 'recipe';
	return ids[m[0]] ?? ids[m[0].replace(/\.or\[\d+\]$/, '')] ?? 'recipe';
}

/**
 * Warnings from the vault check as hints on form fields. The name-word
 * warnings (W302 / W304 / W607) are computed live in the browser from the same
 * word lists and left out here; errors never become hints.
 */
export function hintsFrom(
	ctx: VaultContext,
	diagnostics: Diagnostic[],
	ids: Record<string, string>,
	recipe: Recipe,
	matches?: ReturnType<typeof titleMatches>,
	close?: CloseRecipe[]
): FormHint[] {
	const out: FormHint[] = [];
	const vocab = loadVocab(ctx.paths.vocab);
	const seen = new Set<string>();
	for (const d of diagnostics) {
		if (d.severity === 'error') continue;
		const key = `${d.code} ${d.path}`;
		if (seen.has(key)) continue;
		seen.add(key);
		switch (d.code) {
			case 'W501': {
				const i = Number(d.path?.match(/^tags\[(\d+)\]/)?.[1]);
				const tag = recipe.tags[i];
				if (tag === undefined) break;
				const near = suggestTag(vocab.tags, tag);
				out.push({ code: 'W501', target: 'recipe', field: 'tags', value: tag, ...(near ? { suggestion: near } : {}) });
				break;
			}
			case 'W502': {
				const near = (d.fix?.match(/`family: ([a-z0-9-]+)`/) ?? [])[1];
				out.push({ code: 'W502', target: 'recipe', field: 'family', value: recipe.family ?? '', ...(near ? { suggestion: near, label: vocab.families.get(near)?.fr ?? undefined } : {}) });
				break;
			}
			case 'W503':
			case 'W608': {
				const m = (matches ??= titleMatches(ctx, recipe.title, recipe.slug));
				const list = d.code === 'W608' ? m.same : m.near;
				for (const r of list) out.push({ code: d.code, target: 'recipe', field: 'title', value: r.title, slug: r.slug });
				break;
			}
			case 'W505':
				for (const r of (close ??= closeRecipes(ctx, recipe, recipe.slug))) out.push({ code: 'W505', target: 'recipe', field: 'ingredients', value: r.title, slug: r.slug });
				break;
			case 'W303':
			case 'W305':
			case 'W306':
				out.push({ code: d.code, target: targetOf(d.path, ids), field: d.code === 'W306' ? 'recipe' : 'name' });
				break;
			case 'W605':
				out.push({ code: 'W605', target: 'recipe', field: 'markers' });
				break;
		}
	}
	return out.filter((h, i) => out.findIndex((o) => o.code === h.code && o.target === h.target && o.value === h.value && o.slug === h.slug) === i);
}

/**
 * The vault hints for a form not yet saved (the live check while she types,
 * Q9 A): the same check the save runs, nothing written. A W608 comes with the
 * other recipe's hash, for "mettre en famille" (Q10 A); so does a W505
 * (`close`: nearly the same ingredients, plan 05 Phase 6), for "En faire deux
 * versions". `errors`: the
 * vault check's errors on their fields (`blocks` shape), the ones the
 * browser's own check cannot see (E213) included; a new recipe's E103 is not
 * hers (its slug is chosen free on save).
 */
export function formCheck(
	ctx: VaultContext,
	form: FormRecipe,
	base?: FormBase
): { hints: FormHint[]; errors: Block[]; same: { slug: string; title: string; hash: string; family: string | null }[]; close: CloseRecipe[] } {
	const slug = base?.slug ?? (slugify(form.title) || 'recette');
	const { recipe, text, ids } = formRecipe(form, slug);
	const { entries } = vaultEntries(ctx);
	const checked = checkBatch([{ name: 'recipe 1', text }], {
		// An edit is checked as a replacement of itself; a new recipe's slug is chosen free on save, so E103 is not hers.
		vault: entries.filter((e) => e.slug !== slug),
		...checkOptions(ctx)
	});
	const f = checked.files[0];
	const diagnostics = [...f.diagnostics];
	// An edit is never its own duplicate; a new recipe's slug is in no row.
	const close = f.recipe ? closeRecipes(ctx, f.recipe, base?.slug, { body: bodyText(text) }) : [];
	if (f.recipe)
		diagnostics.push(...unresolvedDiagnostics(ctx.db, ctx.paths.vocab, f.recipe), ...toTasteWarnings(ctx.db, ctx.paths.vocab, f.recipe), ...duplicateWarnings(close));
	// One title walk for the hints and `same` (the recipe's slug is base.slug on an edit; a new recipe's is in no row).
	const matches = titleMatches(ctx, recipe.title, base?.slug);
	return {
		hints: hintsFrom(ctx, diagnostics, ids, recipe, matches, close),
		errors: checkerBlocks(f.diagnostics.filter((d) => d.code !== 'E103'), ids),
		same: matches.same,
		close
	};
}

// ---------------------------------------------------------------------------
// Suggestions for the form's pickers (api/suggest)

export interface NameSuggestion {
	name: string;
	/** Resolves to a registry entry (the "relié" mark, Q8 A). */
	linked: boolean;
}

/**
 * Ingredient names for the name field (Q8 A): the registry's names in the
 * recipe's language and the names written in the vault, most used first;
 * matching on folded words, a prefix match before a match inside.
 */
export function suggestNames(ctx: VaultContext, q: string, lang: string, limit = 8): NameSuggestion[] {
	const key = fold(q).trim();
	if (!key) return [];
	const counts = new Map<string, { name: string; n: number }>();
	const add = (name: string, n: number) => {
		const k = fold(name);
		const e = counts.get(k);
		if (e) e.n += n;
		else counts.set(k, { name, n });
	};
	const like = `%${key.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
	for (const r of ctx.db.prepare(`SELECT name, count(*) AS n FROM ingredients WHERE key LIKE ? ESCAPE '\\' GROUP BY key ORDER BY n DESC LIMIT 200`).all(like) as { name: string; n: number }[])
		add(stripMarkers(r.name).trim(), r.n);
	for (const r of ctx.db.prepare(`SELECT name FROM ingredient_names WHERE lang = ? AND key LIKE ? ESCAPE '\\' LIMIT 200`).all(lang, like) as { name: string }[]) add(r.name, 0);
	const resolver = getResolver(ctx.db, () => loadVocab(ctx.paths.vocab));
	return [...counts.entries()]
		.filter(([k]) => k.includes(key))
		.sort(([a, x], [b, y]) => Number(b.startsWith(key)) - Number(a.startsWith(key)) || y.n - x.n || a.localeCompare(b))
		.slice(0, limit)
		.map(([, v]) => ({ name: v.name, linked: nameLinked(resolver, v.name, lang) }));
}

function nameLinked(resolver: ReturnType<typeof getResolver>, name: string, lang: string): boolean {
	const r = resolver.resolveKey(lookupKey(name), lang);
	return !!r.item;
}

/** Whether a typed name resolves (the "relié" mark beside a name she typed). */
export function nameResolves(ctx: VaultContext, name: string, lang: string): boolean {
	if (!name.trim()) return false;
	return nameLinked(getResolver(ctx.db, () => loadVocab(ctx.paths.vocab)), name, lang);
}

export interface FamilySuggestion {
	slug: string;
	label: string | null;
	count: number;
}

/** Every family: in vocab/families.yaml or used by a recipe, with its label and how many recipes it has. */
export function allFamilies(ctx: VaultContext): FamilySuggestion[] {
	const vocab = loadVocab(ctx.paths.vocab);
	const counts = new Map((ctx.db.prepare('SELECT family, count(*) AS n FROM recipes WHERE family IS NOT NULL GROUP BY family').all() as { family: string; n: number }[]).map((r) => [r.family, r.n]));
	const slugs = new Set([...vocab.families.keys(), ...counts.keys()]);
	return [...slugs]
		.map((slug) => ({ slug, label: vocab.families.get(slug)?.fr ?? null, count: counts.get(slug) ?? 0 }))
		.sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
}

/**
 * Authors already in the vault, most used first (the source author field).
 * One suggestion per author however her recipes write it (« Tante Irène [?] »,
 * « tante irène »): counted together, shown as most written.
 */
export function suggestAuthors(ctx: VaultContext, q: string, limit = 8): string[] {
	const key = fold(q).trim();
	const rows = ctx.db.prepare('SELECT author, count(*) AS n FROM recipes WHERE author IS NOT NULL GROUP BY author ORDER BY n DESC, author').all() as { author: string; n: number }[];
	const authors = new Map<string, { name: string; n: number }>();
	for (const r of rows) {
		const name = stripMarkers(r.author).trim();
		if (!name) continue;
		const e = authors.get(fold(name));
		if (e) e.n += r.n;
		else authors.set(fold(name), { name, n: r.n });
	}
	return [...authors.entries()]
		.filter(([k]) => !key || k.includes(key))
		.sort(([a, x], [b, y]) => y.n - x.n || a.localeCompare(b))
		.slice(0, limit)
		.map(([, v]) => v.name);
}

export interface RecipeSuggestion {
	slug: string;
	title: string;
}

/**
 * Recipes the sub-recipe picker may offer (E213): never the recipe itself,
 * nor one that uses it, directly or through other recipes.
 */
export function subRecipeCandidates(ctx: VaultContext, q: string, own?: string, limit = 10): RecipeSuggestion[] {
	const excluded = own ? usersOf(ctx, own) : new Set<string>();
	if (own) excluded.add(own);
	const key = fold(q).trim();
	const slugKey = slugify(q);
	const rows = indexMemo(ctx.db, 'subRecipeCandidates', () => ctx.db.prepare('SELECT slug, title, title_sort FROM recipes ORDER BY title_sort').all() as { slug: string; title: string; title_sort: string }[]);
	return rows
		.filter((r) => !excluded.has(r.slug) && (!key || r.title_sort.includes(key) || r.slug.includes(slugKey)))
		.sort((a, b) => Number(b.title_sort.startsWith(key)) - Number(a.title_sort.startsWith(key)))
		.slice(0, limit)
		.map((r) => ({ slug: r.slug, title: stripMarkers(r.title) }));
}

/** Every recipe that uses `slug` as a sub-recipe, directly or through others. */
export function usersOf(ctx: VaultContext, slug: string): Set<string> {
	// Who uses whom, from the index: built once per index state, not per keystroke.
	const parents = indexMemo(ctx.db, 'usersOf', () => {
		const map = new Map<string, string[]>();
		const rows = ctx.db
			.prepare('SELECT slug, recipe FROM ingredients WHERE recipe IS NOT NULL UNION SELECT slug, recipe FROM ingredient_or WHERE recipe IS NOT NULL')
			.all() as { slug: string; recipe: string }[];
		for (const r of rows) {
			const list = map.get(r.recipe);
			if (list) list.push(r.slug);
			else map.set(r.recipe, [r.slug]);
		}
		return map;
	});
	const out = new Set<string>();
	const queue = [slug];
	while (queue.length) {
		for (const p of parents.get(queue.shift()!) ?? []) {
			if (out.has(p) || p === slug) continue;
			out.add(p);
			queue.push(p);
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Vault stats for the form's defaults (plan 04, decision 1; Phase 2.7)

const statsCache = new WeakMap<object, { sig: number; stats: VaultStats }>();

/**
 * Units, oven units and languages as the vault uses them, from the index.
 * Cached until the index changes (`total_changes()` of the index connection
 * counts every write the app, the watcher and a sync make through it).
 */
export function vaultStats(ctx: VaultContext): VaultStats {
	const sig = ctx.db.prepare('SELECT total_changes()').pluck().get() as number;
	const hit = statsCache.get(ctx.db);
	if (hit && hit.sig === sig) return hit.stats;
	const stats: VaultStats = { units: {}, ovenUnits: {}, langs: {} };
	for (const r of ctx.db.prepare('SELECT unit, count(*) AS n FROM ingredients WHERE unit IS NOT NULL GROUP BY unit').all() as { unit: string; n: number }[])
		(stats.units as Record<string, number>)[r.unit] = r.n;
	for (const r of ctx.db.prepare("SELECT json_extract(data_json, '$.oven.unit') AS u, count(*) AS n FROM recipes WHERE u IS NOT NULL GROUP BY u").all() as { u: string; n: number }[])
		if (r.u === 'F' || r.u === 'C') stats.ovenUnits[r.u] = r.n;
	for (const r of ctx.db.prepare('SELECT lang, count(*) AS n FROM recipes GROUP BY lang').all() as { lang: string; n: number }[])
		if (r.lang === 'fr' || r.lang === 'en') stats.langs[r.lang] = r.n;
	statsCache.set(ctx.db, { sig, stats });
	return stats;
}
