import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanLabel, familiesFile, FamilyLabelError, setFamilyLabel, withLabel } from '../../src/lib/server/families';
import { families, familyDiff } from '../../src/lib/server/index/query';
import { loadVocab } from '../../src/lib/server/vocab';
import { fixtureVault, type TempVault } from '../helpers/vault';

describe('withLabel', () => {
	const SEED = '# Canonical family slug: { fr: label, en: label }. Grows as families are created.\n{}\n';

	it('adds an entry to the empty seed, in block style, keeping the comment', () => {
		const out = withLabel(SEED, 'lasagna', 'Lasagnes');
		expect(out).toBe('# Canonical family slug: { fr: label, en: label }. Grows as families are created.\nlasagna: { fr: Lasagnes }\n');
	});

	it('changes the French label and keeps the English one and other entries', () => {
		const text = 'tarte: { fr: Tartes }\nlasagna: { fr: Lasagne, en: Lasagna }\n';
		expect(withLabel(text, 'lasagna', 'Lasagnes')).toBe('tarte: { fr: Tartes }\nlasagna: { fr: Lasagnes, en: Lasagna }\n');
	});

	it('removes the label, and the entry once empty', () => {
		expect(withLabel('lasagna: { fr: Lasagne, en: Lasagna }\n', 'lasagna', '')).toBe('lasagna: { en: Lasagna }\n');
		expect(withLabel('lasagna: { fr: Lasagne }\ntarte: { fr: Tartes }\n', 'lasagna', '')).toBe('tarte: { fr: Tartes }\n');
	});

	it('quotes what YAML could misread', () => {
		for (const label of ['Pâtes: « no » #1', 'no', '[?] tartes', '1:30', 'Lasagnes, gratins'])
			expect(parse(withLabel('{}\n', 'pates', label), { version: '1.2' })).toEqual({ pates: { fr: label } });
	});

	it('starts from an empty or missing file', () => {
		expect(withLabel('', 'lasagna', 'Lasagnes')).toBe('lasagna: { fr: Lasagnes }\n');
	});

	it('refuses a file that does not read', () => {
		expect(() => withLabel('lasagna: { fr: [\n', 'lasagna', 'x')).toThrow(FamilyLabelError);
		expect(() => withLabel('- a\n- b\n', 'lasagna', 'x')).toThrow(FamilyLabelError);
	});

	it('cleans labels', () => {
		expect(cleanLabel('  Lasagnes \n de  maman ')).toBe('Lasagnes de maman');
		expect(cleanLabel('Pâtes')).toBe('Pâtes');
	});
});

describe('setFamilyLabel', () => {
	let v: TempVault;
	beforeEach(async () => {
		v = await fixtureVault();
	});
	afterEach(() => v.cleanup());

	const log = () => v.git('log', '--format=%s').trim().split('\n');

	it('writes vocab/families.yaml, commits it, and the pages show the label', async () => {
		const { hash } = familiesFile(v.ctx);
		const { commit } = await setFamilyLabel(v.ctx, 'lasagna', ' Lasagnes de la maison ', hash);
		expect(commit).toMatch(/^[0-9a-f]{40}$/);
		expect(log()[0]).toBe('family: lasagna → Lasagnes de la maison');
		expect(v.read('vocab/families.yaml')).toContain('lasagna: { fr: Lasagnes de la maison }');
		expect(v.git('status', '--porcelain').trim()).toBe('');
		expect(loadVocab(v.ctx.paths.vocab).families.get('lasagna')).toEqual({ fr: 'Lasagnes de la maison', en: undefined });
		expect(families(v.ctx.db).find((f) => f.slug === 'lasagna')?.label).toBe('Lasagnes de la maison');
		expect(familyDiff(v.ctx.db, 'lasagna')?.label).toBe('Lasagnes de la maison');
		// The watcher knows this write is the app's own.
		expect(v.ctx.ownWrites.has('vocab/families.yaml')).toBe(true);
	});

	it('clears a label', async () => {
		await setFamilyLabel(v.ctx, 'lasagna', 'Lasagnes', familiesFile(v.ctx).hash);
		await setFamilyLabel(v.ctx, 'lasagna', '', familiesFile(v.ctx).hash);
		expect(log()[0]).toBe('family: lasagna (label removed)');
		expect(familyDiff(v.ctx.db, 'lasagna')?.label).toBeNull();
	});

	it('does nothing when the label is unchanged', async () => {
		await setFamilyLabel(v.ctx, 'lasagna', 'Lasagnes', familiesFile(v.ctx).hash);
		const before = log().length;
		expect(await setFamilyLabel(v.ctx, 'lasagna', 'Lasagnes', familiesFile(v.ctx).hash)).toEqual({});
		expect(log().length).toBe(before);
	});

	it('refuses a stale page, a bad slug and a label too long', async () => {
		const { hash } = familiesFile(v.ctx);
		await setFamilyLabel(v.ctx, 'lasagna', 'Lasagnes', hash);
		await expect(setFamilyLabel(v.ctx, 'lasagna', 'Autre', hash)).rejects.toThrow(/rechargez/);
		const now = familiesFile(v.ctx).hash;
		await expect(setFamilyLabel(v.ctx, 'Lasagna!', 'x', now)).rejects.toThrow(FamilyLabelError);
		await expect(setFamilyLabel(v.ctx, 'lasagna', 'x'.repeat(81), now)).rejects.toThrow(/trop long/);
		expect(v.read('vocab/families.yaml')).toContain('fr: Lasagnes');
	});

	it('puts the file back when the commit fails', async () => {
		const before = v.read('vocab/families.yaml');
		writeFileSync(join(v.dir, '.git/index.lock'), '');
		try {
			await expect(setFamilyLabel(v.ctx, 'lasagna', 'Lasagnes', familiesFile(v.ctx).hash)).rejects.toThrow(/rien n’a changé/);
		} finally {
			rmSync(join(v.dir, '.git/index.lock'), { force: true });
		}
		expect(v.read('vocab/families.yaml')).toBe(before);
		expect(v.ctx.ownWrites.has('vocab/families.yaml')).toBe(false);
		expect(familyDiff(v.ctx.db, 'lasagna')?.label).toBeNull();
	});
});
