import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseIngredient, withName, withoutKey, withRule } from '../../src/lib/ingredients/registry';
import { resolutionDiagnostics } from '../../src/lib/ingredients/resolve';
import { getResolver } from '../../src/lib/server/index/resolve';
import { addRule, createFromKey, linkKey, queueCount, QueueError, resolveQueue, unlinkKey } from '../../src/lib/server/queue';
import { loadVocab } from '../../src/lib/server/vocab';
import { fixtureVault, type TempVault } from '../helpers/vault';

let v: TempVault;
beforeEach(async () => {
	v = await fixtureVault();
});
afterEach(() => v.cleanup());

const vocab = () => loadVocab(v.ctx.paths.vocab);
const queue = () => resolveQueue(v.ctx.db, vocab(), { limit: 1000 });
const row = (key: string) => queue().rows.find((r) => r.key === key);
const line = (slug: string, name: string) => v.ctx.db.prepare('SELECT item, resolution FROM ingredients WHERE slug = ? AND name = ?').get(slug, name);
const lastCommit = () => v.git('log', '-1', '--format=%s').trim();
const hashOf = (slug: string) => v.ctx.db.prepare('SELECT file_hash FROM registry WHERE slug = ?').pluck().get(slug) as string;
const recipesTouched = () => v.git('show', '--name-only', '--format=', 'HEAD').trim().split('\n');

describe('edits of an ingredient file', () => {
	const text = '---\nslug: sel\n# a comment\ncategory: epice\nnames:\n  fr: [sel]\n  en: [salt]\nstaple: true\nsubstitutes: []\nallergens: []\n---\n\nBody.\n';
	it('adds a name, keeping comments and the body; unchanged when the key is already there', () => {
		const out = withName(text, 'fr', 'gros  sel');
		expect(out).toContain('# a comment');
		expect(out).toContain('  fr: [sel, gros sel]');
		expect(out.endsWith('\nBody.\n')).toBe(true);
		expect(withName(text, 'fr', 'SEL')).toBe(text);
		expect(withName(text, 'en', 'Sel')).toBe(text);
	});
	it('removes every alias with a key, in any language', () => {
		expect(withoutKey(text, 'salt')).toContain('  en: []');
		expect(withoutKey(text, 'poivre')).toBe(text);
	});
	it('adds a rule after names, once, and the file still reads', () => {
		const out = withRule(text, { names: ['gros  sel'], unit: ['container'], words: ['moulu'] });
		expect(out).toContain('  en: [salt]\nwhen:\n  - {names: [gros sel], unit: [container], words: [moulu]}\nstaple: true');
		expect(out).toContain('# a comment');
		expect(withRule(out, { names: ['gros sel'], unit: ['container'], words: ['moulu'] })).toBe(out);
		const again = withRule(out, { names: ['sel'], lang: 'en' });
		expect(again).toContain('  - {names: [sel], lang: en}');
		const r = parseIngredient(again, { fileStem: 'sel' });
		expect(r.diagnostics).toEqual([]);
		expect(r.entry!.when).toEqual([
			{ names: ['gros sel'], unit: ['container'], words: ['moulu'] },
			{ names: ['sel'], lang: 'en' }
		]);
	});
});

describe('the resolve queue', () => {
	it('lists unresolved and ambiguous keys, most frequent first, with forms, counts and candidates', () => {
		const { total, rows } = queue();
		expect(total).toBe(queueCount(v.ctx.db));
		expect(rows.map((r) => r.count)).toEqual([...rows.map((r) => r.count)].sort((a, b) => b - a));
		const lasagne = row('feuilles de lasagne')!;
		expect(lasagne).toMatchObject({ count: 3, recipes: 3, lang: 'fr', ambiguous: false });
		expect(lasagne.forms).toEqual([{ name: 'feuilles de lasagne', count: 3 }]);
		const huile = row('huile')!;
		expect(huile.ambiguous).toBe(true);
		expect(huile.candidates.map((c) => c.slug)).toEqual(['huile-d-olive', 'huile-vegetale']);
		expect(huile.candidates[0].hash).toMatch(/^[0-9a-f]{64}$/);
		// Sub-recipe lines are never in the queue; English recipes are.
		expect(row('pate brisee')).toBeUndefined();
		expect(row('baking soda')).toMatchObject({ lang: 'en', count: 2 });
		// Markers are stripped from the written form.
		expect(row('sarriette')!.forms[0].name).toBe('sarriette');
		// A near name is suggested.
		expect(row('tomates entieres')!.candidates.map((c) => c.slug)).toContain('tomates-fraiches');
	});

	it('links a name to an entry: one commit, only the ingredient file, every recipe re-resolved', async () => {
		const before = queueCount(v.ctx.db);
		await linkKey(v.ctx, 'feuilles de lasagne', 'pates-alimentaires', hashOf('pates-alimentaires'));
		expect(lastCommit()).toBe('ingredient: pates-alimentaires + "feuilles de lasagne"');
		expect(recipesTouched()).toEqual(['ingredients/pates-alimentaires.md']);
		expect(v.read('ingredients/pates-alimentaires.md')).toContain('fr: [pâtes, feuilles de lasagne]');
		for (const r of ['lasagna-bolognaise', 'lasagna-courgettes', 'lasagna-epinards-ricotta'])
			expect(line(r, 'feuilles de lasagne')).toEqual({ item: 'pates-alimentaires', resolution: 'alias' });
		expect(queueCount(v.ctx.db)).toBe(before - 1);
		expect(v.git('status', '--porcelain').trim()).toBe('');
		// The recipes using it lose their warning.
		const recipe = JSON.parse(v.ctx.db.prepare("SELECT data_json FROM recipes WHERE slug = 'lasagna-courgettes'").pluck().get() as string);
		const d = resolutionDiagnostics(recipe, getResolver(v.ctx.db, vocab()));
		expect(d.filter((x) => x.message.includes('feuilles de lasagne'))).toEqual([]);
	});

	it('adds an English name under en, from the language of the recipes using it', async () => {
		await linkKey(v.ctx, 'baking soda', 'sel');
		expect(v.read('ingredients/sel.md')).toContain('en: [salt, baking soda]');
	});

	it('creates an entry from a name', async () => {
		await createFromKey(v.ctx, 'muscade', { slug: 'muscade', category: 'epice', staple: false });
		expect(lastCommit()).toBe('ingredient: add muscade');
		expect(v.read('ingredients/muscade.md')).toMatch(/^slug: muscade\ncategory: epice\nnames:\n {2}fr: \[muscade\]\n {2}en: \[\]$/m);
		expect(line('lasagna-bolognaise', 'muscade')).toEqual({ item: 'muscade', resolution: 'alias' });
		expect(row('muscade')).toBeUndefined();
	});

	it('settles an ambiguous name by taking it off one entry', async () => {
		await unlinkKey(v.ctx, 'huile', 'huile-d-olive', hashOf('huile-d-olive'));
		expect(lastCommit()).toBe('ingredient: huile-d-olive - "huile"');
		expect(v.read('ingredients/huile-d-olive.md')).toContain("fr: [huile d'olive]");
		expect(line('muffins-bleuets', 'huile')).toEqual({ item: 'huile-vegetale', resolution: 'alias' });
		expect(row('huile')).toBeUndefined();
	});

	it('gives an entry a rule for an ambiguous name: only the lines that meet it are linked', async () => {
		expect(row('huile')!.units).toEqual([{ unit: 'cup', count: 1 }]);
		const head = v.git('rev-parse', 'HEAD').trim();
		await expect(addRule(v.ctx, 'huile', 'huile-vegetale', {})).rejects.toThrow(/au moins une condition/);
		await expect(addRule(v.ctx, 'huile', 'huile-vegetale', { unit: ['tasse'] })).rejects.toThrow(/unité inconnue/);
		expect(v.git('rev-parse', 'HEAD').trim()).toBe(head);
		// A rule no line meets: committed, the name stays in the queue.
		expect(await addRule(v.ctx, 'huile', 'huile-vegetale', { unit: ['tbsp'] }, hashOf('huile-vegetale'))).toMatchObject({ resolved: 0 });
		expect(lastCommit()).toBe('ingredient: huile-vegetale + rule "huile" (unit: tbsp)');
		expect(row('huile')!.ambiguous).toBe(true);
		await expect(addRule(v.ctx, 'huile', 'huile-vegetale', { unit: ['tbsp'] })).rejects.toThrow(/déjà cette règle/);
		// By unit class and language: the cup of oil is now the vegetable oil.
		expect(await addRule(v.ctx, 'huile', 'huile-vegetale', { unit: ['volume'], words: [' ', ''], sameLang: true })).toMatchObject({ resolved: 1 });
		expect(lastCommit()).toBe('ingredient: huile-vegetale + rule "huile" (lang: fr; unit: volume)');
		expect(recipesTouched()).toEqual(['ingredients/huile-vegetale.md']);
		expect(v.read('ingredients/huile-vegetale.md')).toContain('  - {names: [huile], lang: fr, unit: [volume]}');
		expect(line('muffins-bleuets', 'huile')).toEqual({ item: 'huile-vegetale', resolution: 'rule' });
		expect(row('huile')).toBeUndefined();
		// huile d'olive keeps the alias: the name is still hers where no rule holds.
		expect(v.read('ingredients/huile-d-olive.md')).toMatch(/\bhuile\b.*\]/);
		expect(v.git('status', '--porcelain').trim()).toBe('');
	});

	it('refuses a stale entry, a bad slug or category, a taken slug, and a name no longer in the queue — nothing committed', async () => {
		const head = v.git('rev-parse', 'HEAD').trim();
		const f = join(v.dir, 'ingredients/sel.md');
		const seen = hashOf('sel');
		writeFileSync(f, readFileSync(f, 'utf8') + '\nNote.\n');
		await expect(linkKey(v.ctx, 'muscade', 'sel', seen)).rejects.toThrow(/a changé/);
		await expect(linkKey(v.ctx, 'muscade', 'inconnu')).rejects.toThrow(QueueError);
		await expect(linkKey(v.ctx, 'rien du tout', 'sel')).rejects.toThrow(/déjà relié/);
		await expect(createFromKey(v.ctx, 'muscade', { slug: 'Muscade', category: 'epice', staple: false })).rejects.toThrow(/identifiant/);
		await expect(createFromKey(v.ctx, 'muscade', { slug: 'muscade', category: 'epices', staple: false })).rejects.toThrow(/catégorie/);
		await expect(createFromKey(v.ctx, 'muscade', { slug: 'sel', category: 'epice', staple: false })).rejects.toThrow(/existe déjà/);
		expect(v.git('rev-parse', 'HEAD').trim()).toBe(head);
	});

	it('puts the file back when the commit fails', async () => {
		const before = v.read('ingredients/sel.md');
		writeFileSync(join(v.dir, '.git/index.lock'), '');
		await expect(linkKey(v.ctx, 'muscade', 'sel')).rejects.toThrow(/git/);
		rmSync(join(v.dir, '.git/index.lock'));
		expect(v.read('ingredients/sel.md')).toBe(before);
		expect(v.git('status', '--porcelain').trim()).toBe('');
		expect(row('muscade')).toBeDefined();
	});

	it('vault queue prints the queue', () => {
		const r = spawnSync(process.execPath, ['bin/vault.js', 'queue', '--vault', v.dir, '--limit', '3'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
		expect(r.status).toBe(0);
		const lines = r.stdout.trim().split('\n');
		expect(lines).toHaveLength(4);
		expect(lines[3]).toMatch(/^\d+ names to link; the first 3 shown/);
		expect(r.stdout).toContain('feuilles de lasagne');
	});
});
