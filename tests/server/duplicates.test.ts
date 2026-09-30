// The duplicate model from the index (plan 05, Phase 5): rebuilt after a save
// and after a registry edit, family pairs per Q16 C, and the fast path equal
// to brute force on a 300-recipe generated vault.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DUPLICATE_THRESHOLD, rarityWeights, similarPairs, similarPairsBrute, weightOf } from '../../src/lib/ingredients/similar';
import { openVault } from '../../src/lib/server/context';
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
