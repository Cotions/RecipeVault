// Plan 04, Phase 7: undo and history. Undo and restore write the old text as a
// NEW commit by the signed-in person; nothing rewrites git history.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withAuthor } from '../../src/lib/server/context';
import { familiesFile, setFamilyLabel, withLabel, FAMILIES_FILE } from '../../src/lib/server/families';
import { writeAndCommit } from '../../src/lib/server/files';
import { commitPaths } from '../../src/lib/server/git';
import { HistoryError, recipeHistory, restoreVersion, undoCommit } from '../../src/lib/server/history';
import { appendPrice } from '../../src/lib/server/prices';
import { currentFile, save } from '../../src/lib/server/save';
import { remove, restore } from '../../src/lib/server/trash';
import { AUTHOR, fixtureVault, recipe, type TempVault } from '../helpers/vault';

const CAMILLE = { name: 'Camille Inventée', email: 'camille@recipevault.invalid' };

let v: TempVault;
beforeEach(async () => {
	v = await fixtureVault();
});
afterEach(() => v.cleanup());

const head = () => v.git('rev-parse', 'HEAD').trim();
const last = () => v.git('log', '-1', '--format=%s|%an|%ae').trim();
const count = () => Number(v.git('rev-list', '--count', 'HEAD').trim());
const file = (slug: string) => currentFile(v.ctx, slug)!;
const row = (slug: string) => v.ctx.db.prepare('SELECT title FROM recipes WHERE slug = ?').get(slug) as { title: string } | undefined;

/** Edit a recipe through the one save path, as the form does. */
async function edit(slug: string, change: (text: string) => string, today = '2026-09-28', ctx = withAuthor(v.ctx, CAMILLE)) {
	const cur = file(slug);
	const r = await save(ctx, [{ text: change(cur.text), overwrite: cur.hash }], { today });
	expect(r.files[0].status).toBe('saved');
	return r.commit!;
}

async function rejects(p: Promise<unknown>, reason: string) {
	const e = await p.then(
		() => null,
		(x) => x
	);
	expect(e).toBeInstanceOf(HistoryError);
	expect((e as HistoryError).reason).toBe(reason);
	expect((e as HistoryError).message).not.toMatch(/E\d{3}|W\d{3}/);
}

describe('undo', () => {
	it('puts the previous file back byte for byte in a new commit by the signed-in person', async () => {
		const before = file('crepes').text;
		const saved = await edit('crepes', (t) => t.replace('Crêpes minces', 'Crêpes très minces'));
		const n = count();
		const r = await undoCommit(withAuthor(v.ctx, CAMILLE), saved, { slug: 'crepes' });
		expect(r).toMatchObject({ action: 'undone', slugs: ['crepes'], kept: [] });
		expect(r.commit).toBe(head());
		expect(file('crepes').text).toBe(before);
		expect(last()).toBe(`undo: Crêpes minces|${CAMILLE.name}|${CAMILLE.email}`);
		// Never rewritten: one more commit, the undone one still in history.
		expect(count()).toBe(n + 1);
		expect(v.git('merge-base', '--is-ancestor', saved, 'HEAD')).toBe('');
		expect(row('crepes')!.title).toBe('Crêpes minces');
		expect(v.git('status', '--porcelain').trim()).toBe('');
	});

	it('is refused when the file changed since, and writes nothing', async () => {
		const saved = await edit('crepes', (t) => t.replace('Crêpes minces', 'Crêpes A'));
		await edit('crepes', (t) => t.replace('Crêpes A', 'Crêpes B'));
		const n = count();
		const text = file('crepes').text;
		await rejects(undoCommit(v.ctx, saved, { slug: 'crepes' }), 'stale');
		expect(count()).toBe(n);
		expect(file('crepes').text).toBe(text);
	});

	it('undo of an undo is a redo', async () => {
		const saved = await edit('crepes', (t) => t.replace('servings: 4', 'servings: 6'));
		const after = file('crepes').text;
		const u = await undoCommit(v.ctx, saved);
		const redo = await undoCommit(withAuthor(v.ctx, CAMILLE), u.commit!);
		expect(redo.action).toBe('undone');
		expect(file('crepes').text).toBe(after);
		expect(last()).toMatch(/^undo: Crêpes minces\|Camille/);
	});

	it('undo of a new recipe sends it to the trash; undoing that brings it back', async () => {
		const r = await save(withAuthor(v.ctx, CAMILLE), [{ text: recipe('Galettes inventées') }]);
		const u = await undoCommit(withAuthor(v.ctx, CAMILLE), r.commit!, { slug: 'galettes-inventees' });
		expect(u.action).toBe('trashed');
		expect(currentFile(v.ctx, 'galettes-inventees')).toBeUndefined();
		expect(v.read('_trash/galettes-inventees.md')).toContain('Galettes inventées');
		expect(last()).toMatch(/^delete: Galettes inventées\|Camille/);
		expect(row('galettes-inventees')).toBeUndefined();
		const back = await undoCommit(v.ctx, u.commit!);
		expect(back.action).toBe('untrashed');
		expect(row('galettes-inventees')!.title).toBe('Galettes inventées');
		// …and the other way: undoing the trash restore trashes it again.
		const again = await undoCommit(v.ctx, back.commit!);
		expect(again.action).toBe('trashed');
	});

	it('reverts every recipe of a two-recipe commit, and the family label written with them', async () => {
		const a = file('crepes');
		const b = file('pate-brisee');
		const beforeA = a.text;
		const beforeB = b.text;
		const beforeFamilies = familiesFile(v.ctx).text;
		const commit = await v.ctx.lock.run(() =>
			writeAndCommit(
				withAuthor(v.ctx, CAMILLE),
				[
					{ rel: 'recipes/crepes.md', text: a.text.replace('title: Crêpes minces', 'title: Crêpes minces\nfamily: galettes\nvariant: minces') },
					{ rel: 'recipes/pate-brisee.md', text: b.text.replace('servings:', 'servings:') + '\n' },
					{ rel: FAMILIES_FILE, text: withLabel(beforeFamilies, 'galettes', 'Galettes') }
				],
				'edit: Crêpes minces; edit: Pâte brisée'
			)
		);
		const u = await undoCommit(v.ctx, commit!, { slug: 'crepes' });
		expect(u).toMatchObject({ action: 'undone', kept: [] });
		expect(u.slugs.sort()).toEqual(['crepes', 'pate-brisee']);
		expect(file('crepes').text).toBe(beforeA);
		expect(file('pate-brisee').text).toBe(beforeB);
		expect(familiesFile(v.ctx).text).toBe(beforeFamilies);
		expect(v.git('show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort()).toEqual(['recipes/crepes.md', 'recipes/pate-brisee.md', FAMILIES_FILE]);
	});

	it('keeps a family label changed since, and says so', async () => {
		const a = file('crepes');
		const fam = familiesFile(v.ctx).text;
		const commit = await v.ctx.lock.run(() =>
			writeAndCommit(
				v.ctx,
				[
					{ rel: 'recipes/crepes.md', text: a.text.replace('title: Crêpes minces', 'title: Crêpes minces\nfamily: galettes\nvariant: minces') },
					{ rel: FAMILIES_FILE, text: withLabel(fam, 'galettes', 'Galettes') }
				],
				'edit: Crêpes minces'
			)
		);
		await setFamilyLabel(v.ctx, 'galettes', 'Galettes fines', familiesFile(v.ctx).hash);
		const u = await undoCommit(v.ctx, commit!);
		expect(u.kept).toEqual([FAMILIES_FILE]);
		expect(file('crepes').text).toBe(a.text);
		expect(familiesFile(v.ctx).text).toContain('Galettes fines');
	});

	it('refuses a commit of another recipe, an unknown commit and a commit it cannot undo', async () => {
		const saved = await edit('crepes', (t) => t.replace('servings: 4', 'servings: 5'));
		await rejects(undoCommit(v.ctx, saved, { slug: 'pate-brisee' }), 'unknown');
		await rejects(undoCommit(v.ctx, 'deadbeefdeadbeef'), 'unknown');
		await rejects(undoCommit(v.ctx, '--all'), 'unknown');
		const p = await appendPrice(v.ctx, { ingredient: 'farine', amount: 4.99, packQty: 2.5, packUnit: 'kg', date: '2026-09-28' });
		await rejects(undoCommit(v.ctx, p.commit!), 'unsupported');
	});

	it('refuses to write back a version today’s checker rejects', async () => {
		// An old version the checker of today refuses (made outside the app).
		const good = file('crepes').text;
		writeFileSync(join(v.dir, 'recipes/crepes.md'), good.replace('unit: pinch', 'unit: pincée'));
		await commitPaths(v.dir, ['recipes/crepes.md'], 'edit (external): crepes', AUTHOR);
		writeFileSync(join(v.dir, 'recipes/crepes.md'), good);
		const fix = await commitPaths(v.dir, ['recipes/crepes.md'], 'edit (external): crepes', AUTHOR);
		const n = count();
		await rejects(undoCommit(v.ctx, fix!), 'invalid');
		expect(count()).toBe(n);
		expect(file('crepes').text).toBe(good);
	});
});

describe('history and restore', () => {
	it('lists versions newest first with date, author, verb and a French summary', async () => {
		await edit('crepes', (t) => t.replace('Crêpes minces', 'Crêpes fines'), '2026-09-26');
		await edit('crepes', (t) => t.replace('      - { name: beurre, to_taste: true }', '      - { name: beurre, to_taste: true }\n      - { qty: 1, unit: tsp, name: vanille }'), '2026-09-27');
		await edit('crepes', (t) => t.replace('2. Laisser reposer 30 minutes.', '2. Laisser reposer 1 heure.').replace('tags: [petit-dejeuner, poele]', 'tags: [petit-dejeuner]'), '2026-09-28');
		const h = await recipeHistory(v.ctx, 'crepes');
		expect(h.where).toBe('live');
		expect(h.hash).toBe(file('crepes').hash);
		expect(h.versions.map((x) => x.verb)).toEqual(['edit', 'edit', 'edit', '']);
		const [c3, c2, c1, c0] = h.versions;
		expect(c3.author).toBe(CAMILLE.name);
		expect(c3.date).toMatch(/^\d{4}-\d\d-\d\dT/);
		expect(c3.current).toBe(true);
		expect(c3.restorable).toBe(false);
		expect(c3.summary).toContain('Une étape modifiée');
		expect(c3.summary.join('\n')).toMatch(/Étiquettes retirées : Poêle/);
		expect(c2.summary).toContain('Ingrédient ajouté : « vanille »');
		expect(c1.summary[0]).toBe('Titre : « Crêpes minces » devient « Crêpes fines »');
		expect(c0.summary).toEqual(['Recette ajoutée']);
		expect(c0.restorable).toBe(true);
		expect(c0.toCurrent.join('\n')).toMatch(/Titre : « Crêpes fines » devient « Crêpes minces »/);
		// Never the Markdown.
		for (const x of h.versions) for (const s of x.summary) expect(s).not.toMatch(/---|\{ ?qty|^\d\. /);
	});

	it('restores a version three edits back, byte for byte, as a new commit', async () => {
		const original = file('crepes').text;
		for (const [i, s] of [5, 6, 7].entries()) await edit('crepes', (t) => t.replace(/servings: \d/, `servings: ${s}`), `2026-09-2${i + 5}`);
		const h = await recipeHistory(v.ctx, 'crepes');
		const first = h.versions.at(-1)!;
		const n = count();
		const r = await restoreVersion(withAuthor(v.ctx, CAMILLE), 'crepes', first.commit, h.hash!);
		expect(r.commit).toBe(head());
		expect(count()).toBe(n + 1);
		expect(file('crepes').text).toBe(original);
		expect(last()).toBe(`restore: Crêpes minces (version du ${first.date.slice(0, 10)})|${CAMILLE.name}|${CAMILLE.email}`);
		// The restore can itself be undone (the toast after "Revenir").
		await undoCommit(v.ctx, r.commit!, { slug: 'crepes' });
		expect(file('crepes').text).toMatch(/servings: 7/);
	});

	it('refuses a restore when the file changed since the page was opened', async () => {
		await edit('crepes', (t) => t.replace('servings: 4', 'servings: 5'));
		const h = await recipeHistory(v.ctx, 'crepes');
		await edit('crepes', (t) => t.replace('servings: 5', 'servings: 6'));
		const n = count();
		await rejects(restoreVersion(v.ctx, 'crepes', h.versions.at(-1)!.commit, h.hash!), 'stale');
		expect(count()).toBe(n);
	});

	it('refuses a commit that is not one of this recipe’s versions', async () => {
		const other = await edit('pate-brisee', (t) => t + '\n');
		await rejects(restoreVersion(v.ctx, 'crepes', other, file('crepes').hash), 'unknown');
	});

	it('flags and refuses a version that fails today’s checker', async () => {
		const good = file('crepes').text;
		writeFileSync(join(v.dir, 'recipes/crepes.md'), good.replace('unit: pinch', 'unit: pincée'));
		const bad = await commitPaths(v.dir, ['recipes/crepes.md'], 'edit (external): crepes', AUTHOR);
		writeFileSync(join(v.dir, 'recipes/crepes.md'), good);
		await commitPaths(v.dir, ['recipes/crepes.md'], 'edit (external): crepes', AUTHOR);
		const h = await recipeHistory(v.ctx, 'crepes');
		const version = h.versions.find((x) => x.commit === bad)!;
		expect(version.restorable).toBe(false);
		expect(version.blocked).toBe('invalid');
		expect(version.summary).toEqual(['Version que l’application ne sait plus lire']);
		await rejects(restoreVersion(v.ctx, 'crepes', bad!, file('crepes').hash), 'invalid');
	});

	it('keeps the history of a recipe that went to the trash and back', async () => {
		await edit('crepes', (t) => t.replace('servings: 4', 'servings: 5'));
		await remove(v.ctx, 'crepes');
		const trashed = await recipeHistory(v.ctx, 'crepes');
		expect(trashed.where).toBe('trash');
		expect(trashed.versions.every((x) => !x.restorable)).toBe(true);
		expect(trashed.versions[0].summary).toEqual(['Mise à la corbeille']);
		await restore(v.ctx, 'crepes');
		await edit('crepes', (t) => t.replace('servings: 5', 'servings: 8'));
		const h = await recipeHistory(v.ctx, 'crepes');
		expect(h.versions.map((x) => x.verb)).toEqual(['edit', 'restore', 'delete', 'edit', '']);
		expect(h.versions[1].summary).toEqual(['Sortie de la corbeille']);
		expect(h.versions[3].summary).toEqual(['Modifié : portions']);
		// A version from before the trash can be restored.
		const r = await restoreVersion(v.ctx, 'crepes', h.versions[4].commit, h.hash!);
		expect(r.commit).toBeDefined();
		expect(file('crepes').text).toMatch(/servings: 4/);
	});

	it('follows a slug renamed by hand', async () => {
		const text = file('crepes').text;
		v.git('mv', 'recipes/crepes.md', 'recipes/crepes-fines.md');
		writeFileSync(join(v.dir, 'recipes/crepes-fines.md'), text.replace('slug: crepes', 'slug: crepes-fines'));
		v.git('add', '-A');
		v.git('-c', 'user.name=X', '-c', 'user.email=x@example.invalid', 'commit', '-qm', 'rename: crepes');
		const h = await recipeHistory(v.ctx, 'crepes-fines');
		expect(h.versions.length).toBe(2);
		expect(h.versions[0].summary[0]).toBe('Fichier renommé (avant : crepes)');
		// The old version carries the old slug: not restorable under the new name.
		expect(h.versions[1].blocked).toBe('other-slug');
	});

	it('a restore of the text already on disk commits nothing', async () => {
		const h = await recipeHistory(v.ctx, 'crepes');
		const n = count();
		expect(await restoreVersion(v.ctx, 'crepes', h.versions[0].commit, h.hash!)).toEqual({});
		expect(count()).toBe(n);
	});

	it('an unknown slug has no history', async () => {
		expect(await recipeHistory(v.ctx, 'nulle-part')).toMatchObject({ where: 'none', versions: [] });
	});
});
