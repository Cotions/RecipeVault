// Server side of the paste box: checks with the vault's context, saves, logs.

import { checkBatch, checkFile } from '../vault/check';
import { fileSlug } from '../vault/rules/batch';
import type { Diagnostic } from '../vault/types';
import type { App } from './app';
import { titles } from './index/query';
import { referencedSlugs } from './pages';
import { currentFile, save, vaultEntries, type SaveFile, type SaveResult } from './save';

export interface ServerCheckFile {
	diagnostics: Diagnostic[];
	slug?: string;
	/** Set when the slug is taken: what the person can choose. */
	collision?: { suggested: string; existing?: { title: string; hash: string }; inTrash: boolean };
	/** Titles of the recipes this file links to that exist in the vault. */
	titles: Record<string, string>;
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
		{ vault: entries }
	);
	const taken = new Set([...entries.map((e) => e.slug), ...texts.map(slugOf).filter((s): s is string => !!s)]);
	return result.files.map((f, i) => {
		const slug = slugOf(texts[i]);
		const out: ServerCheckFile = { diagnostics: f.diagnostics, slug, titles: {} };
		if (f.recipe) out.titles = Object.fromEntries(titles(app.ctx.db, referencedSlugs(f.recipe, '')));
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

export async function savePaste(app: App, files: SaveFile[]): Promise<SaveResult> {
	const result = await save(app.ctx, files);
	app.pasteLog.append(
		'save',
		result.files.map((r, i) => ({
			codes: r.diagnostics.map((d) => d.code),
			outcome: r.status,
			slug: r.status === 'rejected' ? slugOf(files[i].text) : r.slug
		}))
	);
	return result;
}
