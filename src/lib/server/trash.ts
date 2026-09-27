// Soft delete (docs/DATA-FLOW.md, "Delete"): never unlink. The file and its
// media folder move to _trash/, one commit, index rows dropped. Restore
// reverses it, refused if the slug has been taken again.

import { existsSync, readdirSync, readFileSync, renameSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { checkFile } from '../vault/check';
import { stripMarkers } from '../vault/markers';
import type { VaultContext } from './context';
import { commitPaths } from './git';
import { deleteRecipeRows, sha256 } from './index/build';
import { indexText, isRecipeFile, recipePath } from './index/sync';
import { MEDIA, TRASH } from './vault';
import { loadVocab } from './vocab';

export class TrashError extends Error {}

const trashPath = (slug: string) => `${TRASH}/${slug}.md`;

function titleOf(text: string, slug: string): string {
	const r = checkFile(text);
	const t = r.recipe?.title ?? r.frontmatter?.title;
	return typeof t === 'string' ? stripMarkers(t) : slug;
}

export function remove(ctx: VaultContext, slug: string, expectedHash?: string): Promise<{ commit?: string }> {
	return ctx.lock.run(async () => {
		const { root } = ctx.paths;
		const from = join(root, recipePath(slug));
		const to = join(root, trashPath(slug));
		if (!existsSync(from)) throw new TrashError(`no recipe ${slug}`);
		if (existsSync(to)) throw new TrashError(`${trashPath(slug)} already exists`);
		const text = readFileSync(from, 'utf8');
		if (expectedHash !== undefined && sha256(text) !== expectedHash)
			throw new TrashError('le fichier a changé depuis l’ouverture de la page ; rechargez-la.');
		renameSync(from, to);
		const now = new Date();
		utimesSync(to, now, now); // the trash lists by deletion time
		const media = join(root, MEDIA, slug);
		if (existsSync(media)) renameSync(media, join(root, TRASH, slug));
		const commit = await commitPaths(root, [recipePath(slug), trashPath(slug)], `delete: ${titleOf(text, slug)}`, ctx.author);
		ctx.db.transaction(() => {
			deleteRecipeRows(ctx.db, slug);
			ctx.db.prepare('DELETE FROM problems WHERE file_path = ?').run(recipePath(slug));
		})();
		ctx.pusher.schedule();
		return { commit };
	});
}

export function restore(ctx: VaultContext, slug: string): Promise<{ commit?: string }> {
	return ctx.lock.run(async () => {
		const { root } = ctx.paths;
		const from = join(root, trashPath(slug));
		const to = join(root, recipePath(slug));
		if (!existsSync(from)) throw new TrashError(`${slug} n’est pas dans la corbeille`);
		if (existsSync(to) || ctx.db.prepare('SELECT 1 FROM recipes WHERE slug = ?').get(slug))
			throw new TrashError(`le nom ${slug} est déjà repris par une autre recette`);
		const mediaTrash = join(root, TRASH, slug);
		const media = join(root, MEDIA, slug);
		if (existsSync(mediaTrash) && existsSync(media)) throw new TrashError(`media/${slug} existe déjà`);
		renameSync(from, to);
		if (existsSync(mediaTrash)) renameSync(mediaTrash, media);
		const text = readFileSync(to, 'utf8');
		ctx.ownWrites.set(recipePath(slug), sha256(text));
		const commit = await commitPaths(root, [trashPath(slug), recipePath(slug)], `restore: ${titleOf(text, slug)}`, ctx.author);
		indexText(ctx.db, loadVocab(ctx.paths.vocab), recipePath(slug), text);
		ctx.pusher.schedule();
		return { commit };
	});
}

export interface TrashEntry {
	slug: string;
	title: string;
	deleted: string;
	/** A recipe with the same slug exists again: restore is refused. */
	taken: boolean;
}

export function listTrash(ctx: VaultContext): TrashEntry[] {
	const dir = ctx.paths.trash;
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter(isRecipeFile)
		.map((f) => {
			const slug = f.slice(0, -3);
			const abs = join(dir, f);
			return {
				slug,
				title: titleOf(readFileSync(abs, 'utf8'), slug),
				deleted: statSync(abs).mtime.toISOString(),
				taken: existsSync(join(ctx.paths.root, recipePath(slug)))
			};
		})
		.sort((a, b) => b.deleted.localeCompare(a.deleted));
}
