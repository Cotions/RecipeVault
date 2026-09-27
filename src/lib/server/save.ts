// The one save path (docs/DATA-FLOW.md, "SAVE, in order"): check with the
// vault's entries → refuse on any error → set status/added/updated →
// serialize → write atomically → one git commit → index → push in background.
// Order matters: a failed write or commit is rolled back and indexes nothing;
// a failed index write leaves the file and commit in place for `vault sync`.

import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { checkBatch, checkFile, hasErrors } from '../vault/check';
import { stripMarkers } from '../vault/markers';
import { normalizeText } from '../vault/normalize';
import { serialize } from '../vault/serialize';
import type { Diagnostic, Recipe } from '../vault/types';
import type { VaultEntry } from '../vault/rules/batch';
import type { VaultContext } from './context';
import { commitPaths, unstage } from './git';
import { refreshFamilies, sha256 } from './index/build';
import { indexText, isRecipeFile, recipePath } from './index/sync';
import { loadVocab } from './vocab';

export interface SaveFile {
	/** One recipe file as pasted. */
	text: string;
	/** Save under this slug instead of the file's own (the suffixed slug offered on a collision). */
	slug?: string;
	/** Replace the vault recipe with this slug: the hash of the file the person saw (stale-write guard). */
	overwrite?: string;
	/** W608: make this recipe a member of a family (the existing one is untouched in P1). */
	family?: { family: string; variant: string };
}

export type FileResult =
	| { status: 'saved'; slug: string; title: string; recipeStatus: string; created: boolean; diagnostics: Diagnostic[] }
	| { status: 'rejected'; diagnostics: Diagnostic[] }
	| {
			status: 'collision';
			slug: string;
			/** The free suffixed slug to offer. */
			suggested: string;
			/** The recipe already there, absent when the clash is inside the paste or in the trash. */
			existing?: { title: string; hash: string };
			inTrash: boolean;
			diagnostics: Diagnostic[];
	  }
	| { status: 'stale'; slug: string; diagnostics: Diagnostic[] };

export interface SaveResult {
	files: FileResult[];
	commit?: string;
	/** The index write failed after the commit; the file is safe and `vault sync` recovers. */
	indexError?: string;
}

export class SaveError extends Error {}

export interface SaveOptions {
	/** For tests: the date written into `added` / `updated`. */
	today?: string;
}

/** Local date as YYYY-MM-DD. */
export const localDate = (d = new Date()) =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Set top-level frontmatter keys in a file's text, keeping the rest as written. */
export function setFrontmatter(text: string, changes: Record<string, string>): string {
	const lines = normalizeText(text).split('\n');
	if (lines[0]?.trimEnd() !== '---') return text;
	const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---');
	if (end === -1) return text;
	// Unresolved or self-referencing aliases throw on toString(): leave the text
	// as written, and the checker reports E002 for it.
	try {
		const doc = parseDocument(lines.slice(1, end).join('\n'), { version: '1.2' });
		if (doc.errors.length) return text;
		for (const [k, v] of Object.entries(changes)) doc.set(k, v);
		return ['---', doc.toString().replace(/\n$/, ''), ...lines.slice(end)].join('\n');
	} catch {
		return text;
	}
}

/** Slugs taken in the vault, with what batch rules need: live recipes, files that fail to parse, the trash. */
export function vaultEntries(ctx: VaultContext): { entries: VaultEntry[]; trash: Set<string> } {
	const { db } = ctx;
	const refs = new Map<string, string[]>();
	for (const r of db.prepare('SELECT slug, recipe FROM ingredients WHERE recipe IS NOT NULL').all() as { slug: string; recipe: string }[])
		refs.set(r.slug, [...(refs.get(r.slug) ?? []), r.recipe]);
	const entries: VaultEntry[] = (db.prepare('SELECT slug, title FROM recipes').all() as { slug: string; title: string }[]).map((r) => ({
		slug: r.slug,
		title: r.title,
		refs: refs.get(r.slug) ?? []
	}));
	const known = new Set(entries.map((e) => e.slug));
	for (const slug of db.prepare('SELECT slug FROM problems WHERE slug IS NOT NULL').pluck().all() as string[])
		if (!known.has(slug)) entries.push({ slug, refs: [] });
	const trash = new Set(
		existsSync(ctx.paths.trash) ? readdirSync(ctx.paths.trash).filter(isRecipeFile).map((f) => f.slice(0, -3)) : []
	);
	for (const slug of trash) if (!known.has(slug)) entries.push({ slug, refs: [] });
	return { entries, trash };
}

/** The file currently in the vault for a slug: text and hash, or undefined. */
export function currentFile(ctx: VaultContext, slug: string): { text: string; hash: string } | undefined {
	const abs = join(ctx.paths.root, recipePath(slug));
	if (!existsSync(abs)) return undefined;
	const buf = readFileSync(abs);
	return { text: buf.toString('utf8'), hash: sha256(buf) };
}

/** `needs-review` while an uncertain marker remains (W605), else `draft`. Never `verified` on its own. */
export function statusFor(recipe: Recipe): 'needs-review' | 'draft' {
	return recipe.markers.some((m) => m.kind !== 'added') ? 'needs-review' : 'draft';
}

interface Ready {
	slug: string;
	title: string;
	text: string;
	created: boolean;
	verb: string;
}

const plainTitle = (t: string) => stripMarkers(t);

function commitMessage(ready: Ready[]): string {
	const lines = ready.map((r) => `${r.verb}: ${plainTitle(r.title)}`);
	if (lines.length === 1) return lines[0];
	const joined = lines.join('; ');
	return joined.length <= 72 ? joined : `save: ${ready.length} recipes\n\n${lines.join('\n')}`;
}

/**
 * Write the files, commit them together, index them, push in the background.
 * Caller holds the lock. A failed write or commit puts every file back as it
 * was (removed if new) and throws: a file the app wrote but git never
 * recorded would be ignored by the watcher and never committed.
 */
async function writeCommitIndex(ctx: VaultContext, ready: Ready[], message = commitMessage(ready)): Promise<{ commit?: string; indexError?: string }> {
	const paths = ready.map((r) => recipePath(r.slug));
	const written: { rel: string; abs: string; previous?: Buffer }[] = [];
	const rollback = async () => {
		for (const w of written.reverse()) {
			ctx.ownWrites.delete(w.rel);
			try {
				if (w.previous) writeFileSync(w.abs, w.previous);
				else rmSync(w.abs, { force: true });
			} catch (e) {
				ctx.log(`recipevault: could not put ${w.rel} back: ${(e as Error).message}`);
			}
		}
		await unstage(ctx.paths.root, paths);
	};
	const plural = ready.length > 1;
	try {
		for (const r of ready) {
			const rel = recipePath(r.slug);
			const abs = join(ctx.paths.root, rel);
			const tmp = join(ctx.paths.recipes, `.${r.slug}.md.${process.pid}.tmp`);
			const previous = existsSync(abs) ? readFileSync(abs) : undefined;
			try {
				writeFileSync(tmp, r.text);
				ctx.ownWrites.set(rel, sha256(r.text));
				renameSync(tmp, abs);
			} catch (e) {
				ctx.ownWrites.delete(rel);
				rmSync(tmp, { force: true });
				throw e;
			}
			written.push({ rel, abs, previous });
		}
	} catch (e) {
		await rollback();
		throw new SaveError(`could not write the file${plural ? 's' : ''}, nothing was saved: ${(e as Error).message}`);
	}
	let commit: string | undefined;
	try {
		commit = await commitPaths(ctx.paths.root, paths, message, ctx.author);
	} catch (e) {
		await rollback();
		throw new SaveError(`the git commit failed, nothing was saved: ${(e as Error).message}`);
	}
	let indexError: string | undefined;
	try {
		if (ctx.faults?.index) throw new Error('index write failed (injected)');
		const vocab = loadVocab(ctx.paths.vocab);
		ctx.db.transaction(() => {
			for (const r of ready) indexText(ctx.db, vocab, recipePath(r.slug), r.text);
			refreshFamilies(ctx.db, vocab);
		})();
	} catch (e) {
		indexError = (e as Error).message;
		ctx.log(`recipevault: index update failed after commit (vault sync will recover): ${indexError}`);
	}
	ctx.pusher.schedule();
	return { commit, indexError };
}

/** The first free `<slug>-N`. */
function suffixed(slug: string, taken: Set<string>): string {
	let n = 2;
	while (taken.has(`${slug}-${n}`)) n++;
	return `${slug}-${n}`;
}

/**
 * Save pasted files. Every file that passes and has no unresolved collision is
 * saved, all in one commit; the others come back with their diagnostics, a
 * collision to resolve (`overwrite` or `slug`), or a stale-write refusal.
 */
export function save(ctx: VaultContext, files: SaveFile[], opts: SaveOptions = {}): Promise<SaveResult> {
	return ctx.lock.run(() => saveLocked(ctx, files, opts));
}

async function saveLocked(ctx: VaultContext, files: SaveFile[], opts: SaveOptions): Promise<SaveResult> {
	const today = opts.today ?? localDate();
	const texts = files.map((f) => {
		const changes: Record<string, string> = {};
		if (f.slug) changes.slug = f.slug;
		if (f.family) Object.assign(changes, f.family);
		return Object.keys(changes).length ? setFrontmatter(f.text, changes) : normalizeText(f.text);
	});
	const { entries, trash } = vaultEntries(ctx);
	const overwriting = new Set(files.map((f, i) => (f.overwrite !== undefined ? fileSlugOf(texts[i]) : undefined)).filter(Boolean));
	const checked = checkBatch(
		texts.map((text, i) => ({ name: `recipe ${i + 1}`, text })),
		{ vault: entries.filter((e) => !overwriting.has(e.slug) || trash.has(e.slug)) }
	);
	const taken = new Set([...entries.map((e) => e.slug), ...checked.files.map((f) => f.recipe?.slug ?? '')]);

	const results: FileResult[] = [];
	const ready: Ready[] = [];
	const claimed = new Set<string>();
	checked.files.forEach((f, i) => {
		const diagnostics = f.diagnostics;
		const errors = diagnostics.filter((d) => d.severity === 'error');
		const collision = errors.find((d) => d.code === 'E103');
		const other = errors.filter((d) => d.code !== 'E103');
		const slug = fileSlugOf(texts[i]);
		if (other.length || !slug) {
			results.push({ status: 'rejected', diagnostics });
			return;
		}
		// Two files with one slug in the same paste, neither in the vault: the
		// first takes the slug, only the later ones wait for a choice.
		const batchOnly = collision && !entries.some((e) => e.slug === slug) && !claimed.has(slug);
		if (collision && !batchOnly) {
			const cur = currentFile(ctx, slug);
			const existing = cur ? { title: entries.find((e) => e.slug === slug)?.title ?? slug, hash: cur.hash } : undefined;
			results.push({ status: 'collision', slug, suggested: suffixed(slug, taken), existing, inTrash: trash.has(slug), diagnostics });
			return;
		}
		const file = checkFile(texts[i]);
		const recipe = file.recipe!;
		const cur = currentFile(ctx, slug);
		if (cur && files[i].overwrite === undefined) {
			// A file on disk the index did not know (written while the app ran, not yet synced).
			results.push({ status: 'collision', slug, suggested: suffixed(slug, taken), existing: { title: slug, hash: cur.hash }, inTrash: false, diagnostics });
			return;
		}
		if (files[i].overwrite !== undefined && cur?.hash !== files[i].overwrite) {
			results.push({ status: 'stale', slug, diagnostics });
			return;
		}
		claimed.add(slug);
		const previous = cur ? checkFile(cur.text).recipe : undefined;
		const final: Recipe = {
			...recipe,
			slug,
			status: statusFor(recipe),
			added: previous?.added ?? today,
			updated: today,
			extractedBy: recipe.extractedBy ?? 'hand'
		};
		ready.push({ slug, title: recipe.title, text: serialize(final, file.body!), created: !cur, verb: cur ? 'edit' : 'add' });
		results.push({ status: 'saved', slug, title: recipe.title, recipeStatus: final.status!, created: !cur, diagnostics });
	});
	if (!ready.length) return { files: results };
	const { commit, indexError } = await writeCommitIndex(ctx, ready);
	return { files: results, commit, indexError };
}

function fileSlugOf(text: string): string | undefined {
	const r = checkFile(text);
	if (r.recipe) return r.recipe.slug;
	const s = r.frontmatter?.slug;
	return typeof s === 'string' ? s : undefined;
}

export class VerifyError extends Error {}

/**
 * The "Vérifié" button: a one-field edit through the same path — stale-write
 * guard, serialize, commit `verify: <title>`, index. Refused while an
 * uncertain marker remains: those need a person to settle them first.
 */
export function verify(ctx: VaultContext, slug: string, hash: string, opts: SaveOptions = {}): Promise<{ commit?: string }> {
	return ctx.lock.run(async () => {
		const cur = currentFile(ctx, slug);
		if (!cur) throw new VerifyError('cette recette n’existe plus.');
		if (cur.hash !== hash) throw new VerifyError('le fichier a changé depuis l’ouverture de la page ; rechargez-la.');
		const file = checkFile(cur.text);
		if (!file.recipe || hasErrors(file.diagnostics)) throw new VerifyError('le fichier ne passe pas la validation.');
		if (statusFor(file.recipe) === 'needs-review') throw new VerifyError('des marqueurs [?] ou [illisible] restent à régler.');
		const final: Recipe = { ...file.recipe, status: 'verified', updated: opts.today ?? localDate() };
		const ready: Ready = { slug, title: final.title, text: serialize(final, file.body!), created: false, verb: 'verify' };
		return writeCommitIndex(ctx, [ready]);
	});
}
