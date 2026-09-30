// The duplicate model from the index (plan 05, Phase 5): rebuilt after a save
// and after a registry edit, family pairs per Q16 C, and the fast path equal
// to brute force on a 300-recipe generated vault. W505 (Phase 6) on the paste
// check, the form's check and the save result.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DUPLICATE_THRESHOLD, rarityWeights, similarPairs, similarPairsBrute, weightOf } from '../../src/lib/ingredients/similar';
import type { App } from '../../src/lib/server/app';
import { openVault } from '../../src/lib/server/context';
import { DISTINCT_FILE } from '../../src/lib/server/duplicates';
import { formCheck, formSave, openForm } from '../../src/lib/server/formsave';
import { serverCheck } from '../../src/lib/server/paste';
import { aiDiagnostics } from '../../src/lib/vault/fixblock';
import { fixerOf } from '../../src/lib/vault/codes';
import type { Diagnostic } from '../../src/lib/vault/types';
import { allPairs, duplicateModel, pairDetail } from '../../src/lib/server/index/similar';
import { syncVault } from '../../src/lib/server/index/sync';
import { linkKey } from '../../src/lib/server/queue';
import { save } from '../../src/lib/server/save';
import { AUTHOR, fixtureVault, type TempVault } from '../helpers/vault';

const POUDING = readFileSync('tests/fixtures/vault/recipes/pouding-chomeur.md', 'utf8');

/** The fixture's pouding chômeur under another title and slug (a second paste of one card). */
export function copyOf(text: string, title: string, slug: string, change: (t: string) => string = (t) => t): string {
	return change(text.replace(/^title: .*$/m, `title: ${title}`).replace(/^slug: .*$/m, `slug: ${slug}`));
}

let v: TempVault | undefined;
afterEach(() => {
	v?.cleanup();
	v = undefined;
});

const pairOf = (a: string, b: string) => (p: { a: string; b: string }) => (p.a === a && p.b === b) || (p.a === b && p.b === a);

describe('duplicate model from the index', () => {
	it('the fixture vault has no pair; a second paste of one card makes one, after the save', async () => {
		v = await fixtureVault();
		expect(allPairs(v.ctx.db)).toEqual([]);
		const r = await save(v.ctx, [{ text: copyOf(POUDING, 'Pouding du chômeur de matante', 'pouding-de-matante') }]);
		expect(r.files[0].status).toBe('saved');
		const pairs = allPairs(v.ctx.db);
		expect(pairs.map((p) => [p.a, p.b, p.score])).toEqual([['pouding-chomeur', 'pouding-de-matante', 1]]);
		const d = pairDetail(duplicateModel(v.ctx.db), pairs[0]);
		expect(d.shared).toContain('cassonade');
		expect(d.onlyA).toEqual([]);
	});

	it('a registry edit ("Relier" in the queue) can make a pair', async () => {
		v = await fixtureVault();
		const misspelled = copyOf(POUDING, 'Pouding pauvre', 'pouding-pauvre', (t) =>
			t.replace('name: cassonade }', 'name: cassonnade }').replace('name: farine }', 'name: farinne }').replace(/name: beurre([ ,])/g, 'name: beure$1')
		);
		await save(v.ctx, [{ text: misspelled }]);
		expect(allPairs(v.ctx.db).filter(pairOf('pouding-chomeur', 'pouding-pauvre'))).toEqual([]);
		for (const [key, slug] of [
			['cassonnade', 'cassonade'],
			['farinne', 'farine'],
			['beure', 'beurre']
		])
			await linkKey(v.ctx, key, slug);
		expect(allPairs(v.ctx.db).filter(pairOf('pouding-chomeur', 'pouding-pauvre')).map((p) => p.score)).toEqual([1]);
	});

	it('two recipes of one family pair only when they are the same card twice (Q16 C)', async () => {
		v = await fixtureVault();
		const fam = (title: string, slug: string, qty = '2') =>
			copyOf(POUDING, title, slug, (t) => t.replace('lang: fr\n', 'lang: fr\nfamily: pouding-test\n' + `variant: ${slug}\n`).replace('{ qty: 2, unit: cup, name: cassonade }', `{ qty: ${qty}, unit: cup, name: cassonade }`));
		await save(v.ctx, [{ text: fam('Pouding A', 'pouding-a') }, { text: fam('Pouding B', 'pouding-b', '3') }, { text: fam('Pouding C', 'pouding-c') }]);
		const pairs = allPairs(v.ctx.db);
		// A and C: the same card twice in one family, kept; A–B and B–C: versions, left out.
		expect(pairs.some(pairOf('pouding-a', 'pouding-c'))).toBe(true);
		expect(pairs.some(pairOf('pouding-a', 'pouding-b'))).toBe(false);
		expect(pairs.some(pairOf('pouding-b', 'pouding-c'))).toBe(false);
		// Outside the family, B still pairs with the original.
		expect(pairs.some(pairOf('pouding-b', 'pouding-chomeur'))).toBe(true);
	});
});

describe('prefix filtering on a generated vault', () => {
	it('finds exactly the pairs brute force finds (300 recipes, every pair checked)', () => {
		const dir = join(mkdtempSync(join(tmpdir(), 'rv-dup-gen-')), 'vault');
		try {
			execFileSync('npx', ['tsx', 'scripts/gen-vault.ts', '300', '--dir', dir], { stdio: 'ignore' });
			const ctx = openVault({ root: dir, author: AUTHOR, log: () => {} });
			try {
				syncVault(ctx.db, ctx.paths);
				const m = duplicateModel(ctx.db);
				const list = [...m.recipes.values()];
				expect(list.length).toBe(300);
				const w = rarityWeights(list);
				const weight = (e: string) => weightOf(w, list.length, e);
				expect(m.pairs).toEqual(similarPairsBrute(list, weight, DUPLICATE_THRESHOLD));
				for (const t of [0.2, 0.35, 0.5]) {
					const brute = similarPairsBrute(list, weight, t);
					expect(similarPairs(list, weight, t)).toEqual(brute);
					if (t === 0.2) expect(brute.length).toBeGreaterThan(10);
				}
			} finally {
				ctx.db.close();
			}
		} finally {
			rmSync(join(dir, '..'), { recursive: true, force: true });
		}
	}, 60_000);
});

describe('W505 — nearly the same ingredients (Phase 6)', () => {
	const COPY = () => copyOf(POUDING, 'Pouding du chômeur de matante', 'pouding-de-matante');
	const w505 = (ds: Diagnostic[]) => ds.filter((d) => d.code === 'W505');

	it('the paste check names the other recipe, with its hash; never the fix-request block', async () => {
		v = await fixtureVault();
		const [f] = serverCheck({ ctx: v.ctx } as App, [COPY()]);
		expect(w505(f.diagnostics)).toHaveLength(1);
		expect(w505(f.diagnostics)[0].message).toContain('pouding-chomeur (100 % in common, weighted)');
		expect(f.close?.map((c) => [c.slug, c.score])).toEqual([['pouding-chomeur', 1]]);
		expect(f.close?.[0].hash).toMatch(/^[0-9a-f]{64}$/);
		expect(fixerOf('W505')).toBe('app');
		expect(aiDiagnostics(f.diagnostics)).toEqual([]);
	});

	it('a file pasted over itself is not its own duplicate', async () => {
		v = await fixtureVault();
		const [f] = serverCheck({ ctx: v.ctx } as App, [POUDING]);
		expect(w505(f.diagnostics)).toEqual([]);
		expect(f.close).toBeUndefined();
	});

	it('the save result carries it; the vault after the save has the pair', async () => {
		v = await fixtureVault();
		const r = await save(v.ctx, [{ text: COPY() }]);
		expect(r.files[0].status).toBe('saved');
		expect(w505(r.files[0].status === 'saved' ? r.files[0].diagnostics : []).map((d) => d.path)).toEqual(['ingredients']);
		// Saved again over itself (an edit): the other one is still named, never itself.
		const again = await save(v.ctx, [{ text: COPY(), overwrite: readHash(v, 'pouding-de-matante') }]);
		const d = again.files[0].status === 'saved' ? w505(again.files[0].diagnostics) : [];
		expect(d).toHaveLength(1);
		expect(d[0].message).toContain('pouding-chomeur');
		expect(d[0].message).not.toContain('pouding-de-matante');
	});

	it('the form check hints it on the ingredients, with the pair offer; an edit is not its own duplicate', async () => {
		v = await fixtureVault();
		const o = openForm(v.ctx, 'pouding-chomeur');
		if (!('form' in o)) throw new Error('cannot open');
		const mine = { ...o.form, title: 'Pouding de matante' };
		const c = formCheck(v.ctx, mine);
		expect(c.hints.filter((h) => h.code === 'W505')).toEqual([{ code: 'W505', target: 'recipe', field: 'ingredients', value: 'Pouding chômeur', slug: 'pouding-chomeur' }]);
		expect(c.close.map((x) => x.slug)).toEqual(['pouding-chomeur']);
		const edit = formCheck(v.ctx, o.form, { slug: 'pouding-chomeur', hash: o.hash });
		expect(edit.hints.filter((h) => h.code === 'W505')).toEqual([]);
		expect(edit.close).toEqual([]);
		// Saved from the form: the hint comes back with the result.
		const r = await formSave(v.ctx, { form: mine });
		expect(r.status).toBe('saved');
		expect(r.status === 'saved' && r.hints.filter((h) => h.code === 'W505').map((h) => h.slug)).toEqual(['pouding-chomeur']);
	});

	it('"En faire deux versions" from the form: both recipes in one family, one commit', async () => {
		v = await fixtureVault();
		const o = openForm(v.ctx, 'pouding-chomeur');
		if (!('form' in o)) throw new Error('cannot open');
		const mine = { ...o.form, title: 'Pouding de matante', family: 'pouding-de-matante', variant: 'de matante' };
		const [other] = formCheck(v.ctx, mine).close;
		const r = await formSave(v.ctx, { form: mine, familyLabel: 'Pouding de matante', pair: { slug: other.slug, hash: other.hash, variant: 'original' } });
		expect(r.status).toBe('saved');
		expect(v.git('show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort()).toEqual([
			'recipes/pouding-chomeur.md',
			'recipes/pouding-de-matante.md',
			'vocab/families.yaml'
		]);
		expect(v.read('recipes/pouding-chomeur.md')).toMatch(/^family: pouding-de-matante$/m);
		// One family, amounts identical: still the same card twice (Q16 C), so the pair stays listed.
		expect(allPairs(v.ctx.db).filter(pairOf('pouding-chomeur', 'pouding-de-matante'))).toHaveLength(1);
	});

	it('a pair settled as different recipes is never named again', async () => {
		v = await fixtureVault();
		await save(v.ctx, [{ text: COPY() }]);
		writeFileSync(join(v.ctx.paths.root, DISTINCT_FILE), '- [pouding-chomeur, pouding-de-matante]\n');
		const [f] = serverCheck({ ctx: v.ctx } as App, [copyOf(POUDING, 'Pouding de matante', 'pouding-de-matante')]);
		expect(w505(f.diagnostics)).toEqual([]);
		// A third copy still pairs with both.
		const [g] = serverCheck({ ctx: v.ctx } as App, [copyOf(POUDING, 'Pouding pauvre', 'pouding-pauvre')]);
		expect(g.close?.map((c) => c.slug).sort()).toEqual(['pouding-chomeur', 'pouding-de-matante']);
	});
});

function readHash(t: TempVault, slug: string): string {
	return t.ctx.db.prepare('SELECT file_hash FROM recipes WHERE slug = ?').pluck().get(slug) as string;
}
