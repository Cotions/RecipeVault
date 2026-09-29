// Plan 04, Phase 8: pending tags settled on /etiquettes (Q11 B). Invented
// recipes and tags only.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withAuthor } from '../../src/lib/server/context';
import { currentFile, save, verify } from '../../src/lib/server/save';
import {
	acceptTag,
	canonicalTags,
	dropTag,
	mapTag,
	pendingTagCount,
	pendingTags,
	TagError,
	tagLabels,
	tagNamer,
	tagSlug,
	tagsVersion,
	tagVocabulary,
	withAliases
} from '../../src/lib/server/tags';
import { syncFile } from '../../src/lib/server/index/sync';
import { loadVocab } from '../../src/lib/server/vocab';
import { classifyTag } from '../../src/lib/vault/tagstatus';
import type { App } from '../../src/lib/server/app';
import { loadRecipePage } from '../../src/lib/server/pages';
import { seedVault, writeMissingTagLabels } from '../../src/lib/server/seed';
import { tagLabel } from '../../src/lib/i18n/fr';
import { recipe, tempVault, VOCAB_DOC, type TempVault } from '../helpers/vault';

const CAMILLE = { name: 'Camille Inventée', email: 'camille@recipevault.invalid' };

describe('withAliases', () => {
	const SEED = '# canonical: [aliases...]\nplat-principal:   [plat, main]\nfour:             [oven, baked]   # method\n';

	it('appends to a one-line list, keeping comments and alignment', () => {
		expect(withAliases(SEED, 'four', ['au four'])).toBe(
			'# canonical: [aliases...]\nplat-principal:   [plat, main]\nfour:             [oven, baked, au four]   # method\n'
		);
	});

	it('adds a new entry lined up with the others', () => {
		expect(withAliases(SEED, 'cabane-a-sucre', [])).toBe(`${SEED}cabane-a-sucre:   []\n`);
		expect(withAliases(SEED, 'x', ['y'])).toBe(`${SEED}x:                [y]\n`);
	});

	it('quotes what YAML would misread', () => {
		for (const alias of ['a, b', '1', 'true', '[?] oups', 'fête: été', '#1'])
			expect(parse(withAliases(SEED, 'four', [alias]), { version: '1.2' }).four).toEqual(['oven', 'baked', alias]);
	});

	it('handles an empty list, a block list, an empty file and a flow map', () => {
		expect(withAliases('four: []\n', 'four', ['oven'])).toBe('four: [oven]\n');
		expect(parse(withAliases('four:\n  - oven\n', 'four', ['baked']), { version: '1.2' })).toEqual({ four: ['oven', 'baked'] });
		expect(withAliases('', 'four', ['oven'])).toBe('four: [oven]\n');
		expect(parse(withAliases('{}\n', 'four', ['oven']), { version: '1.2' })).toEqual({ four: ['oven'] });
	});

	it('refuses a file that does not read', () => {
		expect(() => withAliases('four: [oven\n', 'four', ['x'])).toThrow(TagError);
		expect(() => withAliases('- a\n', 'four', ['x'])).toThrow(TagError);
	});

	it('makes canonical slugs', () => {
		expect(tagSlug('cabane-a-sucre')).toBe('cabane-a-sucre');
		expect(tagSlug("fete-d'ete")).toBe('fete-d-ete');
		expect(tagSlug('!!!')).toBe('');
	});
});

describe('classifyTag', () => {
	const tags = new Map([
		['dessert', 'dessert'],
		['pouding', 'dessert'],
		['four', 'four']
	]);
	it('tells known, pending, new and empty apart', () => {
		expect(classifyTag(tags, new Set(), 'Pouding')).toEqual({ status: 'known', canonical: 'dessert' });
		expect(classifyTag(tags, new Set(['cabane-a-sucre']), 'Cabane à sucre')).toEqual({ status: 'pending', tag: 'cabane-a-sucre' });
		expect(classifyTag(tags, new Set(), 'desert')).toEqual({ status: 'new', tag: 'desert', suggestion: 'dessert' });
		expect(classifyTag(tags, new Set(), ' [?] ')).toEqual({ status: 'empty' });
	});
});

describe('settling pending tags', () => {
	let v: TempVault;
	beforeEach(async () => {
		v = await tempVault();
		const r = await save(v.ctx, [
			{ text: recipe('Tire inventée', 'tags: [Cabane à sucre, dessert]\n') },
			{ text: recipe('Oreilles de crisse inventées', 'tags: [cabane à sucre, desert]\n') },
			{ text: recipe('Galette inventée', "tags: [fête d'été]\n") }
		]);
		expect(r.files.map((f) => f.status)).toEqual(['saved', 'saved', 'saved']);
		await verify(v.ctx, 'tire-inventee', currentFile(v.ctx, 'tire-inventee')!.hash);
	});
	afterEach(() => v.cleanup());

	const changed = (ref = 'HEAD') => v.git('show', '--name-only', '--format=', ref).trim().split('\n').sort();
	const subject = () => v.git('log', '-1', '--format=%s|%an').trim();
	const pendingKeys = () => pendingTags(v.ctx).map((p) => p.tag);
	const tagRows = (slug: string) =>
		v.ctx.db.prepare('SELECT tag, pending FROM tags WHERE slug = ? ORDER BY tag').all(slug) as { tag: string; pending: number }[];
	const recipeFiles = () => ['tire-inventee', 'oreilles-de-crisse-inventees', 'galette-inventee'].map((s) => v.read(`recipes/${s}.md`));

	it('lists pending tags with their forms, recipes and a suggestion', () => {
		expect(pendingTagCount(v.ctx.db)).toBe(3);
		const p = pendingTags(v.ctx);
		expect(p[0]).toMatchObject({
			tag: 'cabane-a-sucre',
			forms: ['cabane à sucre', 'Cabane à sucre'],
			slug: 'cabane-a-sucre',
			label: 'Cabane à sucre'
		});
		expect(p[0].recipes.map((r) => r.slug).sort()).toEqual(['oreilles-de-crisse-inventees', 'tire-inventee']);
		expect(p.find((t) => t.tag === 'desert')?.suggestion).toBe('dessert');
		expect(p.find((t) => t.tag === "fete-d'ete")?.slug).toBe('fete-d-ete');
		expect(tagVocabulary(v.ctx).pending).toEqual(['cabane-a-sucre', 'desert', "fete-d'ete"]);
	});

	it('"Nouvelle étiquette": one commit, vocab files only, by the person; the tag is no longer pending', async () => {
		const before = recipeFiles();
		const { tag } = await acceptTag(withAuthor(v.ctx, CAMILLE), 'cabane-a-sucre', 'Cabane à sucre', tagsVersion(v.ctx));
		expect(tag).toBe('cabane-a-sucre');
		expect(subject()).toBe('tag: new cabane-a-sucre → Cabane à sucre|Camille Inventée');
		expect(changed()).toEqual(['vocab/tag-labels.yaml', 'vocab/tags.yaml']);
		expect(v.git('status', '--porcelain').trim()).toBe('');
		expect(recipeFiles()).toEqual(before);
		// The slug matches both written forms: no alias needed.
		expect(v.read('vocab/tags.yaml')).toMatch(/\ncabane-a-sucre: +\[\]\n$/);
		expect(v.read('vocab/tag-labels.yaml')).toMatch(/\nquebecois: \{ fr: Québécois \}\ncabane-a-sucre: \{ fr: Cabane à sucre \}\n$/);
		expect(tagRows('tire-inventee')).toEqual([
			{ tag: 'cabane-a-sucre', pending: 0 },
			{ tag: 'dessert', pending: 0 }
		]);
		expect(pendingKeys()).toEqual(['desert', "fete-d'ete"]);
		expect(tagLabels(v.ctx)['cabane-a-sucre']).toBe('Cabane à sucre');
		expect(canonicalTags(v.ctx).find((c) => c.tag === 'cabane-a-sucre')?.label).toBe('Cabane à sucre');
		expect(v.ctx.ownWrites.has('vocab/tags.yaml')).toBe(true);
	});

	it('a new tag whose slug differs from what was written keeps the written form as an alias', async () => {
		await acceptTag(v.ctx, "fete-d'ete", '', tagsVersion(v.ctx));
		expect(subject()).toBe('tag: new fete-d-ete|Test Author');
		expect(changed()).toEqual(['vocab/tags.yaml']);
		expect(parse(v.read('vocab/tags.yaml'), { version: '1.2' })['fete-d-ete']).toEqual(["fête d'été"]);
		expect(tagRows('galette-inventee')).toEqual([{ tag: 'fete-d-ete', pending: 0 }]);
	});

	it('"C’est comme…": one commit to vocab/tags.yaml alone; the recipes map through the alias', async () => {
		const before = recipeFiles();
		const seedLine = v.read('vocab/tags.yaml').split('\n').find((l) => l.startsWith('dessert:'))!;
		await mapTag(withAuthor(v.ctx, CAMILLE), 'desert', 'dessert', tagsVersion(v.ctx));
		expect(subject()).toBe('tag: desert → dessert|Camille Inventée');
		expect(changed()).toEqual(['vocab/tags.yaml']);
		expect(recipeFiles()).toEqual(before);
		expect(v.read('vocab/tags.yaml')).toContain(seedLine.replace(/\]$/, ', desert]'));
		expect(tagRows('oreilles-de-crisse-inventees')).toEqual([
			{ tag: 'cabane-a-sucre', pending: 1 },
			{ tag: 'dessert', pending: 0 }
		]);
		expect(loadVocab(v.ctx.paths.vocab).tags.get('desert')).toBe('dessert');
	});

	it('"Retirer": the tag leaves every recipe holding it, in one commit; the rest of each file stays', async () => {
		const seen = Object.fromEntries(pendingTags(v.ctx)[0].recipes.map((r) => [r.slug, r.hash]));
		const { recipes } = await dropTag(withAuthor(v.ctx, CAMILLE), 'cabane-a-sucre', seen, { today: '2026-09-28' });
		expect(recipes).toBe(2);
		expect(v.git('log', '-1', '--format=%B').trim()).toBe(
			'tag: drop cabane-a-sucre\n\nedit: Oreilles de crisse inventées\nedit: Tire inventée'
		);
		expect(changed()).toEqual(['recipes/oreilles-de-crisse-inventees.md', 'recipes/tire-inventee.md']);
		const tire = v.read('recipes/tire-inventee.md');
		expect(tire).toContain('tags: [dessert]');
		expect(tire).toContain('status: verified');
		expect(tire).toContain('updated: 2026-09-28');
		expect(v.read('recipes/oreilles-de-crisse-inventees.md')).toContain('tags: [desert]');
		expect(pendingKeys()).toEqual(['desert', "fete-d'ete"]);
	});

	it('a drop that empties the tags writes no tags key', async () => {
		const seen = { 'galette-inventee': currentFile(v.ctx, 'galette-inventee')!.hash };
		await dropTag(v.ctx, "fete-d'ete", seen);
		expect(v.read('recipes/galette-inventee.md')).not.toMatch(/^tags:/m);
		expect(tagRows('galette-inventee')).toEqual([]);
	});

	it('refuses stale pages and settled tags, and writes nothing', async () => {
		const head = v.git('rev-parse', 'HEAD');
		const version = tagsVersion(v.ctx);
		await expect(mapTag(v.ctx, 'desert', 'dessert', 'old:version')).rejects.toThrow(TagError);
		await expect(mapTag(v.ctx, 'desert', 'pas-une-etiquette', version)).rejects.toThrow(/vocabulaire/);
		await expect(mapTag(v.ctx, 'inconnue', 'dessert', version)).rejects.toThrow(/plus en attente/);
		// A recipe changed since the page was opened.
		const seen = Object.fromEntries(pendingTags(v.ctx)[0].recipes.map((r) => [r.slug, r.hash]));
		await expect(dropTag(v.ctx, 'cabane-a-sucre', { ...seen, 'tire-inventee': 'x' })).rejects.toThrow(/a changé/);
		// Another recipe took the tag since.
		await expect(dropTag(v.ctx, 'cabane-a-sucre', { 'tire-inventee': seen['tire-inventee'] })).rejects.toThrow(/d’autres recettes/);
		expect(v.git('rev-parse', 'HEAD')).toBe(head);
		expect(v.git('status', '--porcelain').trim()).toBe('');
		// Once settled, a second click is refused.
		await mapTag(v.ctx, 'desert', 'dessert', version);
		await expect(acceptTag(v.ctx, 'desert', 'Désert', tagsVersion(v.ctx))).rejects.toThrow(/plus en attente/);
	});

	it('"Retirer" on a tag held by a recipe now broken says to fix it, not to reload', async () => {
		const seen = Object.fromEntries(pendingTags(v.ctx)[0].recipes.map((r) => [r.slug, r.hash]));
		// Broken by hand on disk: the index keeps its last good rows (and hash).
		writeFileSync(join(v.dir, 'recipes/tire-inventee.md'), '---\ntitle: [Tire inventée\n---\n');
		syncFile(v.ctx.db, v.ctx.paths, 'recipes/tire-inventee.md');
		const again = Object.fromEntries(pendingTags(v.ctx)[0].recipes.map((r) => [r.slug, r.hash]));
		expect(again).toEqual(seen);
		const head = v.git('rev-parse', 'HEAD');
		await expect(dropTag(v.ctx, 'cabane-a-sucre', again)).rejects.toThrow(/« tire-inventee » ne passe pas la validation/);
		expect(v.git('rev-parse', 'HEAD')).toBe(head);
	});

	it('after "C’est comme…", the same tag written with hyphens instead of spaces is not pending again', async () => {
		await save(v.ctx, [{ text: recipe('Choux inventés', 'tags: [pâte à choux]\n') }]);
		expect(pendingKeys()).toContain('pate-a-choux');
		await mapTag(v.ctx, 'pate-a-choux', 'dessert', tagsVersion(v.ctx));
		expect(pendingKeys()).not.toContain('pate-a-choux');
		await save(v.ctx, [{ text: recipe('Autres choux inventés', 'tags: [pâte-à-choux]\n') }]);
		expect(pendingKeys()).not.toContain('pate-a-choux');
		expect(tagRows('autres-choux-inventes')).toEqual([{ tag: 'dessert', pending: 0 }]);
		expect(classifyTag(loadVocab(v.ctx.paths.vocab).tags, new Set(), 'pâte-à-choux')).toEqual({ status: 'known', canonical: 'dessert' });
	});

	it('refuses a new tag whose slug is already in the vocabulary', async () => {
		await save(v.ctx, [{ text: recipe('Pain inventé', 'tags: [Four!]\n') }]);
		expect(pendingKeys()).toContain('four!');
		await expect(acceptTag(v.ctx, 'four!', 'Four', tagsVersion(v.ctx))).rejects.toThrow(/déjà dans le vocabulaire/);
	});
});

describe('tag labels are vault data (issue #11)', () => {
	let v: TempVault;
	beforeEach(async () => {
		v = await tempVault();
	});
	afterEach(() => v.cleanup());

	it('vault init seeds vocab/tag-labels.yaml; the app holds no label of its own', () => {
		expect(tagLabels(v.ctx)).toMatchObject({ entree: 'Entrée', pasta: 'Pâtes', 'plat-principal': 'Plat principal' });
		expect(tagLabel('entree')).toBe('Entree');
		expect(tagLabel('plat-principal')).toBe('Plat principal');
	});

	it('names a tag as written: alias → canonical label, no label → slug, outside the vocabulary → as written', () => {
		writeFileSync(join(v.dir, 'vocab/tag-labels.yaml'), 'pasta: { fr: Nouilles }\n');
		const name = tagNamer(v.ctx);
		expect(name('pâtes')).toEqual({ key: 'pasta', label: 'Nouilles' });
		expect(name('Pasta')).toEqual({ key: 'pasta', label: 'Nouilles' });
		expect(name('starter')).toEqual({ key: 'entree', label: 'Entree' });
		expect(name('cabane à sucre')).toEqual({ key: 'cabane-a-sucre', label: 'Cabane à sucre' });
	});

	it('the recipe page carries each tag’s filter key and label', async () => {
		await save(v.ctx, [{ text: recipe('Nouilles inventées', 'tags: [pâtes, Cabane à sucre, dessert]\n') }]);
		const page = loadRecipePage({ ctx: v.ctx } as App, 'nouilles-inventees')!;
		expect(page.tags).toEqual([
			{ key: 'pasta', label: 'Pâtes' },
			{ key: 'cabane-a-sucre', label: 'Cabane à sucre' },
			{ key: 'dessert', label: 'Dessert' }
		]);
	});

	it('an older vault gains the missing seed labels from `vault ingredients seed`, never over one it has', async () => {
		writeFileSync(join(v.dir, 'vocab/tag-labels.yaml'), '# à moi\nentree: { fr: Hors-d’œuvre }\ncabane-a-sucre: { fr: Cabane à sucre }\n');
		v.git('commit', '-qam', 'older vault');
		const r = await seedVault(v.ctx, '{}\n', VOCAB_DOC);
		expect(v.git('show', '--name-only', '--format=', r.commit!).trim().split('\n')).toEqual(['vocab/tag-labels.yaml']);
		const labels = tagLabels(v.ctx);
		expect(labels).toMatchObject({ entree: 'Hors-d’œuvre', 'cabane-a-sucre': 'Cabane à sucre', pasta: 'Pâtes' });
		expect(v.read('vocab/tag-labels.yaml').startsWith('# à moi\nentree: { fr: Hors-d’œuvre }\ncabane-a-sucre: { fr: Cabane à sucre }\nplat-principal: { fr: Plat principal }\n')).toBe(true);
		expect(writeMissingTagLabels(v.dir, VOCAB_DOC)).toEqual([]);
		// A file that does not read is left alone.
		writeFileSync(join(v.dir, 'vocab/tag-labels.yaml'), 'entree: { fr: \n');
		expect(writeMissingTagLabels(v.dir, VOCAB_DOC)).toEqual([]);
	});
});
