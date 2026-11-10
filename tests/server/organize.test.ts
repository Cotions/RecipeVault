// Organizing (docs/DATA-FLOW.md, "Duplicates" and "Grouping variants"): the
// pairs of /doublons as one card per connected set, one decision for the card
// in one commit, a recipe joining a group, and « Annuler » for the vocabulary
// and registry commits. Invented recipes only.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withAuthor } from '../../src/lib/server/context';
import {
	dismissPairs,
	DuplicateError,
	duplicateCount,
	duplicateGroupPage,
	freshGroups,
	duplicateGroups,
	groupingScores,
	groupPairs,
	groupVersions,
	joinsCard,
	titleHead,
	joinFamily,
	recipeMark,
	sameRecipes,
	undismissPairs
} from '../../src/lib/server/duplicates';
import { linkKey, queueCount, QueueError, undoEntryCommit } from '../../src/lib/server/queue';
import { save } from '../../src/lib/server/save';
import { titleMatches } from '../../src/lib/server/formsave';
import { acceptTag, pendingTags, TagError, tagsVersion, undoTagVocab } from '../../src/lib/server/tags';
import { fixtureVault, recipe, tempVault, type TempVault } from '../helpers/vault';
import { copyOf } from '../helpers/duplicates';

const POUDING = readFileSync('tests/fixtures/vault/recipes/pouding-chomeur.md', 'utf8');
const CAMILLE = { name: 'Camille Inventée', email: 'camille@recipevault.invalid' };
const THREE = ['pouding-chomeur', 'pouding-de-matante', 'pouding-du-dimanche'];

describe('groupPairs', () => {
	it('one card per connected set, closest first; its pairs closest first', () => {
		const g = groupPairs([
			{ a: 'b', b: 'c', score: 0.8 },
			{ a: 'd', b: 'e', score: 0.85 },
			{ a: 'a', b: 'b', score: 0.95 }
		]);
		expect(g.map((x) => x.key)).toEqual(['a b c', 'd e']);
		expect(g[0]).toMatchObject({ slugs: ['a', 'b', 'c'], score: 0.95 });
		expect(g[0].pairs.map((p) => p.score)).toEqual([0.95, 0.8]);
	});

	it('with titles: sets link by a shared head word or a very close pair; the pairs between two sets make one card of two', () => {
		const titles: Record<string, string> = {
			a: 'Pouding inventé',
			b: 'Pouding inventé de Zoé',
			c: "Poor Invented's Pudding",
			d: 'Biscuits fictifs au sirop',
			e: 'Biscuits fictifs au caramel'
		};
		const g = groupPairs(
			[
				{ a: 'a', b: 'b', score: 0.8 },
				{ a: 'a', b: 'c', score: 0.95 },
				{ a: 'd', b: 'e', score: 0.85 },
				{ a: 'b', b: 'd', score: 0.7 },
				{ a: 'c', b: 'e', score: 0.68 }
			],
			(s) => titles[s]
		);
		expect(g.map((x) => x.key)).toEqual(['a b c', 'd e', 'b d']);
		// The bridge card shows its closest pair and settles every pair between the two sets.
		expect(g[2].pairs.map((p) => p.score)).toEqual([0.7, 0.68]);
	});

	it('a title head: the first word that says something, folded, singular', () => {
		expect(titleHead('Les muffins aux bleuets')).toBe('muffin');
		expect(titleHead('Grands-pères au sirop')).toBe('grand');
		expect(titleHead("Pouding chômeur à l'érable")).toBe('pouding');
		expect(joinsCard(0.7, 'Pouding chômeur', 'Pouding au pain')).toBe(true);
		expect(joinsCard(0.7, 'Grands-pères', 'Pouding chômeur')).toBe(false);
		expect(joinsCard(0.92, 'Grands-pères', 'Pouding chômeur')).toBe(true);
	});
});

describe('the cards of /doublons', () => {
	let v: TempVault;
	let mark: number;
	beforeEach(async () => {
		v = await fixtureVault();
		await save(v.ctx, [{ text: copyOf(POUDING, 'Pouding de matante', 'pouding-de-matante') }]);
		mark = recipeMark(v.ctx);
		await save(v.ctx, [{ text: copyOf(POUDING, 'Pouding du dimanche', 'pouding-du-dimanche') }]);
	});
	afterEach(() => v.cleanup());

	const ctx = () => withAuthor(v.ctx, CAMILLE);
	const hash = (slug: string) => v.ctx.db.prepare('SELECT file_hash FROM recipes WHERE slug = ?').pluck().get(slug) as string;
	const count = () => Number(v.git('rev-list', '--count', 'HEAD').trim());
	const head = () => v.git('log', '-1', '--format=%s').trim();
	const cardOf = () => duplicateGroupPage(v.ctx, 1, mark).groups.find((g) => g.key === THREE.join(' '));

	it('a title holding another whole is offered as a variant on the form (« Ressemble à »); a mere word is not', () => {
		expect(titleMatches(v.ctx, 'Pouding chômeur de la voisine inventée').like.map((x) => x.slug)).toContain('pouding-chomeur');
		expect(titleMatches(v.ctx, 'Pouding').like).toEqual([]);
	});

	it('three copies: one card of three with its three pairs, new since the mark', () => {
		const page = duplicateGroupPage(v.ctx, 1, mark);
		const card = cardOf()!;
		expect(card.members.map((m) => m.slug).sort()).toEqual(THREE);
		expect(card.pairs).toHaveLength(3);
		expect(card.common).toContain('cassonade');
		expect(card.core).toHaveLength(3);
		expect(card.elements['pouding-chomeur']).toContain('cassonade');
		expect(card.fresh).toBe(true);
		expect(page.fresh).toBeGreaterThanOrEqual(1);
		expect(duplicateCount(v.ctx)).toBe(page.total);
		expect(freshGroups(v.ctx, duplicateGroups(v.ctx), recipeMark(v.ctx))).toEqual([]);
	});

	it('the new cards come first, before closer ones (« 1 nouveau » points at the top of the first page)', () => {
		const groups = duplicateGroupPage(v.ctx, 1, mark).groups;
		expect(groups[0].fresh).toBe(true);
		const firstOld = groups.findIndex((g) => !g.fresh);
		if (firstOld >= 0) expect(groups.slice(firstOld).some((g) => g.fresh)).toBe(false);
		// Without a mark, closest first, nothing flagged.
		expect(duplicateGroupPage(v.ctx, 1).groups.every((g) => !g.fresh)).toBe(true);
	});

	it('« Grouper avec… » ranks by likeness: a copy scores 1, the recipe itself is left out, scores in 0–1', () => {
		const scores = groupingScores(v.ctx, 'pouding-de-matante');
		expect(scores.get('pouding-chomeur')).toBe(1);
		expect(scores.has('pouding-de-matante')).toBe(false);
		expect([...scores.values()].every((x) => x >= 0.2 && x <= 1)).toBe(true);
		expect(groupingScores(v.ctx, 'no-such-recipe').size).toBe(0);
	});

	it('« Recettes différentes » for the card: one commit for its pairs; « Annuler » one commit back', async () => {
		const pairs = cardOf()!.pairs.map((p) => [p.a, p.b] as [string, string]);
		const before = count();
		await dismissPairs(ctx(), pairs, duplicateGroupPage(v.ctx).distinctHash);
		expect(count()).toBe(before + 1);
		expect(head()).toBe('duplicate: 3 pairs');
		expect(cardOf()).toBeUndefined();
		await undismissPairs(ctx(), pairs);
		expect(count()).toBe(before + 2);
		expect(cardOf()?.pairs).toHaveLength(3);
	});

	it('« Variantes » for the card: one commit putting all three in one group', async () => {
		const before = count();
		const r = await groupVersions(ctx(), {
			members: THREE.map((slug, i) => ({ slug, hash: hash(slug), variant: ['classique', 'de matante', 'du dimanche'][i] })),
			family: '',
			label: 'Pouding chômeur'
		});
		expect(r.family).toBe('pouding-chomeur');
		expect(count()).toBe(before + 1);
		const fams = v.ctx.db.prepare(`SELECT family FROM recipes WHERE slug IN (${THREE.map(() => '?').join(',')})`).pluck().all(...THREE);
		expect(new Set(fams)).toEqual(new Set(['pouding-chomeur']));
	});

	it('a recipe joins a group: one commit; an empty or taken variant, or no such group, refused', async () => {
		await groupVersions(ctx(), {
			members: [
				{ slug: THREE[0], hash: hash(THREE[0]), variant: 'classique' },
				{ slug: THREE[1], hash: hash(THREE[1]), variant: 'de matante' }
			],
			family: 'pouding-chomeur'
		});
		const req = { slug: THREE[2], hash: hash(THREE[2]), family: 'pouding-chomeur' };
		await expect(joinFamily(ctx(), { ...req, variant: ' ' })).rejects.toThrow(DuplicateError);
		await expect(joinFamily(ctx(), { ...req, variant: 'De matante' })).rejects.toThrow(DuplicateError);
		await expect(joinFamily(ctx(), { ...req, family: 'aucun-groupe', variant: 'x' })).rejects.toThrow(DuplicateError);
		const before = count();
		const r = await joinFamily(ctx(), { ...req, variant: 'du dimanche' });
		expect(r.commit).toBeTruthy();
		expect(count()).toBe(before + 1);
		expect(v.ctx.db.prepare('SELECT family, variant FROM recipes WHERE slug = ?').get(THREE[2])).toEqual({ family: 'pouding-chomeur', variant: 'du dimanche' });
	});

	it('« Même recette »: the ticked ones to the trash, one commit each, the kept one stays', async () => {
		await expect(sameRecipes(ctx(), THREE[0], [])).rejects.toThrow(DuplicateError);
		const r = await sameRecipes(ctx(), THREE[0], THREE.slice(1).map((slug) => ({ slug, hash: hash(slug) })));
		expect(r.trashed.map((x) => x.slug)).toEqual(THREE.slice(1));
		expect(hash(THREE[0])).toBeTruthy();
		expect(hash(THREE[1])).toBeUndefined();
		expect(cardOf()).toBeUndefined();
	});
});

describe('« Annuler » on /etiquettes and /resoudre', () => {
	it('a new tag taken back: one commit restoring the vocabulary, the tag pending again; refused once the files moved on', async () => {
		const v = await tempVault();
		try {
			await save(v.ctx, [{ text: recipe('Tire inventée', 'tags: [cabane à sucre, fête des sucres]\n') }]);
			const ctx = withAuthor(v.ctx, CAMILLE);
			const before = v.read('vocab/tags.yaml');
			const first = await acceptTag(ctx, 'cabane-a-sucre', 'Cabane à sucre', tagsVersion(v.ctx));
			const second = await acceptTag(ctx, 'fete-des-sucres', 'Fête des sucres', tagsVersion(v.ctx));
			await expect(undoTagVocab(ctx, first.commit!)).rejects.toThrow(TagError);
			await undoTagVocab(ctx, second.commit!);
			await undoTagVocab(ctx, first.commit!);
			expect(v.read('vocab/tags.yaml')).toBe(before);
			expect(v.git('log', '-1', '--format=%s').trim()).toMatch(/^undo: tag: new cabane-a-sucre/);
			expect(pendingTags(v.ctx).map((p) => p.tag).sort()).toEqual(['cabane-a-sucre', 'fete-des-sucres']);
		} finally {
			v.cleanup();
		}
	});

	it('a link taken back: the entry as it was, the name in the queue again; a recipe commit is not one to take back here', async () => {
		const v = await fixtureVault();
		try {
			const hashOf = (slug: string) => v.ctx.db.prepare('SELECT file_hash FROM registry WHERE slug = ?').pluck().get(slug) as string;
			const file = v.read('ingredients/pates-alimentaires.md');
			const before = queueCount(v.ctx.db);
			const r = await linkKey(v.ctx, 'feuilles de lasagne', 'pates-alimentaires', hashOf('pates-alimentaires'));
			expect(queueCount(v.ctx.db)).toBe(before - 1);
			await undoEntryCommit(v.ctx, r.commit!);
			expect(v.read('ingredients/pates-alimentaires.md')).toBe(file);
			expect(queueCount(v.ctx.db)).toBe(before);
			await save(v.ctx, [{ text: recipe('Galette inventée') }]);
			await expect(undoEntryCommit(v.ctx, v.git('rev-parse', 'HEAD').trim())).rejects.toThrow(QueueError);
		} finally {
			v.cleanup();
		}
	});
});
