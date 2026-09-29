// Soft delete (docs/DATA-FLOW.md, "Delete"): never unlink. The file and its
// media folder move to _trash/, one commit, index rows and derived copies
// (cache/img/<slug>/) dropped. Restore
// reverses it, refused if the slug has been taken again. A failed commit
// moves everything back, so disk, git and index never disagree.

import { existsSync, readdirSync, readFileSync, renameSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { checkFile } from '../vault/check';
import { stripMarkers } from '../vault/markers';
import { committed, type VaultContext } from './context';
import { commitPaths, unstage } from './git';
import { deleteRecipeRows, refreshFamilies, sha256 } from './index/build';
import { indexText, isRecipeFile, recipePath } from './index/sync';
import { dropDerived } from './photos';
import { MEDIA, TRASH } from './vault';
import { SLUG_RE } from '../vault/slug';
import { loadVocab } from './vocab';

/** Why a trash move was refused; `message` is for the trash's own pages (and the log). */
export type TrashErrorReason = 'gone' | 'stale' | 'taken' | 'failed';

export class TrashError extends Error {
	constructor(
		message: string,
		readonly reason: TrashErrorReason
	) {
		super(message);
	}
}

const trashPath = (slug: string) => `${TRASH}/${slug}.md`;

function titleOf(text: string, slug: string): string {
	const r = checkFile(text);
	const t = r.recipe?.title ?? r.frontmatter?.title;
	return typeof t === 'string' ? stripMarkers(t) : slug;
}

export function remove(ctx: VaultContext, slug: string, expectedHash?: string): Promise<{ commit?: string }> {
	return ctx.lock.run(async () => {
		if (!SLUG_RE.test(slug)) throw new TrashError(`no recipe ${slug}`, 'gone');
		const { root } = ctx.paths;
		const from = join(root, recipePath(slug));
		const to = join(root, trashPath(slug));
		if (!existsSync(from)) throw new TrashError(`no recipe ${slug}`, 'gone');
		if (existsSync(to)) throw new TrashError(`${trashPath(slug)} already exists`, 'taken');
		const text = readFileSync(from, 'utf8');
		if (expectedHash !== undefined && sha256(text) !== expectedHash)
			throw new TrashError('le fichier a changé depuis l’ouverture de la page ; rechargez-la.', 'stale');
		renameSync(from, to);
		const now = new Date();
		utimesSync(to, now, now); // the trash lists by deletion time
		const media = join(root, MEDIA, slug);
		const mediaTrash = join(root, TRASH, slug);
		const movedMedia = existsSync(media);
		if (movedMedia) renameSync(media, mediaTrash);
		const paths = [recipePath(slug), trashPath(slug)];
		let commit: string | undefined;
		try {
			commit = await commitPaths(root, paths, `delete: ${titleOf(text, slug)}`, ctx.author);
		} catch (e) {
			// Put everything back: a delete that git did not record did not happen.
			renameSync(to, from);
			if (movedMedia) renameSync(mediaTrash, media);
			await unstage(root, paths);
			throw new TrashError(`la suppression n’a pas pu être enregistrée (git) ; rien n’a changé : ${(e as Error).message}`, 'failed');
		}
		// The derived copies are cache: dropped with the recipe, rebuilt on demand after a restore.
		dropDerived(ctx.paths, slug);
		ctx.db.transaction(() => {
			deleteRecipeRows(ctx.db, slug);
			ctx.db.prepare('DELETE FROM problems WHERE file_path = ?').run(recipePath(slug));
			refreshFamilies(ctx.db, loadVocab(ctx.paths.vocab));
		})();
		committed(ctx);
		return { commit };
	});
}

export function restore(ctx: VaultContext, slug: string): Promise<{ commit?: string }> {
	return ctx.lock.run(async () => {
		if (!SLUG_RE.test(slug)) throw new TrashError(`${slug} n’est pas dans la corbeille`, 'gone');
		const { root } = ctx.paths;
		const from = join(root, trashPath(slug));
		const to = join(root, recipePath(slug));
		if (!existsSync(from)) throw new TrashError(`${slug} n’est pas dans la corbeille`, 'gone');
		if (existsSync(to) || ctx.db.prepare('SELECT 1 FROM recipes WHERE slug = ?').get(slug))
			throw new TrashError(`le nom ${slug} est déjà repris par une autre recette`, 'taken');
		const mediaTrash = join(root, TRASH, slug);
		const media = join(root, MEDIA, slug);
		if (existsSync(mediaTrash) && existsSync(media)) throw new TrashError(`media/${slug} existe déjà`, 'taken');
		renameSync(from, to);
		const movedMedia = existsSync(mediaTrash);
		if (movedMedia) renameSync(mediaTrash, media);
		const text = readFileSync(to, 'utf8');
		const rel = recipePath(slug);
		ctx.ownWrites.set(rel, sha256(text));
		const paths = [trashPath(slug), rel];
		let commit: string | undefined;
		try {
			commit = await commitPaths(root, paths, `restore: ${titleOf(text, slug)}`, ctx.author);
		} catch (e) {
			ctx.ownWrites.delete(rel);
			renameSync(to, from);
			if (movedMedia) renameSync(media, mediaTrash);
			await unstage(root, paths);
			throw new TrashError(`la restauration n’a pas pu être enregistrée (git) ; rien n’a changé : ${(e as Error).message}`, 'failed');
		}
		const vocab = loadVocab(ctx.paths.vocab);
		ctx.db.transaction(() => {
			indexText(ctx.db, vocab, rel, text);
			refreshFamilies(ctx.db, vocab);
		})();
		committed(ctx);
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
