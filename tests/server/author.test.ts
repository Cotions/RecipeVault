// Plan 04, Phase 0: every write commits as the person who made it; the CLI and
// the watcher keep the config's author.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withAuthor } from '../../src/lib/server/context';
import { familiesFile, setFamilyLabel } from '../../src/lib/server/families';
import { addAlias } from '../../src/lib/server/ingredient';
import { syncVault } from '../../src/lib/server/index/sync';
import { appendPrice } from '../../src/lib/server/prices';
import { currentFile, save, verify } from '../../src/lib/server/save';
import { remove, restore } from '../../src/lib/server/trash';
import { commitExternalEdits } from '../../src/lib/server/watcher';
import { AUTHOR, fixtureVault, recipe, type TempVault } from '../helpers/vault';

const CAMILLE = { name: 'Camille Inventée', email: 'camille@recipevault.invalid' };

let v: TempVault;
beforeEach(async () => {
	v = await fixtureVault();
});
afterEach(() => v.cleanup());

const last = () => v.git('log', '-1', '--format=%s|%an|%ae|%cn|%ce').trim();
const by = (a: { name: string; email: string }) => `|${a.name}|${a.email}|${a.name}|${a.email}`;

describe('author per write', () => {
	it('withAuthor without an author is the context itself; with one, shares lock, index and own writes', () => {
		expect(withAuthor(v.ctx)).toBe(v.ctx);
		const c = withAuthor(v.ctx, CAMILLE);
		expect(c.author).toEqual(CAMILLE);
		expect(v.ctx.author).toEqual(AUTHOR);
		expect(c.lock).toBe(v.ctx.lock);
		expect(c.db).toBe(v.ctx.db);
		expect(c.ownWrites).toBe(v.ctx.ownWrites);
	});

	it('a save, a verify, a delete and a restore commit under the given name and email', async () => {
		const c = withAuthor(v.ctx, CAMILLE);
		const r = await save(c, [{ text: recipe('Galettes inventées') }]);
		expect(r.files[0].status).toBe('saved');
		expect(last()).toBe(`add: Galettes inventées${by(CAMILLE)}`);
		await verify(c, 'galettes-inventees', currentFile(v.ctx, 'galettes-inventees')!.hash);
		expect(last()).toBe(`verify: Galettes inventées${by(CAMILLE)}`);
		await remove(c, 'galettes-inventees');
		expect(last()).toBe(`delete: Galettes inventées${by(CAMILLE)}`);
		await restore(c, 'galettes-inventees');
		expect(last()).toBe(`restore: Galettes inventées${by(CAMILLE)}`);
	});

	it('a family label, a price and an ingredient edit commit under the given author', async () => {
		const c = withAuthor(v.ctx, CAMILLE);
		await setFamilyLabel(c, 'galettes', 'Galettes', familiesFile(v.ctx).hash);
		expect(last()).toMatch(new RegExp(`^family: .*${by(CAMILLE).replace(/[|.]/g, '\\$&')}$`));
		await appendPrice(c, { ingredient: 'farine', amount: 4.99, packQty: 2.5, packUnit: 'kg', date: '2026-09-28' });
		expect(last()).toMatch(/^price: farine .*\|Camille Inventée\|camille@recipevault\.invalid\|/);
		const hash = v.ctx.db.prepare('SELECT file_hash FROM registry WHERE slug = ?').pluck().get('farine') as string;
		await addAlias(c, 'farine', hash, 'fr', 'farine tout usage inventée');
		expect(last()).toMatch(/\|Camille Inventée\|camille@recipevault\.invalid\|Camille Inventée\|camille@recipevault\.invalid$/);
	});

	it('without an author, and for edits made outside the app, the config’s author', async () => {
		await save(v.ctx, [{ text: recipe('Tarte inventée') }]);
		expect(last()).toBe(`add: Tarte inventée${by(AUTHOR)}`);
		// An app save by someone, then an edit from outside: the watcher's commit is not hers.
		await save(withAuthor(v.ctx, CAMILLE), [{ text: recipe('Pouding inventé') }]);
		writeFileSync(join(v.dir, 'recipes/tarte-inventee.md'), recipe('Tarte inventée', 'servings: 6\n'));
		syncVault(v.ctx.db, v.ctx.paths);
		await commitExternalEdits(v.ctx);
		expect(last()).toBe(`edit (external): Tarte inventée${by(AUTHOR)}`);
	});
});
