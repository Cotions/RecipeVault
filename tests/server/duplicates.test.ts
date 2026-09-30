// The duplicate model from the index (plan 05, Phase 5): rebuilt after a save
// and after a registry edit, family pairs per Q16 C, and the fast path equal
// to brute force on a 300-recipe generated vault. W505 (Phase 6) on the paste
// check, the form's check and the save result.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { copyOf } from '../helpers/duplicates';
import { AUTHOR, fixtureVault, type TempVault } from '../helpers/vault';

const POUDING = readFileSync('tests/fixtures/vault/recipes/pouding-chomeur.md', 'utf8');


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

// An invented card no fixture recipe is close to: two copies of it in one paste.
const GALETTES = `---
schema: 3
title: Galettes à l'avoine
slug: galettes-a-l-avoine
lang: fr
oven: { temp: 350, unit: F }
ingredients:
  - items:
      - { qty: 2, unit: cup, name: flocons d'avoine }
      - { qty: 1, unit: cup, name: raisins secs }
      - { qty: 1, unit: cup, name: cassonade }
      - { qty: "1/2", unit: cup, name: beurre }
      - { qty: 1, unit: tsp, name: bicarbonate de soude }
      - { qty: 1, unit: piece, name: œuf }
extracted_by: ai
---

## Préparation

1. Crémer le beurre et la cassonade, ajouter l'œuf.
2. Incorporer les flocons, le bicarbonate et les raisins.
3. Façonner en galettes, cuire 12 minutes à 350 °F.
`;
const GALETTES_2 = copyOf(GALETTES, 'Biscuits de grand-maman', 'biscuits-de-grand-maman');

describe('W505 inside one paste (issue #13)', () => {
	const w505 = (ds: Diagnostic[]) => ds.filter((d) => d.code === 'W505');

	it('the second copy names the first, by its place in the paste; the first names nothing', async () => {
		v = await fixtureVault();
		const [a, b] = serverCheck({ ctx: v.ctx } as App, [GALETTES, GALETTES_2]);
		expect(w505(a.diagnostics)).toEqual([]);
		expect(a.closeInBatch).toBeUndefined();
		expect(b.closeInBatch).toEqual([{ index: 0, title: "Galettes à l'avoine", score: 1 }]);
		expect(w505(b.diagnostics).map((d) => d.message)).toEqual(['nearly the same ingredients as recipe 1 of this batch (100 % in common, weighted) — possible duplicate.']);
		// Nothing from the vault: no close recipe, no pair offer.
		expect(b.close).toBeUndefined();
		expect(aiDiagnostics(b.diagnostics)).toEqual([]);
	});

	it('a file far from the others, or a two-line file, is not named', async () => {
		v = await fixtureVault();
		const [, b, c] = serverCheck({ ctx: v.ctx } as App, [GALETTES, POUDING.replace('slug: pouding-chomeur', 'slug: pouding-2').replace('title: Pouding chômeur', 'title: Pouding deux'), copyOf(GALETTES, 'Galettes courtes', 'galettes-courtes', (t) => t.replace(/ {6}- \{ qty: 1, unit: cup, name: (raisins secs|cassonade) \}\n/g, '').replace(/ {6}- \{ qty: (\"1\/2\"|1), unit: (cup|tsp|piece), name: (beurre|bicarbonate de soude|œuf) \}\n/g, ''))]);
		expect(b.closeInBatch).toBeUndefined();
		expect(c.closeInBatch).toBeUndefined();
	});

	it('two copies of the same card with one slug (E103 in the paste) still name each other', async () => {
		v = await fixtureVault();
		const [, b] = serverCheck({ ctx: v.ctx } as App, [GALETTES, GALETTES]);
		expect(b.diagnostics.map((d) => d.code)).toContain('E103');
		expect(b.closeInBatch?.map((c) => c.index)).toEqual([0]);
	});

	it('a pair settled as different recipes is not named inside a paste either', async () => {
		v = await fixtureVault();
		writeFileSync(join(v.ctx.paths.root, DISTINCT_FILE), '- [biscuits-de-grand-maman, galettes-a-l-avoine]\n');
		const [, b] = serverCheck({ ctx: v.ctx } as App, [GALETTES, GALETTES_2]);
		expect(b.closeInBatch).toBeUndefined();
		expect(w505(b.diagnostics)).toEqual([]);
	});

	it('the save result names the earlier saved file of the batch; a file not saved is not named', async () => {
		v = await fixtureVault();
		const r = await save(v.ctx, [{ text: GALETTES }, { text: GALETTES_2, name: 'b.md' }]);
		expect(r.files.map((f) => f.status)).toEqual(['saved', 'saved']);
		expect(w505(r.files[0].diagnostics)).toEqual([]);
		expect(w505(r.files[1].diagnostics)[0].message).toContain('recipe 1 of this batch (100 % in common, weighted)');
		const named = await save(v.ctx, [{ text: copyOf(GALETTES, 'Galettes trois', 'galettes-trois'), name: 'trois.md' }, { text: copyOf(GALETTES, 'Galettes quatre', 'galettes-quatre') }]);
		expect(w505(named.files[1].diagnostics)[0].message).toContain('trois.md of this batch');
		// A first file refused (an error) is not in the commit: the second does not name it.
		const bad = copyOf(GALETTES, 'Galettes cinq', 'galettes-cinq', (t) => t.replace('unit: cup, name: raisins', 'unit: tasse, name: raisins'));
		const r2 = await save(v.ctx, [{ text: bad }, { text: copyOf(GALETTES, 'Galettes six', 'galettes-six') }]);
		expect(r2.files.map((f) => f.status)).toEqual(['rejected', 'saved']);
		expect(w505(r2.files[1].diagnostics)[0].message).not.toContain('of this batch');
	});
});

describe('a copy with ingredients swapped: the same method flags it (issue #13)', () => {
	const w505 = (ds: Diagnostic[]) => ds.filter((d) => d.code === 'W505');
	// One line swapped for another: under the threshold on ingredients alone (the swapped pair weigh the most, being rare).
	const swapped = (title: string, slug: string, method?: string) =>
		copyOf(GALETTES, title, slug, (t) => {
			const out = t.replace('name: raisins secs', 'name: dattes hachées');
			return method ? out.replace(/## Préparation[\s\S]*$/, `## Préparation\n\n${method}\n`) : out;
		});

	it('named on paste and listed on the page when the method is the same text; not with another method', async () => {
		v = await fixtureVault();
		await save(v.ctx, [{ text: GALETTES }]);
		const [f] = serverCheck({ ctx: v.ctx } as App, [swapped('Biscuits aux dattes', 'biscuits-aux-dattes')]);
		expect(f.close?.map((c) => c.slug)).toEqual(['galettes-a-l-avoine']);
		expect(f.close![0].score).toBeLessThan(DUPLICATE_THRESHOLD);
		expect(w505(f.diagnostics)[0].message).toMatch(/galettes-a-l-avoine \(\d+ % in common, weighted; the same method\)/);
		const [g] = serverCheck({ ctx: v.ctx } as App, [swapped('Biscuits aux dattes', 'biscuits-aux-dattes', '1. Tout mélanger au robot, étaler dans un moule carré et cuire trente minutes; couper en barres une fois refroidi.')]);
		expect(g.close).toBeUndefined();
		// Saved, the pair is on the page, marked as found by its method.
		await save(v.ctx, [{ text: swapped('Biscuits aux dattes', 'biscuits-aux-dattes') }]);
		expect(allPairs(v.ctx.db).filter(pairOf('galettes-a-l-avoine', 'biscuits-aux-dattes'))).toEqual([expect.objectContaining({ method: true })]);
	});

	it('inside one paste too', async () => {
		v = await fixtureVault();
		const [, b] = serverCheck({ ctx: v.ctx } as App, [GALETTES, swapped('Biscuits aux dattes', 'biscuits-aux-dattes')]);
		expect(b.closeInBatch?.map((c) => c.index)).toEqual([0]);
	});
});

describe('vault add with several files (issue #13)', () => {
	it('prints W505 under the second copy, naming the first file by its path', async () => {
		v = await fixtureVault();
		const tmp = mkdtempSync(join(tmpdir(), 'rv-add-'));
		try {
			// An invented config: the CLI never reads the person's own.
			const config = join(tmp, 'config.json');
			writeFileSync(config, JSON.stringify({ git_author: { name: 'Test Author', email: 'test@example.invalid' } }));
			writeFileSync(join(tmp, 'a.md'), GALETTES);
			writeFileSync(join(tmp, 'b.md'), GALETTES_2);
			const r = spawnSync(process.execPath, ['bin/vault.js', 'add', '--vault', v.dir, join(tmp, 'a.md'), join(tmp, 'b.md')], {
				encoding: 'utf8',
				env: { ...process.env, NO_COLOR: '1', RECIPEVAULT_CONFIG: config, HOME: tmp }
			});
			expect(r.status, r.stderr).toBe(0);
			const lines = r.stdout.split('\n');
			const b = lines.findIndex((l) => l.includes('b.md → recipes/biscuits-de-grand-maman.md'));
			expect(b).toBeGreaterThan(0);
			expect(lines[b + 1]).toBe(`  W505 nearly the same ingredients as ${join(tmp, 'a.md')} of this batch (100 % in common, weighted) — possible duplicate.`);
			expect(lines.filter((l) => l.includes('W505'))).toHaveLength(1);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	}, 30_000);
});

describe('"Mettre en famille" from the paste box puts both in the family (issue #13)', () => {
	const COPY = () => copyOf(POUDING, 'Pouding du chômeur de matante', 'pouding-de-matante');

	it('the check offers the vault recipe with its hash and variant: same title first, else the closest', async () => {
		v = await fixtureVault();
		const [f] = serverCheck({ ctx: v.ctx } as App, [COPY()]);
		expect(f.pairWith).toEqual({ slug: 'pouding-chomeur', title: 'Pouding chômeur', hash: readHash(v, 'pouding-chomeur'), family: null, variant: null });
		// Same title as a vault recipe (W608), ingredients unrelated: that recipe is the one offered.
		const [g] = serverCheck({ ctx: v.ctx } as App, [copyOf(GALETTES, 'Crêpes minces', 'crepes-de-galettes')]);
		expect(g.diagnostics.map((d) => d.code)).toContain('W608');
		expect(g.pairWith?.slug).toBe('crepes');
		// Its slug taken by a recipe of the same title: offered too (for "Enregistrer comme").
		const [h] = serverCheck({ ctx: v.ctx } as App, [POUDING]);
		expect(h.collision?.existing).toBeTruthy();
		expect(h.pairWith?.slug).toBe('pouding-chomeur');
	});

	it('both recipes in the family, one commit', async () => {
		v = await fixtureVault();
		const [f] = serverCheck({ ctx: v.ctx } as App, [COPY()]);
		const other = f.pairWith!;
		const r = await save(v.ctx, [{ text: COPY(), family: { family: 'pouding-chomeur', variant: 'de matante', pair: { slug: other.slug, hash: other.hash, variant: 'de la télé' } } }]);
		expect(r.files[0].status).toBe('saved');
		expect(v.git('show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort()).toEqual(['recipes/pouding-chomeur.md', 'recipes/pouding-de-matante.md']);
		expect(v.git('log', '-1', '--format=%s')).toMatch(/^add: Pouding du chômeur de matante; edit: Pouding chômeur/);
		const mine = v.read('recipes/pouding-de-matante.md');
		expect(mine).toMatch(/^family: pouding-chomeur$/m);
		expect(mine).toMatch(/^variant: de matante$/m);
		expect(mine).not.toMatch(/^pair:/m);
		const theirs = v.read('recipes/pouding-chomeur.md');
		expect(theirs).toMatch(/^family: pouding-chomeur$/m);
		expect(theirs).toMatch(/^variant: de la télé$/m);
		expect(theirs).toMatch(/^status: verified$/m);
		// Indexed: the family page has both.
		expect(v.ctx.db.prepare('SELECT slug FROM recipes WHERE family = ? ORDER BY slug').pluck().all('pouding-chomeur')).toEqual(['pouding-chomeur', 'pouding-de-matante']);
	});

	it('refused when the other recipe changed since the check: nothing saved, nothing committed', async () => {
		v = await fixtureVault();
		const head = v.git('rev-parse', 'HEAD');
		const r = await save(v.ctx, [{ text: COPY(), family: { family: 'pouding-chomeur', variant: 'de matante', pair: { slug: 'pouding-chomeur', hash: 'f'.repeat(64), variant: 'originale' } } }]);
		expect(r.files[0]).toMatchObject({ status: 'stale', slug: 'pouding-de-matante', pair: { slug: 'pouding-chomeur', reason: 'stale' } });
		expect(v.git('rev-parse', 'HEAD')).toBe(head);
		expect(existsSync(join(v.dir, 'recipes/pouding-de-matante.md'))).toBe(false);
		// Gone, or the same version name twice: refused too.
		const gone = await save(v.ctx, [{ text: COPY(), family: { family: 'x', variant: 'a', pair: { slug: 'pas-la', hash: 'f'.repeat(64), variant: 'b' } } }]);
		expect(gone.files[0].status === 'stale' && gone.files[0].pair?.reason).toBe('gone');
		const same = await save(v.ctx, [{ text: COPY(), family: { family: 'x', variant: 'Pareil', pair: { slug: 'pouding-chomeur', hash: readHash(v, 'pouding-chomeur'), variant: 'pareil ' } } }]);
		expect(same.files[0].status === 'stale' && same.files[0].pair?.reason).toBe('variant');
		expect(v.git('rev-parse', 'HEAD')).toBe(head);
	});

	it('two files pairing one recipe: the second is refused unless it asks the same; a recipe already that version is not rewritten', async () => {
		v = await fixtureVault();
		const hash = readHash(v, 'pouding-chomeur');
		const pair = { slug: 'pouding-chomeur', hash, variant: 'de la télé' };
		const r = await save(v.ctx, [
			{ text: COPY(), family: { family: 'pouding-chomeur', variant: 'de matante', pair } },
			{ text: copyOf(POUDING, 'Pouding pauvre', 'pouding-pauvre'), family: { family: 'autre', variant: 'pauvre', pair } },
			{ text: copyOf(POUDING, 'Pouding de ma tante', 'pouding-de-ma-tante'), family: { family: 'pouding-chomeur', variant: 'de ma tante', pair } }
		]);
		expect(r.files.map((f) => f.status)).toEqual(['saved', 'stale', 'saved']);
		expect(r.files[1].status === 'stale' && r.files[1].pair?.reason).toBe('busy');
		expect(v.git('show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort()).toEqual([
			'recipes/pouding-chomeur.md',
			'recipes/pouding-de-ma-tante.md',
			'recipes/pouding-de-matante.md'
		]);
		// Already "de la télé" in that family: the next pair leaves its file as it is.
		const now = readHash(v, 'pouding-chomeur');
		await save(v.ctx, [{ text: copyOf(POUDING, 'Pouding trois', 'pouding-trois'), family: { family: 'pouding-chomeur', variant: 'trois', pair: { ...pair, hash: now } } }]);
		expect(v.git('show', '--name-only', '--format=', 'HEAD').trim()).toBe('recipes/pouding-trois.md');
	});
});

function readHash(t: TempVault, slug: string): string {
	return t.ctx.db.prepare('SELECT file_hash FROM recipes WHERE slug = ?').pluck().get(slug) as string;
}
