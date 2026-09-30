// Server side of the paste box: checks with the vault's context, saves, logs.

import { checkBatch, checkFile } from '../vault/check';
import { fileSlug } from '../vault/rules/batch';
import type { Diagnostic } from '../vault/types';
import type { App } from './app';
import type { GitAuthor } from './config';
import { withAuthor } from './context';
import { titles } from './index/query';
import { toTasteWarnings, unresolvedDiagnostics } from './index/resolve';
import { checkOptions } from './checkopts';
import { closeRecipes, duplicateWarnings, type CloseRecipe } from './duplicates';
import { referencedSlugs } from './pages';
import { currentFile, save, vaultEntries, type SaveFile, type SaveResult } from './save';

export interface ServerCheckFile {
	diagnostics: Diagnostic[];
	slug?: string;
	/** Set when the slug is taken: what the person can choose. */
	collision?: { suggested: string; existing?: { title: string; hash: string }; inTrash: boolean };
	/** Titles of the recipes this file links to that exist in the vault. */
	titles: Record<string, string>;
	/** W505: vault recipes with nearly the same ingredients (plan 05, Phase 6), to link and to offer "Mettre en famille". */
	close?: CloseRecipe[];
}

/** Slug a file would be saved under, when its frontmatter reads at all. */
export function slugOf(text: string): string | undefined {
	const fm = checkFile(text).frontmatter;
	return fm ? fileSlug(fm) : undefined;
}

export function serverCheck(app: App, texts: string[]): ServerCheckFile[] {
	const { entries, trash } = vaultEntries(app.ctx);
	const result = checkBatch(
		texts.map((text, i) => ({ name: `recipe ${i + 1}`, text })),
		{ vault: entries, ...checkOptions(app.ctx) }
	);
	const taken = new Set([...entries.map((e) => e.slug), ...texts.map(slugOf).filter((s): s is string => !!s)]);
	return result.files.map((f, i) => {
		const slug = slugOf(texts[i]);
		const out: ServerCheckFile = { diagnostics: f.diagnostics, slug, titles: {} };
		if (f.recipe) {
			out.titles = Object.fromEntries(titles(app.ctx.db, referencedSlugs(f.recipe, '')));
			// A file is never its own duplicate.
			const close = closeRecipes(app.ctx, f.recipe, slug);
			if (close.length) out.close = close;
			out.diagnostics = [
				...f.diagnostics,
				...unresolvedDiagnostics(app.ctx.db, app.ctx.paths.vocab, f.recipe),
				...toTasteWarnings(app.ctx.db, app.ctx.paths.vocab, f.recipe),
				...duplicateWarnings(close)
			];
		}
		if (!f.recipe && slug && f.diagnostics.every((d) => d.severity !== 'error' || d.code === 'E103')) {
			// Its slug taken (E103, its only error): it may yet be saved under
			// another slug ("Enregistrer comme"), so the close recipes are those of
			// a new file — the recipe there left out (the collision names it), and
			// its settled pairs not applied. Only `close`, which the box shows
			// unless she picks "Remplacer"; no W505 line, which would show either way.
			const recipe = checkFile(texts[i]).recipe;
			const close = recipe ? closeRecipes(app.ctx, recipe, undefined, { exclude: slug }) : [];
			if (close.length) out.close = close;
		}
		if (slug && f.diagnostics.some((d) => d.code === 'E103')) {
			let n = 2;
			while (taken.has(`${slug}-${n}`)) n++;
			const cur = currentFile(app.ctx, slug);
			const title = entries.find((e) => e.slug === slug)?.title;
			out.collision = {
				suggested: `${slug}-${n}`,
				existing: cur ? { title: title ?? slug, hash: cur.hash } : undefined,
				inTrash: trash.has(slug)
			};
		}
		return out;
	});
}

/** A file of the same attempt that stayed in the box: its codes only, never its content. */
export interface Unsent {
	codes: string[];
	slug?: string;
}

/**
 * Save, then append one paste-log line for the attempt (docs/DATA-FLOW.md):
 * the saved files, plus the ones that stayed in the box as 'rejected'.
 * The commit is `author`'s (the signed-in person), else the config's.
 */
export async function savePaste(app: App, files: SaveFile[], unsent: Unsent[] = [], author?: GitAuthor): Promise<SaveResult> {
	const result = await save(withAuthor(app.ctx, author), files);
	app.pasteLog.append('save', [
		...result.files.map((r, i) => ({
			codes: r.diagnostics.map((d) => d.code),
			outcome: r.status,
			slug: r.status === 'rejected' ? slugOf(files[i].text) : r.slug
		})),
		...unsent.map((u) => ({ codes: u.codes, outcome: 'rejected' as const, slug: u.slug }))
	]);
	return result;
}
