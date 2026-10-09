// Disk, git and index stay in step: untracked files, failed commits, families,
// vocabulary changes made while the app was down, season aliases.
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { browse, families } from '../../src/lib/server/index/query';
import { syncVault } from '../../src/lib/server/index/sync';
import { currentFile, save, SaveError, verify, VerifyError } from '../../src/lib/server/save';
import { remove, restore, TrashError } from '../../src/lib/server/trash';
import { commitExternalEdits, Watcher } from '../../src/lib/server/watcher';
import { recipe, tempVault, type TempVault } from '../helpers/vault';

let v: TempVault;
beforeEach(async () => {
	v = await tempVault();
});
afterEach(() => v.cleanup());

const status = () => v.git('status', '--porcelain', '--untracked-files=all').trim();
const subject = () => v.git('log', '-1', '--format=%s').trim();
const row = (slug: string) => v.ctx.db.prepare('SELECT slug FROM recipes WHERE slug = ?').get(slug);
const lock = () => writeFileSync(join(v.dir, '.git/index.lock'), '');
const unlock = () => rmSync(join(v.dir, '.git/index.lock'), { force: true });

/** A recipe file written behind the app's back (as if while it was stopped), then synced. */
function untracked(title: string, slug: string, extra = '') {
	writeFileSync(join(v.dir, `recipes/${slug}.md`), recipe(title, `slug: ${slug}\n${extra}`));
	syncVault(v.ctx.db, v.ctx.paths);
	expect(row(slug)).toBeTruthy();
}

describe('untracked recipe files', () => {
	it('delete and restore work on a file git never tracked', async () => {
		untracked('Tarte inventée', 'tarte-inventee');
		await remove(v.ctx, 'tarte-inventee');
		expect(subject()).toBe('delete: Tarte inventée');
		expect(existsSync(join(v.dir, '_trash/tarte-inventee.md'))).toBe(true);
		expect(row('tarte-inventee')).toBeUndefined();
		expect(status()).toBe('');
		await restore(v.ctx, 'tarte-inventee');
		expect(subject()).toBe('restore: Tarte inventée');
		expect(row('tarte-inventee')).toBeTruthy();
		expect(status()).toBe('');
	});

	it('startup commits files edited while the app was stopped, not broken ones', async () => {
		untracked('Galette inventée', 'galette-inventee');
		writeFileSync(join(v.dir, 'recipes/cassee.md'), '---\nschema: 3\ntitle: [\n---\n');
		syncVault(v.ctx.db, v.ctx.paths);
		const commit = await commitExternalEdits(v.ctx);
		expect(commit).toMatch(/^[0-9a-f]{40}$/);
		expect(subject()).toBe('edit (external): Galette inventée');
		expect(status()).toBe('?? recipes/cassee.md');
		expect(await commitExternalEdits(v.ctx)).toBeUndefined();
	});
});

describe('a failed git commit leaves nothing behind', () => {
	it('save: a new file is removed, an edited one put back, and a retry saves', async () => {
		await save(v.ctx, [{ text: recipe('Biscuits') }]);
		const before = v.read('recipes/biscuits.md');
		lock();
		await expect(save(v.ctx, [{ text: recipe('Galettes') }])).rejects.toThrow(SaveError);
		expect(existsSync(join(v.dir, 'recipes/galettes.md'))).toBe(false);
		expect(v.ctx.ownWrites.has('recipes/galettes.md')).toBe(false);
		const hash = (await import('../../src/lib/server/save')).currentFile(v.ctx, 'biscuits')!.hash;
		await expect(save(v.ctx, [{ text: recipe('Biscuits', 'servings: 4\n'), overwrite: hash }])).rejects.toThrow(/nothing was saved/);
		expect(v.read('recipes/biscuits.md')).toBe(before);
		unlock();
		expect(status()).toBe('');
		const r = await save(v.ctx, [{ text: recipe('Galettes') }]);
		expect(r.files[0].status).toBe('saved');
		expect(row('galettes')).toBeTruthy();
	});

	it('verify: refused with its own error (the page says why), the file put back', async () => {
		await save(v.ctx, [{ text: recipe('Tarte') }]);
		const before = v.read('recipes/tarte.md');
		lock();
		const e = await verify(v.ctx, 'tarte', currentFile(v.ctx, 'tarte')!.hash).catch((x) => x);
		expect(e).toBeInstanceOf(VerifyError);
		expect(e.message).toMatch(/rien n’a changé/);
		expect(v.read('recipes/tarte.md')).toBe(before);
		unlock();
		expect(status()).toBe('');
	});

	it('delete and restore: files move back and the index is untouched', async () => {
		await save(v.ctx, [{ text: recipe('Soupe') }]);
		mkdirSync(join(v.dir, 'media/soupe'), { recursive: true });
		writeFileSync(join(v.dir, 'media/soupe/final.jpg'), 'jpg');
		lock();
		await expect(remove(v.ctx, 'soupe')).rejects.toThrow(TrashError);
		expect(existsSync(join(v.dir, 'recipes/soupe.md'))).toBe(true);
		expect(existsSync(join(v.dir, 'media/soupe/final.jpg'))).toBe(true);
		expect(row('soupe')).toBeTruthy();
		unlock();
		expect(status()).toBe('');
		await remove(v.ctx, 'soupe');
		lock();
		await expect(restore(v.ctx, 'soupe')).rejects.toThrow(TrashError);
		expect(existsSync(join(v.dir, '_trash/soupe.md'))).toBe(true);
		expect(existsSync(join(v.dir, '_trash/soupe/final.jpg'))).toBe(true);
		expect(v.ctx.ownWrites.has('recipes/soupe.md')).toBe(false);
		unlock();
		await restore(v.ctx, 'soupe');
		expect(row('soupe')).toBeTruthy();
	});
});

describe('families', () => {
	it('a family introduced by save, restore or an outside edit is listed at once', async () => {
		await save(v.ctx, [{ text: recipe('Gâteau inventé', 'family: gateau-invente\nvariant: chocolat\n') }]);
		expect(families(v.ctx.db).map((f) => f.slug)).toEqual(['gateau-invente']);
		await remove(v.ctx, 'gateau-invente');
		expect(families(v.ctx.db)).toEqual([]);
		await restore(v.ctx, 'gateau-invente');
		expect(families(v.ctx.db).map((f) => f.slug)).toEqual(['gateau-invente']);

		const w = new Watcher(v.ctx, { debounceMs: 20 });
		w.start();
		try {
			writeFileSync(join(v.dir, 'recipes/pain-invente.md'), recipe('Pain inventé', 'slug: pain-invente\nfamily: pain-invente\nvariant: blanc\n'));
			// The file event can come late under load: wait for it, not a fixed 10 ms.
			await expect
				.poll(async () => (await w.idle(), families(v.ctx.db).map((f) => f.slug)), { timeout: 5000, interval: 50 })
				.toEqual(['gateau-invente', 'pain-invente']);
		} finally {
			w.stop();
		}
	});
});

describe('vocabulary changed while the app was down', () => {
	it('startup sync retags, and search finds the new canonical tag', async () => {
		await save(v.ctx, [{ text: recipe('Carrés', 'tags: [qqalias]\n') }]);
		expect(browse(v.ctx.db, {}).facets.tags.find((t) => t.value === 'qqalias')?.pending).toBe(true);
		appendFileSync(join(v.dir, 'vocab/tags.yaml'), '\nnewcanon: [qqalias]\n');
		const report = syncVault(v.ctx.db, v.ctx.paths);
		expect(report.indexed).toBe(0);
		expect(browse(v.ctx.db, { tags: ['newcanon'] }).total).toBe(1);
		expect(browse(v.ctx.db, { q: 'newcanon' }).total).toBe(1);
		expect(browse(v.ctx.db, {}).facets.tags.find((t) => t.value === 'qqalias')).toBeUndefined();
	});
});

describe('seasons', () => {
	it('maps English and accented aliases to the four canonical values', async () => {
		writeFileSync(join(v.dir, 'recipes/salade-inventee.md'), recipe('Salade inventée', 'slug: salade-inventee\nseason: [summer, fall]\n'));
		syncVault(v.ctx.db, v.ctx.paths);
		const seasons = v.ctx.db.prepare('SELECT season FROM seasons WHERE slug = ? ORDER BY season').pluck().all('salade-inventee');
		expect(seasons).toEqual(['automne', 'ete']);
		expect(browse(v.ctx.db, { season: 'ete' }).total).toBe(1);
	});
});
