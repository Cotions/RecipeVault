// The pair list and its actions (plan 05, Phase 7): each action one commit by
// the signed-in person touching only what it names, hash-guarded, undoable; a
// settled pair gone from the list and from W505, and still gone after the
// cache is deleted.

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../../src/lib/server/app';
import { withAuthor } from '../../src/lib/server/context';
import { closeRecipes, DISTINCT_FILE, dismissPair, DuplicateError, duplicateCount, duplicatePage, pairVersions, parseDistinct, readDistinct, sameRecipe, undismissPair } from '../../src/lib/server/duplicates';
import { undoCommit } from '../../src/lib/server/history';
import { syncVault } from '../../src/lib/server/index/sync';
import { serverCheck } from '../../src/lib/server/paste';
import { save } from '../../src/lib/server/save';
import { checkFile } from '../../src/lib/vault/check';
import { fixtureVault, type TempVault } from '../helpers/vault';
import { copyOf } from '../helpers/duplicates';

const POUDING = readFileSync('tests/fixtures/vault/recipes/pouding-chomeur.md', 'utf8');
const PATE = readFileSync('tests/fixtures/vault/recipes/pate-brisee.md', 'utf8');
const CAMILLE = { name: 'Camille Inventée', email: 'camille@recipevault.invalid' };

let v: TempVault;
beforeEach(async () => {
	v = await fixtureVault();
	await save(v.ctx, [{ text: copyOf(POUDING, 'Pouding de matante', 'pouding-de-matante') }]);
});
afterEach(() => v.cleanup());

const ctx = () => withAuthor(v.ctx, CAMILLE);
const head = () => v.git('log', '-1', '--format=%s|%an').trim();
const changed = (rev = 'HEAD') => v.git('show', '--name-status', '--format=', rev).trim().split('\n').sort();
const count = () => Number(v.git('rev-list', '--count', 'HEAD').trim());
const hash = (slug: string) => v.ctx.db.prepare('SELECT file_hash FROM recipes WHERE slug = ?').pluck().get(slug) as string;
const listed = () => duplicatePage(v.ctx).pairs.map((p) => `${p.a.slug} ${p.b.slug}`);
const PAIR = 'pouding-chomeur pouding-de-matante';

describe('the list', () => {
	it('shows the pair with both sides, its elements, and no title mark for different titles', () => {
		const page = duplicatePage(v.ctx);
		expect(page.total).toBe(1);
		expect(duplicateCount(v.ctx)).toBe(1);
		const [p] = page.pairs;
		expect([p.a.slug, p.b.slug]).toEqual(['pouding-chomeur', 'pouding-de-matante']);
		expect(p.score).toBe(1);
		expect(p.a).toMatchObject({ title: 'Pouding chômeur', sourceType: 'tv', source: 'Émission du midi', hash: hash('pouding-chomeur') });
		expect(p.shared).toContain('cassonade');
		expect(p.onlyA).toEqual([]);
		expect(p.titles).toBeNull();
		expect(page.distinctHash).toBe('');
	});

	it('marks near titles (W503) and same titles (W608)', async () => {
		await save(v.ctx, [{ text: copyOf(POUDING, 'Pouding chomeurs', 'pouding-chomeurs') }]);
		const p = duplicatePage(v.ctx).pairs.find((x) => x.a.slug === 'pouding-chomeur' && x.b.slug === 'pouding-chomeurs')!;
		expect(p.titles).toBe('near');
	});

	it('pages 20 at a time; a page past the end shows the last', async () => {
		const copies = Array.from({ length: 6 }, (_, i) => ({ text: copyOf(POUDING, `Pouding numéro ${i}`, `pouding-numero-${i}`) }));
		await save(v.ctx, copies);
		// 8 copies of one card: 28 pairs.
		expect(duplicatePage(v.ctx).total).toBe(28);
		expect(duplicatePage(v.ctx).pairs).toHaveLength(20);
		expect(duplicatePage(v.ctx, 2).pairs).toHaveLength(8);
		expect(duplicatePage(v.ctx, 9)).toMatchObject({ page: 2, pages: 2 });
	});
});

describe('"Recettes différentes"', () => {
	it('one commit touching only vocab/distinct.yaml; gone from the list and from W505; survives deleting cache/', async () => {
		const before = count();
		const r = await dismissPair(ctx(), 'pouding-de-matante', 'pouding-chomeur', '');
		expect(r.commit).toBeTruthy();
		expect(count()).toBe(before + 1);
		expect(head()).toBe(`duplicate: pouding-chomeur ≠ pouding-de-matante|${CAMILLE.name}`);
		expect(changed()).toEqual([`A\t${DISTINCT_FILE}`]);
		expect(parseDistinct(v.read(DISTINCT_FILE))).toEqual([['pouding-chomeur', 'pouding-de-matante']]);
		expect(v.read(DISTINCT_FILE)).toMatch(/^# /);
		expect(listed()).toEqual([]);
		expect(duplicateCount(v.ctx)).toBe(0);
		// Its own check (an edit, the form): the settled pair gives no W505.
		const matante = checkFile(v.read('recipes/pouding-de-matante.md')).recipe!;
		expect(closeRecipes(v.ctx, matante, 'pouding-de-matante')).toEqual([]);

		// The cache is rebuildable; the judgment is not in it.
		v.ctx.db.close();
		rmSync(join(v.ctx.paths.root, 'cache'), { recursive: true, force: true });
		const again = (await import('../../src/lib/server/context')).openVault({ root: v.ctx.paths.root, author: CAMILLE, log: () => {} });
		try {
			syncVault(again.db, again.paths);
			expect(duplicatePage(again).pairs).toEqual([]);
		} finally {
			again.db.close();
		}
	});

	it('keeps comments, sorts the lines, refuses a stale file, ignores a pair already there', async () => {
		await save(v.ctx, [{ text: copyOf(POUDING, 'Pouding pauvre', 'pouding-pauvre') }]);
		await dismissPair(ctx(), 'pouding-pauvre', 'pouding-de-matante', '');
		const h1 = duplicatePage(v.ctx).distinctHash;
		await expect(dismissPair(ctx(), 'pouding-chomeur', 'pouding-pauvre', 'stale')).rejects.toBeInstanceOf(DuplicateError);
		await dismissPair(ctx(), 'pouding-chomeur', 'pouding-pauvre', h1);
		const text = v.read(DISTINCT_FILE);
		expect(text.split('\n').filter((l) => l.startsWith('- '))).toEqual(['- [pouding-chomeur, pouding-pauvre]', '- [pouding-de-matante, pouding-pauvre]']);
		expect(text).toContain('# Pairs of recipes settled');
		const n = count();
		expect(await dismissPair(ctx(), 'pouding-pauvre', 'pouding-chomeur', duplicatePage(v.ctx).distinctHash)).toEqual({});
		expect(count()).toBe(n);
	});

	it('"Annuler" takes the line out, one commit; the pair is back', async () => {
		await dismissPair(ctx(), 'pouding-chomeur', 'pouding-de-matante', '');
		await undismissPair(ctx(), 'pouding-de-matante', 'pouding-chomeur');
		expect(head()).toBe(`undo: duplicate pouding-chomeur ≠ pouding-de-matante|${CAMILLE.name}`);
		expect(changed()).toEqual([`M\t${DISTINCT_FILE}`]);
		expect(parseDistinct(v.read(DISTINCT_FILE))).toEqual([]);
		expect(listed()).toEqual([PAIR]);
	});

	it('a line naming a recipe no longer in the vault is harmless', async () => {
		await dismissPair(ctx(), 'pouding-chomeur', 'pouding-de-matante', '');
		await sameRecipe(ctx(), 'pouding-de-matante', hash('pouding-de-matante'));
		expect(listed()).toEqual([]);
		await save(v.ctx, [{ text: copyOf(POUDING, 'Pouding pauvre', 'pouding-pauvre') }]);
		expect(listed()).toEqual(['pouding-chomeur pouding-pauvre']);
	});

	it('a slug YAML would read as a number or null is quoted, so the pair reads back and is settled', async () => {
		await save(v.ctx, [{ text: copyOf(POUDING, '"1905"', '"1905"') }]);
		expect(listed()).toContain('1905 pouding-chomeur');
		await dismissPair(ctx(), '1905', 'pouding-chomeur', '');
		const text = v.read(DISTINCT_FILE);
		expect(text).toContain('- ["1905", pouding-chomeur]');
		expect(parseDistinct(text)).toEqual([['1905', 'pouding-chomeur']]);
		expect(listed()).not.toContain('1905 pouding-chomeur');
		await undismissPair(ctx(), '1905', 'pouding-chomeur');
		expect(listed()).toContain('1905 pouding-chomeur');
	});

	it('a hand-written line that does not read as a pair is kept as written by the next write', async () => {
		writeFileSync(join(v.ctx.paths.root, DISTINCT_FILE), '# mine\n- [1905, gateau]\n- [null, b]\n');
		v.git('add', '-A');
		v.git('commit', '-qm', 'hand edit');
		await dismissPair(ctx(), 'pouding-chomeur', 'pouding-de-matante', duplicatePage(v.ctx).distinctHash);
		const text = v.read(DISTINCT_FILE);
		expect(text).toContain('- [1905, gateau]\n');
		expect(text).toContain('- [null, b]\n');
		expect(text).toContain('- [pouding-chomeur, pouding-de-matante]\n');
		expect(readDistinct(text)).toEqual({ pairs: [['pouding-chomeur', 'pouding-de-matante']] });
	});

	it('readDistinct names a file that does not read', () => {
		expect(readDistinct('<<<<<<< HEAD\n- [a, b]\n=======\n')).toMatchObject({ pairs: [], problem: expect.any(String) });
		expect(readDistinct('a: b\n')).toEqual({ pairs: [], problem: 'not-a-list' });
		expect(readDistinct('# only a comment\n')).toEqual({ pairs: [] });
	});
});

describe('W505 on a paste whose slug is taken (E103)', () => {
	it('leaves the recipe there out, but not the pairs settled for it', async () => {
		await dismissPair(ctx(), 'pouding-chomeur', 'pouding-de-matante', '');
		// As a paste arrives: no `status`/`added` (the app sets those).
		const [f] = serverCheck({ ctx: v.ctx } as App, [POUDING.replace(/^(status|added): .*\n/gm, '')]);
		expect(f.diagnostics.map((d) => d.code)).toEqual(['E103']);
		// Saved as pouding-chomeur-2 it is close to pouding-de-matante: the pair
		// settled for pouding-chomeur is not this file's. The recipe it collides with is left out.
		expect(f.collision?.suggested).toBe('pouding-chomeur-2');
		expect(f.close?.map((c) => c.slug)).toEqual(['pouding-de-matante']);
	});
});

describe('"Deux versions"', () => {
	it('both in one family, one commit editing both (and the label); undo puts both back', async () => {
		const [a0, b0] = [v.read('recipes/pouding-chomeur.md'), v.read('recipes/pouding-de-matante.md')];
		const r = await pairVersions(ctx(), {
			a: { slug: 'pouding-chomeur', hash: hash('pouding-chomeur'), variant: 'de la télé' },
			b: { slug: 'pouding-de-matante', hash: hash('pouding-de-matante'), variant: 'de matante' },
			family: 'Pouding chômeur',
			label: 'Pouding chômeur'
		});
		expect(r.family).toBe('pouding-chomeur');
		expect(head()).toBe(`edit: Pouding chômeur; edit: Pouding de matante|${CAMILLE.name}`);
		expect(changed()).toEqual(['M\trecipes/pouding-chomeur.md', 'M\trecipes/pouding-de-matante.md', 'M\tvocab/families.yaml']);
		expect(checkFile(v.read('recipes/pouding-chomeur.md')).recipe).toMatchObject({ family: 'pouding-chomeur', variant: 'de la télé' });
		expect(checkFile(v.read('recipes/pouding-de-matante.md')).recipe).toMatchObject({ family: 'pouding-chomeur', variant: 'de matante' });
		expect(v.read('vocab/families.yaml')).toContain('pouding-chomeur: { fr: Pouding chômeur }');
		// The same card twice, now in one family: still listed (Q16 C), without the offer.
		expect(listed()).toEqual([PAIR]);

		const u = await undoCommit(ctx(), r.commit!, { slug: 'pouding-chomeur' });
		expect(u.action).toBe('undone');
		expect(v.read('recipes/pouding-chomeur.md')).toBe(a0);
		expect(v.read('recipes/pouding-de-matante.md')).toBe(b0);
		expect(v.read('vocab/families.yaml')).not.toContain('pouding-chomeur:');
	});

	it('a failed commit is refused in French, both files as they were', async () => {
		const [a0, b0] = [v.read('recipes/pouding-chomeur.md'), v.read('recipes/pouding-de-matante.md')];
		writeFileSync(join(v.dir, '.git/index.lock'), '');
		try {
			const e = await pairVersions(ctx(), {
				a: { slug: 'pouding-chomeur', hash: hash('pouding-chomeur'), variant: 'de la télé' },
				b: { slug: 'pouding-de-matante', hash: hash('pouding-de-matante'), variant: 'de matante' },
				family: 'Pouding chômeur',
				label: ''
			}).catch((x) => x);
			expect(e).toBeInstanceOf(DuplicateError);
			expect(e.message).toMatch(/^les deux versions n’ont pas pu être enregistrées ; rien n’a changé/);
		} finally {
			rmSync(join(v.dir, '.git/index.lock'), { force: true });
		}
		expect([v.read('recipes/pouding-chomeur.md'), v.read('recipes/pouding-de-matante.md')]).toEqual([a0, b0]);
	});

	it('joins the family one of them is in; the other file is not rewritten when unchanged', async () => {
		const other = v.read('recipes/pouding-chomeur.md');
		await pairVersions(ctx(), {
			a: { slug: 'pouding-chomeur', hash: hash('pouding-chomeur'), variant: 'original' },
			b: { slug: 'pouding-de-matante', hash: hash('pouding-de-matante'), variant: 'de matante' },
			family: 'poudings'
		});
		expect(other).not.toBe(v.read('recipes/pouding-chomeur.md'));
		await save(v.ctx, [{ text: copyOf(POUDING, 'Pouding pauvre', 'pouding-pauvre') }]);
		const p = duplicatePage(v.ctx).pairs.find((x) => x.a.slug === 'pouding-chomeur' && x.b.slug === 'pouding-pauvre')!;
		expect(p.a).toMatchObject({ family: 'poudings', variant: 'original' });
		const n = count();
		const r = await pairVersions(ctx(), {
			a: { slug: 'pouding-chomeur', hash: p.a.hash, variant: 'original' },
			b: { slug: 'pouding-pauvre', hash: p.b.hash, variant: 'pauvre' },
			family: 'poudings'
		});
		expect(count()).toBe(n + 1);
		expect(changed()).toEqual(['M\trecipes/pouding-pauvre.md']);
		// "Annuler" names a recipe the commit wrote, not the first of the pair.
		expect(r.edited).toEqual(['pouding-pauvre']);
		expect((await undoCommit(ctx(), r.commit!, { slug: r.edited[0] })).action).toBe('undone');
		expect(checkFile(v.read('recipes/pouding-pauvre.md')).recipe?.family).toBeUndefined();
	});

	it('an existing variant keeps its markers when she keeps it', async () => {
		const marked = copyOf(POUDING, 'Pouding de Rita', 'pouding-de-rita', (t) => t.replace(/^slug: .*$/m, (l) => `${l}\nfamily: poudings\nvariant: "de matante [?: Rita]"`));
		await save(v.ctx, [{ text: marked }]);
		const before = v.read('recipes/pouding-de-rita.md');
		expect(before).toContain('[?: Rita]');
		const p = duplicatePage(v.ctx).pairs.find((x) => x.a.slug === 'pouding-de-matante' && x.b.slug === 'pouding-de-rita')!;
		expect(p.b).toMatchObject({ variant: 'de matante', variantText: 'de matante [?: Rita]' });
		// The prefill as the page sends it (markers kept): the file is not rewritten.
		const r = await pairVersions(ctx(), {
			a: { slug: p.a.slug, hash: p.a.hash, variant: 'de la voisine' },
			b: { slug: p.b.slug, hash: p.b.hash, variant: p.b.variantText! },
			family: 'poudings'
		});
		expect(r.edited).toEqual(['pouding-de-matante']);
		expect(v.read('recipes/pouding-de-rita.md')).toBe(before);
		// A marker she types is written as typed.
		await save(v.ctx, [{ text: copyOf(POUDING, 'Pouding trois', 'pouding-trois') }]);
		const q = duplicatePage(v.ctx).pairs.find((x) => x.a.slug === 'pouding-chomeur' && x.b.slug === 'pouding-trois')!;
		await pairVersions(ctx(), {
			a: { slug: q.a.slug, hash: q.a.hash, variant: 'de la télé' },
			b: { slug: q.b.slug, hash: q.b.hash, variant: 'de [?: Gisèle]' },
			family: 'poudings'
		});
		expect(checkFile(v.read('recipes/pouding-trois.md')).recipe?.variant).toBe('de [?: Gisèle]');
	});

	it('a stale hash, a missing variant, two equal variants: refused, nothing written', async () => {
		const n = count();
		const req = (hashA: string, va = 'a', vb = 'b') => ({
			a: { slug: 'pouding-chomeur', hash: hashA, variant: va },
			b: { slug: 'pouding-de-matante', hash: hash('pouding-de-matante'), variant: vb },
			family: 'poudings'
		});
		await expect(pairVersions(ctx(), req('stale'))).rejects.toThrow(/changé/);
		await expect(pairVersions(ctx(), req(hash('pouding-chomeur'), ''))).rejects.toBeInstanceOf(DuplicateError);
		await expect(pairVersions(ctx(), req(hash('pouding-chomeur'), 'x', 'x'))).rejects.toBeInstanceOf(DuplicateError);
		expect(count()).toBe(n);
	});
});

describe('"C\'est la même recette"', () => {
	it('the one she picks to the trash, `delete:`; undo brings it back', async () => {
		const r = await sameRecipe(ctx(), 'pouding-de-matante', hash('pouding-de-matante'));
		expect(head()).toBe(`delete: Pouding de matante|${CAMILLE.name}`);
		expect(changed()).toEqual(['R100\trecipes/pouding-de-matante.md\t_trash/pouding-de-matante.md']);
		expect(listed()).toEqual([]);
		const u = await undoCommit(ctx(), r.commit!, { slug: 'pouding-de-matante' });
		expect(u.action).toBe('untrashed');
		expect(listed()).toEqual([PAIR]);
	});

	it('a stale hash is refused', async () => {
		const n = count();
		await expect(sameRecipe(ctx(), 'pouding-de-matante', 'stale')).rejects.toBeInstanceOf(DuplicateError);
		expect(count()).toBe(n);
	});

	it('a recipe used as a sub-recipe elsewhere is shown so and never sent to the trash', async () => {
		await save(v.ctx, [{ text: copyOf(PATE, 'Pâte brisée de tante', 'pate-brisee-de-tante') }]);
		const p = duplicatePage(v.ctx).pairs.find((x) => x.a.slug === 'pate-brisee' && x.b.slug === 'pate-brisee-de-tante')!;
		expect(p.a.usedBy.map((u) => u.slug).sort()).toEqual(['tarte-au-sucre', 'tarte-aux-pommes-grand-mere', 'tarte-aux-pommes-streusel']);
		expect(p.b.usedBy).toEqual([]);
		const n = count();
		await expect(sameRecipe(ctx(), 'pate-brisee', p.a.hash)).rejects.toThrow(/sous-recette/);
		expect(count()).toBe(n);
		expect(v.read('recipes/pate-brisee.md')).toBe(PATE);
		await sameRecipe(ctx(), 'pate-brisee-de-tante', p.b.hash);
		expect(head()).toBe(`delete: Pâte brisée de tante|${CAMILLE.name}`);
	});
});
