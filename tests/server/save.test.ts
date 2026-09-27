import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { syncVault } from '../../src/lib/server/index/sync';
import { currentFile, save, setFrontmatter, verify, VerifyError } from '../../src/lib/server/save';
import { listTrash, remove, restore, TrashError } from '../../src/lib/server/trash';
import { initVault, VaultInitError } from '../../src/lib/server/vault';
import { AUTHOR, recipe, tempVault, VOCAB_DOC, type TempVault } from '../helpers/vault';

let v: TempVault;
beforeEach(async () => {
	v = await tempVault();
});
afterEach(() => v.cleanup());

const log = () => v.git('log', '--format=%s|%an|%ae').trim().split('\n');
const row = (slug: string) => v.ctx.db.prepare('SELECT * FROM recipes WHERE slug = ?').get(slug) as Record<string, unknown> | undefined;

describe('vault init', () => {
	it('creates the layout, the .gitignore, the vocab seed and a first commit', () => {
		for (const d of ['recipes', 'ingredients', 'vocab', 'media', '_trash', 'cache']) expect(existsSync(join(v.dir, d)), d).toBe(true);
		expect(v.read('.gitignore')).toMatch(/^media\/$/m);
		expect(v.read('.gitignore')).toMatch(/^cache\/$/m);
		expect(v.read('.gitignore')).toMatch(/^inbox\/$/m);
		expect(v.read('vocab/tags.yaml')).toContain('plat-principal:');
		expect(v.read('vocab/units.yaml')).toContain('cup:');
		expect(log()).toEqual([`init: new vault|${AUTHOR.name}|${AUTHOR.email}`]);
		expect(v.git('status', '--porcelain').trim()).toBe('');
	});

	it('refuses a non-empty directory, but accepts one holding only inbox/', async () => {
		await expect(initVault(v.dir, VOCAB_DOC, AUTHOR)).rejects.toThrow(VaultInitError);
		const dir = join(v.dir, '..', 'other');
		mkdirSync(join(dir, 'inbox'), { recursive: true });
		writeFileSync(join(dir, 'inbox', 'a-v2.md'), 'x');
		await initVault(dir, VOCAB_DOC, AUTHOR);
		expect(readdirSync(join(dir, 'inbox'))).toEqual(['a-v2.md']);
	});
});

describe('save', () => {
	it('writes the canonical file, commits it, indexes it', async () => {
		const r = await save(v.ctx, [{ text: recipe('Galettes', 'status: verified\nadded: 1999-01-01\n') }], { today: '2026-09-27' });
		expect(r.files[0]).toMatchObject({ status: 'saved', slug: 'galettes', recipeStatus: 'draft', created: true });
		const file = v.read('recipes/galettes.md');
		expect(file).toContain('slug: galettes\n');
		expect(file).toContain('status: draft\nadded: 2026-09-27\nupdated: 2026-09-27\nextracted_by: ai\n');
		expect(file).not.toContain('1999');
		expect(log()[0]).toBe(`add: Galettes|${AUTHOR.name}|${AUTHOR.email}`);
		expect(v.git('status', '--porcelain').trim()).toBe('');
		expect(row('galettes')).toMatchObject({ title: 'Galettes', status: 'draft', file_path: 'recipes/galettes.md' });
		expect(r.commit).toMatch(/^[0-9a-f]{40}$/);
	});

	it('sets needs-review while an uncertain marker remains', async () => {
		const r = await save(v.ctx, [{ text: recipe('"Beignes [?]"') }]);
		expect(r.files[0]).toMatchObject({ status: 'saved', recipeStatus: 'needs-review' });
		const plus = await save(v.ctx, [{ text: recipe('"Muffins [+]"') }]);
		expect(plus.files[0]).toMatchObject({ status: 'saved', recipeStatus: 'draft' });
	});

	it('refuses a file with errors and writes nothing', async () => {
		const r = await save(v.ctx, [{ text: recipe('Pain', '', '## Préparation\n\n1. Cuire.\n').replace('unit: cup', 'unit: tasse') }]);
		expect(r.files[0].status).toBe('rejected');
		expect(r.files[0].diagnostics.map((d) => d.code)).toContain('E201');
		expect(r.commit).toBeUndefined();
		expect(readdirSync(join(v.dir, 'recipes'))).toEqual(['.gitkeep']);
		expect(log()).toHaveLength(1);
	});

	it('saves several files in one commit, and keeps the failing one out', async () => {
		const r = await save(v.ctx, [{ text: recipe('Tarte A') }, { text: recipe('Tarte B') }, { text: 'nope' }]);
		expect(r.files.map((f) => f.status)).toEqual(['saved', 'saved', 'rejected']);
		expect(log()[0]).toBe(`add: Tarte A; add: Tarte B|${AUTHOR.name}|${AUTHOR.email}`);
		expect(log()).toHaveLength(2);
	});

	it('returns a collision, then overwrites (an edit) or saves under the suffixed slug', async () => {
		await save(v.ctx, [{ text: recipe('Chili') }], { today: '2026-01-01' });
		const again = recipe('Chili', 'servings: 4\n');
		const r = await save(v.ctx, [{ text: again }]);
		expect(r.files[0]).toMatchObject({ status: 'collision', slug: 'chili', suggested: 'chili-2', existing: { title: 'Chili' }, inTrash: false });
		const hash = r.files[0].status === 'collision' ? r.files[0].existing!.hash : '';

		const stale = await save(v.ctx, [{ text: again, overwrite: 'deadbeef' }]);
		expect(stale.files[0].status).toBe('stale');

		const over = await save(v.ctx, [{ text: again, overwrite: hash }], { today: '2026-02-02' });
		expect(over.files[0]).toMatchObject({ status: 'saved', slug: 'chili', created: false });
		expect(v.read('recipes/chili.md')).toContain('servings: 4\n');
		expect(v.read('recipes/chili.md')).toContain('added: 2026-01-01\nupdated: 2026-02-02\n');
		expect(log()[0]).toMatch(/^edit: Chili\|/);

		const suffix = await save(v.ctx, [{ text: again, slug: 'chili-2' }]);
		expect(suffix.files[0]).toMatchObject({ status: 'saved', slug: 'chili-2' });
		expect(v.read('recipes/chili-2.md')).toContain('slug: chili-2\n');
	});

	it('offers a family for a same-title recipe (W608) and sets it on the new file only', async () => {
		await save(v.ctx, [{ text: recipe('Sauce brune') }]);
		const r = await save(v.ctx, [{ text: recipe('Sauce brune'), slug: 'sauce-brune-2', family: { family: 'sauce-brune', variant: 'maman' } }]);
		expect(r.files[0]).toMatchObject({ status: 'saved', slug: 'sauce-brune-2' });
		expect(r.files[0].diagnostics.map((d) => d.code)).toContain('W608');
		expect(v.read('recipes/sauce-brune-2.md')).toContain('family: sauce-brune\nvariant: maman\n');
		expect(v.read('recipes/sauce-brune.md')).not.toContain('family');
	});

	it('keeps the file and the commit when the index write fails, and sync recovers', async () => {
		v.ctx.faults = { index: true };
		const r = await save(v.ctx, [{ text: recipe('Fudge') }]);
		expect(r.indexError).toMatch(/injected/);
		expect(r.files[0].status).toBe('saved');
		expect(existsSync(join(v.dir, 'recipes/fudge.md'))).toBe(true);
		expect(log()[0]).toMatch(/^add: Fudge\|/);
		expect(row('fudge')).toBeUndefined();
		v.ctx.faults = undefined;
		const report = syncVault(v.ctx.db, v.ctx.paths);
		expect(report.indexed).toBe(1);
		expect(row('fudge')).toMatchObject({ title: 'Fudge' });
	});

	it('setFrontmatter keeps the rest of the file', () => {
		const out = setFrontmatter(recipe('X'), { slug: 'x-2' });
		expect(out).toContain('title: X\n');
		expect(out).toContain('slug: x-2\n');
		expect(out).toContain('## Préparation');
	});
});

describe('verify', () => {
	it('sets verified through the save path, committed as verify:', async () => {
		await save(v.ctx, [{ text: recipe('Carrés') }]);
		const { hash } = currentFile(v.ctx, 'carres')!;
		await expect(verify(v.ctx, 'carres', 'stale')).rejects.toThrow(VerifyError);
		await verify(v.ctx, 'carres', hash);
		expect(v.read('recipes/carres.md')).toContain('status: verified\n');
		expect(log()[0]).toMatch(/^verify: Carrés\|/);
		expect(row('carres')).toMatchObject({ status: 'verified' });
	});

	it('is refused while an uncertain marker remains', async () => {
		await save(v.ctx, [{ text: recipe('"Carrés [?]"') }]);
		const { hash } = currentFile(v.ctx, 'carres')!;
		await expect(verify(v.ctx, 'carres', hash)).rejects.toThrow(/marqueurs/);
	});
});

describe('trash', () => {
	it('moves file and media to _trash, commits, drops rows; restore reverses it', async () => {
		await save(v.ctx, [{ text: recipe('Soupe') }]);
		mkdirSync(join(v.dir, 'media/soupe'), { recursive: true });
		writeFileSync(join(v.dir, 'media/soupe/final.jpg'), 'jpg');
		await remove(v.ctx, 'soupe');
		expect(existsSync(join(v.dir, 'recipes/soupe.md'))).toBe(false);
		expect(existsSync(join(v.dir, '_trash/soupe.md'))).toBe(true);
		expect(existsSync(join(v.dir, '_trash/soupe/final.jpg'))).toBe(true);
		expect(log()[0]).toMatch(/^delete: Soupe\|/);
		expect(v.git('status', '--porcelain').trim()).toBe('');
		expect(row('soupe')).toBeUndefined();
		expect(listTrash(v.ctx).map((e) => e.slug)).toEqual(['soupe']);

		// A deleted slug is never silently reused.
		const again = await save(v.ctx, [{ text: recipe('Soupe') }]);
		expect(again.files[0]).toMatchObject({ status: 'collision', inTrash: true, suggested: 'soupe-2' });

		await restore(v.ctx, 'soupe');
		expect(existsSync(join(v.dir, 'recipes/soupe.md'))).toBe(true);
		expect(existsSync(join(v.dir, 'media/soupe/final.jpg'))).toBe(true);
		expect(log()[0]).toMatch(/^restore: Soupe\|/);
		expect(row('soupe')).toMatchObject({ title: 'Soupe' });
	});

	it('refuses to restore over a taken slug', async () => {
		await save(v.ctx, [{ text: recipe('Soupe') }]);
		await remove(v.ctx, 'soupe');
		writeFileSync(join(v.dir, 'recipes/soupe.md'), recipe('Soupe', 'slug: soupe\n'));
		await expect(restore(v.ctx, 'soupe')).rejects.toThrow(TrashError);
	});
});
