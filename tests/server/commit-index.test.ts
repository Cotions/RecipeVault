// Issue #10: the commit index in cache/index.db (index/commits.ts). A recipe's
// history is read from it instead of `git log --follow` over the whole vault.
// - It lists what `git log --follow -M` lists, on a generated vault (renames,
//   trash moves and back, a slug freed and taken again, deletions, a merge).
// - It is caught up incrementally (app commits, commits made outside the app)
//   and rebuilt when history was rewritten.
// - Deleting cache/ loses nothing: it comes back from git, equal.

import { rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openVault, withAuthor } from '../../src/lib/server/context';
import { catchUpCommits, commitChanges, followPath, indexedCommit } from '../../src/lib/server/index/commits';
import { syncVault } from '../../src/lib/server/index/sync';
import { HistoryError, recipeHistory, restoreVersion, undoCommit } from '../../src/lib/server/history';
import { currentFile, save } from '../../src/lib/server/save';
import { remove } from '../../src/lib/server/trash';
import { AUTHOR, fixtureVault, recipe, tempVault, type TempVault } from '../helpers/vault';

const CAMILLE = { name: 'Camille Inventée', email: 'camille@recipevault.invalid' };

let v: TempVault;
afterEach(() => v.cleanup());

const commitAll = (msg: string, env: Record<string, string> = {}) => {
	v.git('add', '-A');
	const args = ['-c', 'user.name=Externe Inventé', '-c', 'user.email=externe@example.invalid', 'commit', '-q', '--allow-empty', '-m', msg];
	// Distinct dates: git's date order is what the index reproduces.
	return withEnv(env, () => v.git(...args));
};
function withEnv<T>(env: Record<string, string>, fn: () => T): T {
	const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
	Object.assign(process.env, env);
	try {
		return fn();
	} finally {
		for (const [k, x] of Object.entries(saved)) if (x === undefined) delete process.env[k];
		else process.env[k] = x;
	}
}

/**
 * What `git log --follow -M --name-status -- <path>` lists: commit, status
 * letter, paths. One deliberate difference: `--follow` also looks for a file
 * the path was *copied* from (a `C`: git turns on --find-copies-harder when
 * following) and goes on in that other file's history; the index counts a
 * copy as a creation (`A`) and stops there. So the list ends at a copy.
 */
function gitFollow(path: string) {
	const out = v.git('-c', 'core.quotePath=false', 'log', '--follow', '-M', '--format=%x1e%H', '--name-status', '--', path);
	const all = out
		.split('\x1e')
		.filter((r) => r.trim())
		.map((rec) => {
			const [commit, ...rest] = rec.split('\n');
			const [status, a, b] = rest.find((l) => l.includes('\t'))!.split('\t');
			return { commit, status: status[0], from: a, path: b ?? a };
		});
	const copy = all.findIndex((e) => e.status === 'C');
	if (copy >= 0) {
		all.length = copy + 1;
		all[copy] = { ...all[copy], status: 'A', from: all[copy].path };
		copied.add(path);
	}
	return all;
}
const copied = new Set<string>();

const indexFollow = (path: string) => followPath(v.ctx.db, path).map((e) => ({ commit: e.commit, ...e.change }));

/** Every row of the commit index. */
const dump = () => ({
	commits: v.ctx.db.prepare('SELECT * FROM commits ORDER BY seq').all(),
	files: v.ctx.db.prepare('SELECT * FROM commit_files ORDER BY seq, path').all(),
	head: v.ctx.db.prepare("SELECT value FROM meta WHERE key = 'commits_head'").pluck().get()
});

/** Force the next catch-up to read everything again. */
const forget = () => v.ctx.db.prepare("DELETE FROM meta WHERE key = 'commits_head'").run();

// ---------------------------------------------------------------------------
// A generated vault: invented recipes, ~150 commits of every kind of path change.

let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const SLUGS = ['tarte-inventee', 'soupe-inventee', 'pain-invente', 'gratin-invente', 'ragout-invente', 'muffins-inventes'];

function body(slug: string, k: number): string {
	const steps = Array.from({ length: 8 }, (_, i) => `${i + 1}. Étape ${i + 1} de ${slug}, geste inventé numéro ${i + 1}.`).join('\n');
	return recipe(`${slug} ${k}`, `slug: ${slug}\n`, `## Préparation\n\n${steps}\n\n## Notes\n\nNote ${k}.\n`);
}

async function generate(n: number): Promise<void> {
	const root = v.dir;
	const live = (s: string) => existsSync(join(root, 'recipes', `${s}.md`));
	const trashed = (s: string) => existsSync(join(root, '_trash', `${s}.md`));
	const edit = (rel: string, k: number) => {
		const f = join(root, rel);
		writeFileSync(f, readFileSync(f, 'utf8').replace(/^Note .*$/m, `Note ${k}.`));
	};
	mkdirSync(join(root, '_trash'), { recursive: true });
	let t = Date.UTC(2021, 0, 1) / 1000;
	for (let k = 0; k < n; k++) {
		const s = pick(SLUGS);
		const other = pick(SLUGS);
		const op = rand();
		let msg = `op ${k}`;
		if (!live(s) && !trashed(s)) {
			writeFileSync(join(root, 'recipes', `${s}.md`), body(s, k));
			msg = `add: ${s}`;
		} else if (live(s) && op < 0.35) {
			edit(`recipes/${s}.md`, k);
			if (rand() < 0.3 && live(other) && other !== s) edit(`recipes/${other}.md`, k); // two recipes in one commit
			msg = `edit: ${s}`;
		} else if (live(s) && op < 0.5 && !trashed(s)) {
			v.git('mv', `recipes/${s}.md`, `_trash/${s}.md`);
			if (rand() < 0.3) edit(`_trash/${s}.md`, k);
			msg = `delete: ${s}`;
		} else if (trashed(s) && !live(s) && op < 0.65) {
			v.git('mv', `_trash/${s}.md`, `recipes/${s}.md`);
			msg = `restore: ${s}`;
		} else if (trashed(s) && op < 0.72) {
			v.git('rm', '-q', `_trash/${s}.md`); // purged by hand: the slug is free again
			msg = `purge: ${s}`;
		} else if (live(s) && !live(other) && !trashed(other) && op < 0.8) {
			v.git('mv', `recipes/${s}.md`, `recipes/${other}.md`); // a slug renamed by hand
			const f = join(root, 'recipes', `${other}.md`);
			writeFileSync(f, readFileSync(f, 'utf8').replace(`slug: ${s}`, `slug: ${other}`));
			msg = `rename: ${s} → ${other}`;
		} else if (live(s) && op < 0.85) {
			v.git('rm', '-q', `recipes/${s}.md`); // deleted outright
			msg = `rm: ${s}`;
		} else if (live(s) && live(other) && s !== other && op < 0.9) {
			// A rewrite: the file replaced by something unrelated (git sees a delete and an add only with -B; here, M).
			writeFileSync(join(root, 'recipes', `${s}.md`), body(s, k + 1000).replace(/Étape/g, 'Autre'));
			msg = `rewrite: ${s}`;
		} else {
			writeFileSync(join(root, 'prices.csv'), `date,ingredient\n2026-01-${String((k % 28) + 1).padStart(2, '0')},farine\n`);
			msg = `prices: ${k}`;
		}
		t += 3600;
		const date = `@${t} -0400`;
		commitAll(msg, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
	}
}

/** A side branch merged back, its commits dated among the main line's. */
function mergeSideBranch(): void {
	const base = v.git('rev-parse', 'HEAD').trim();
	const main = v.git('symbolic-ref', '--short', 'HEAD').trim();
	const stamp = (n: number) => ({ GIT_AUTHOR_DATE: `@${Date.UTC(2025, 0, n) / 1000} -0400`, GIT_COMMITTER_DATE: `@${Date.UTC(2025, 0, n) / 1000} -0400` });
	v.git('checkout', '-q', '-b', 'cote', base);
	writeFileSync(join(v.dir, 'recipes', 'crepe-du-cote.md'), body('crepe-du-cote', 1));
	commitAll('add: côté', stamp(1));
	writeFileSync(join(v.dir, 'recipes', 'crepe-du-cote.md'), body('crepe-du-cote', 3));
	commitAll('edit: côté', stamp(3));
	v.git('checkout', '-q', main);
	writeFileSync(join(v.dir, 'recipes', 'galette-du-main.md'), body('galette-du-main', 2));
	commitAll('add: main', stamp(2));
	withEnv(stamp(4), () => v.git('-c', 'user.name=X', '-c', 'user.email=x@example.invalid', 'merge', '-q', '--no-ff', '--no-edit', 'cote'));
}

/** Every recipe or trash path the vault ever had. */
const everyPath = () =>
	[...new Set(v.git('log', '--all', '--format=', '--name-only').split('\n').filter((p) => /^(recipes|_trash)\/.*\.md$/.test(p)))].sort();

describe('the commit index lists what git log --follow lists', () => {
	beforeEach(async () => {
		v = await tempVault();
	});

	it('for every path of a generated vault: renames, trash and back, slugs freed and taken again, a merge', async () => {
		await generate(120);
		mergeSideBranch();
		await generate(30);
		const r = await catchUpCommits(v.ctx.db, v.dir);
		expect(r.mode).toBe('rebuild');
		const paths = everyPath();
		expect(paths.length).toBeGreaterThanOrEqual(12);
		const statuses = new Set<string>();
		for (const p of paths) {
			const expected = gitFollow(p);
			const got = indexFollow(p);
			// After a copy (now a creation) git went on in another file; the index went on in this path's older commits.
			if (copied.has(p)) got.length = Math.min(got.length, expected.length);
			expect(got, p).toEqual(expected);
			for (const e of expected) statuses.add(e.status);
		}
		// Undo reads what a commit changed from the index: the same as git diff-tree, in git's order.
		for (const c of v.ctx.db.prepare('SELECT seq, hash FROM commits').all() as { seq: number; hash: string }[]) {
			const git = v.git('diff-tree', '-r', '-M', '--no-commit-id', '--name-status', '--root', c.hash).split('\n').filter(Boolean).map((l) => {
				const [st, a, b] = l.split('\t');
				return { status: st[0], from: a, path: b ?? a };
			});
			expect(commitChanges(v.ctx.db, c.seq), c.hash).toEqual(git);
		}
		// The vault did exercise every kind of change, a copy included (a slug renamed by hand, then taken again).
		expect([...statuses].sort()).toEqual(['A', 'D', 'M', 'R']);
		expect(copied.size).toBeGreaterThan(0);
		expect(copied.size).toBeLessThan(paths.length / 2);
		// ~150 commits and a git log per path: 2–3 s alone, over 5 s under full-suite load.
	}, 30_000);

	it('for the history page: same versions as the page built on git log --follow', async () => {
		await generate(60);
		for (const s of SLUGS) {
			const h = await recipeHistory(v.ctx, s);
			const path = h.where === 'trash' ? `_trash/${s}.md` : `recipes/${s}.md`;
			const git = gitFollow(path);
			// The page's cut: the creation kept, an older removal dropped (one of the newest kept).
			const cut = git.findIndex((e, i) => e.status === 'A' || (i > 0 && e.status === 'D'));
			if (cut >= 0) git.length = git[cut].status === 'A' ? cut + 1 : cut;
			expect(h.versions.map((x) => x.commit), s).toEqual(git.map((e) => e.commit));
		}
	});
});

describe('kept up to date', () => {
	beforeEach(async () => {
		v = await fixtureVault();
	});

	it('reads only the new commits after an app commit and after commits made outside the app', async () => {
		expect((await catchUpCommits(v.ctx.db, v.dir)).mode).toBe('rebuild');
		expect((await catchUpCommits(v.ctx.db, v.dir)).mode).toBe('none');
		// An app save: caught up in the background, or by the next read.
		const cur = currentFile(v.ctx, 'crepes')!;
		const r = await save(withAuthor(v.ctx, CAMILLE), [{ text: cur.text.replace('servings: 4', 'servings: 5'), overwrite: cur.hash }]);
		await catchUpCommits(v.ctx.db, v.dir);
		expect(dump().head).toBe(r.commit);
		expect(followPath(v.ctx.db, 'recipes/crepes.md')[0]).toMatchObject({ commit: r.commit, author: CAMILLE.name, message: 'edit: Crêpes minces' });
		// Two commits by hand while the app looks away.
		writeFileSync(join(v.dir, 'recipes/crepes.md'), readFileSync(join(v.dir, 'recipes/crepes.md'), 'utf8').replace('servings: 5', 'servings: 6'));
		commitAll('edit (by hand): crepes');
		v.git('mv', 'recipes/crepes.md', 'recipes/crepes-fines.md');
		commitAll('rename (by hand): crepes');
		expect(await catchUpCommits(v.ctx.db, v.dir)).toEqual({ mode: 'append', commits: 2 });
		const appended = dump();
		// The same rows as reading everything again.
		forget();
		expect((await catchUpCommits(v.ctx.db, v.dir)).mode).toBe('rebuild');
		expect(dump()).toEqual(appended);
		expect(indexFollow('recipes/crepes-fines.md')).toEqual(gitFollow('recipes/crepes-fines.md'));
	});

	it('a recipe made as a copy of another starts its own history (git --follow would go on in the other one)', async () => {
		const cur = currentFile(v.ctx, 'crepes')!;
		await save(v.ctx, [{ text: cur.text.replace('servings: 4', 'servings: 5'), overwrite: cur.hash }]);
		const copy = cur.text.replace('title: Crêpes minces', 'title: Crêpes épaisses inventées').replace('slug: crepes', 'slug: crepes-epaisses-inventees');
		const r = await save(v.ctx, [{ text: copy }]);
		expect(v.git('log', '--follow', '-M', '--format=%H', '--', 'recipes/crepes-epaisses-inventees.md').trim().split('\n').length).toBeGreaterThan(1);
		const h = await recipeHistory(v.ctx, 'crepes-epaisses-inventees');
		expect(h.versions.map((x) => [x.commit, x.summary])).toEqual([[r.commit, ['Recette ajoutée']]]);
	});

	it('the history page sees a commit made outside the app without a sync', async () => {
		await recipeHistory(v.ctx, 'crepes');
		writeFileSync(join(v.dir, 'recipes/crepes.md'), readFileSync(join(v.dir, 'recipes/crepes.md'), 'utf8').replace('servings: 4', 'servings: 7'));
		commitAll('edit (by hand): crepes');
		syncVault(v.ctx.db, v.ctx.paths);
		const h = await recipeHistory(v.ctx, 'crepes');
		expect(h.versions[0].message).toBe('edit (by hand): crepes');
		expect(h.versions[0].summary).toEqual(['Modifié : portions']);
		// …and a restore finds that version's parent without the page.
		const r = await restoreVersion(v.ctx, 'crepes', h.versions[1].commit, h.hash!);
		expect(r.commit).toBeDefined();
		expect(currentFile(v.ctx, 'crepes')!.text).toMatch(/servings: 4/);
	});

	it('rebuilds when history was rewritten: an amend, a reset, a merge in the new commits', async () => {
		writeFileSync(join(v.dir, 'recipes/crepes.md'), readFileSync(join(v.dir, 'recipes/crepes.md'), 'utf8').replace('servings: 4', 'servings: 5'));
		commitAll('edit: crepes');
		await catchUpCommits(v.ctx.db, v.dir);
		const amended = v.git('rev-parse', 'HEAD').trim();
		v.git('-c', 'user.name=X', '-c', 'user.email=x@example.invalid', 'commit', '-q', '--amend', '-m', 'edit: crepes (amended)');
		expect((await catchUpCommits(v.ctx.db, v.dir)).mode).toBe('rebuild');
		expect(dump().commits.some((c) => (c as { hash: string }).hash === amended)).toBe(false);
		expect(followPath(v.ctx.db, 'recipes/crepes.md')[0].message).toBe('edit: crepes (amended)');
		v.git('reset', '-q', '--hard', 'HEAD~1');
		expect((await catchUpCommits(v.ctx.db, v.dir)).mode).toBe('rebuild');
		expect(indexFollow('recipes/crepes.md')).toEqual(gitFollow('recipes/crepes.md'));
		mergeSideBranch();
		expect((await catchUpCommits(v.ctx.db, v.dir)).mode).toBe('rebuild');
		for (const p of ['recipes/crepe-du-cote.md', 'recipes/galette-du-main.md', 'recipes/crepes.md']) expect(indexFollow(p), p).toEqual(gitFollow(p));
		// A merge is not in the index: undo asks git, and refuses it as before.
		const merge = v.git('rev-parse', 'HEAD').trim();
		expect(indexedCommit(v.ctx.db, merge)).toBeUndefined();
		expect(await undoCommit(v.ctx, merge).catch((e) => (e as HistoryError).reason)).toBe('unsupported');
		// A commit on top of the merge: appended.
		writeFileSync(join(v.dir, 'recipes/crepe-du-cote.md'), body('crepe-du-cote', 9));
		commitAll('edit: côté');
		expect((await catchUpCommits(v.ctx.db, v.dir)).mode).toBe('append');
		expect(indexFollow('recipes/crepe-du-cote.md')).toEqual(gitFollow('recipes/crepe-du-cote.md'));
	});

	it('reads HEAD from packed refs, a detached HEAD and a new branch without running git', async () => {
		await catchUpCommits(v.ctx.db, v.dir);
		const head = v.git('rev-parse', 'HEAD').trim();
		v.git('pack-refs', '--all', '--prune');
		expect(await catchUpCommits(v.ctx.db, v.dir)).toEqual({ mode: 'none', commits: 0 });
		writeFileSync(join(v.dir, 'recipes/crepes.md'), readFileSync(join(v.dir, 'recipes/crepes.md'), 'utf8').replace('servings: 4', 'servings: 9'));
		commitAll('edit: after pack-refs');
		expect(await catchUpCommits(v.ctx.db, v.dir)).toEqual({ mode: 'append', commits: 1 });
		v.git('checkout', '-q', '--detach', head);
		expect((await catchUpCommits(v.ctx.db, v.dir)).mode).toBe('rebuild');
		expect(dump().head).toBe(head);
		v.git('checkout', '-q', '--orphan', 'vide');
		expect((await catchUpCommits(v.ctx.db, v.dir)).mode).toBe('rebuild');
		expect(dump().commits).toEqual([]);
		// A short commit id is looked up in the index.
		v.git('checkout', '-q', '-f', 'main');
		await catchUpCommits(v.ctx.db, v.dir);
		expect(indexedCommit(v.ctx.db, head.slice(0, 7))?.hash).toBe(head);
	});

	it('an empty repository has an empty index', async () => {
		rmSync(join(v.dir, '.git'), { recursive: true });
		v.git('init', '-q');
		expect((await catchUpCommits(v.ctx.db, v.dir)).mode).toBe('rebuild');
		expect(dump().commits).toEqual([]);
		expect(await recipeHistory(v.ctx, 'crepes')).toMatchObject({ where: 'live', versions: [] });
	});
});

describe('deleting cache/ and restarting', () => {
	beforeEach(async () => {
		v = await fixtureVault();
	});

	it('loses nothing: the commit index and every history page come back from git', async () => {
		const her = withAuthor(v.ctx, CAMILLE);
		for (const n of [5, 6, 7]) {
			const cur = currentFile(v.ctx, 'crepes')!;
			await save(her, [{ text: cur.text.replace(/servings: \d/, `servings: ${n}`), overwrite: cur.hash }]);
		}
		await remove(her, 'pate-brisee');
		const slugs = [...(v.ctx.db.prepare('SELECT slug FROM recipes ORDER BY slug').pluck().all() as string[]), 'pate-brisee'];
		const pages = async () => Promise.all(slugs.map((s) => recipeHistory(v.ctx, s)));
		const before = await pages();
		const rows = dump();
		expect(rows.commits.length).toBeGreaterThan(4);
		v.ctx.db.close();
		rmSync(join(v.dir, 'cache'), { recursive: true });
		const ctx = openVault({ root: v.dir, author: AUTHOR, log: () => {} });
		expect(ctx.fresh).toBe(true);
		v.ctx = ctx;
		syncVault(ctx.db, ctx.paths);
		expect(await pages()).toEqual(before);
		expect(dump()).toEqual(rows);
	});
});
