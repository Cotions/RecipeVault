// The pair list and its actions (plan 05, Phase 7): each action one commit by
// the signed-in person touching only what it names, hash-guarded, undoable; a
// settled pair gone from the list and from W505, and still gone after the
// cache is deleted.

import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../../src/lib/server/app';
import { withAuthor } from '../../src/lib/server/context';
import { DISTINCT_FILE, dismissPair, DuplicateError, duplicateCount, duplicatePage, pairVersions, parseDistinct, sameRecipe, undismissPair } from '../../src/lib/server/duplicates';
import { undoCommit } from '../../src/lib/server/history';
import { syncVault } from '../../src/lib/server/index/sync';
import { serverCheck } from '../../src/lib/server/paste';
import { save } from '../../src/lib/server/save';
import { checkFile } from '../../src/lib/vault/check';
import { fixtureVault, type TempVault } from '../helpers/vault';
import { copyOf } from '../helpers/duplicates';

const POUDING = readFileSync('tests/fixtures/vault/recipes/pouding-chomeur.md', 'utf8');
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
		const [f] = serverCheck({ ctx: v.ctx } as App, [copyOf(POUDING, 'Pouding de matante', 'pouding-de-matante')]);
		expect(f.diagnostics.filter((d) => d.code === 'W505')).toEqual([]);

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
		await pairVersions(ctx(), {
			a: { slug: 'pouding-chomeur', hash: p.a.hash, variant: 'original' },
			b: { slug: 'pouding-pauvre', hash: p.b.hash, variant: 'pauvre' },
			family: 'poudings'
		});
		expect(count()).toBe(n + 1);
		expect(changed()).toEqual(['M\trecipes/pouding-pauvre.md']);
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
});
