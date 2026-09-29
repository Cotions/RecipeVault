// Plan 04, Phase 3: the form's save path. The form serializes its recipe and
// enters the paste path's save; these tests hold it to that, and to the
// form's own rules (slug, status Q14, stale Q18, family Q10, hints Q9).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withAuthor } from '../../src/lib/server/context';
import {
	allFamilies,
	formCheck,
	formSave,
	openForm,
	subRecipeCandidates,
	suggestNames,
	vaultStats
} from '../../src/lib/server/formsave';
import { currentFile, save } from '../../src/lib/server/save';
import { remove } from '../../src/lib/server/trash';
import { checkFile } from '../../src/lib/vault/check';
import { confirmField, emptyForm, fieldMarkers, formText, newItem, type FormRecipe } from '../../src/lib/form/model';
import { defaultsFor } from '../../src/lib/form/defaults';
import { fixtureVault, tempVault, type TempVault } from '../helpers/vault';

const CAMILLE = { name: 'Camille Inventée', email: 'camille@recipevault.invalid' };

let v: TempVault;
let logs: string[];
beforeEach(async () => {
	v = await fixtureVault();
	logs = [];
	v.ctx.log = (m) => logs.push(m);
});
afterEach(() => v.cleanup());

const commits = () => v.git('log', '--format=%s|%an').trim().split('\n');
const changed = (rev = 'HEAD') => v.git('show', '--name-only', '--format=', rev).trim().split('\n').sort();
const ctx = () => withAuthor(v.ctx, CAMILLE);

/** A new-recipe form: title, one ingredient, one step. */
function newForm(title: string, edit?: (f: FormRecipe) => void): FormRecipe {
	const f = emptyForm({ ovenUnit: 'F' });
	f.title = title;
	Object.assign(f.groups[0].items[0], { qty: '1 ½', unit: 'cup', name: 'farine' });
	const method = f.sections[0];
	if (method.kind === 'method') method.rows[0].text = 'Mélanger.';
	edit?.(f);
	return f;
}

function opened(slug: string) {
	const o = openForm(v.ctx, slug);
	if (!('form' in o)) throw new Error(`cannot open ${slug}: ${o.refused}`);
	return o;
}

describe('formSave — new recipe', () => {
	it('adds the recipe, attributed, extracted_by hand, byte-identical to the paste path', async () => {
		const r = await formSave(ctx(), { form: newForm('Galettes inventées') }, { today: '2026-09-28' });
		expect(r).toMatchObject({ status: 'saved', slug: 'galettes-inventees', created: true });
		expect(commits()[0]).toBe(`add: Galettes inventées|${CAMILLE.name}`);
		const file = v.read('recipes/galettes-inventees.md');
		expect(file).toContain('extracted_by: hand\n');
		expect(file).toContain('status: draft\nadded: 2026-09-28\nupdated: 2026-09-28\n');
		expect(file).toContain('qty: "1 1/2"');

		// The same content through the paste box, in another vault.
		const other = await tempVault();
		try {
			await save(other.ctx, [{ text: formText(newForm('Galettes inventées')) }], { today: '2026-09-28' });
			expect(other.read('recipes/galettes-inventees.md')).toBe(file);
		} finally {
			other.cleanup();
		}
	});

	it('takes the first free slug on a collision, and never one in the trash', async () => {
		const a = await formSave(ctx(), { form: newForm('Crêpes minces') });
		expect(a).toMatchObject({ status: 'saved', slug: 'crepes-minces' });
		const b = await formSave(ctx(), { form: newForm('Crêpes minces') });
		expect(b).toMatchObject({ status: 'saved', slug: 'crepes-minces-2' });
		await remove(v.ctx, 'crepes-minces-2');
		const c = await formSave(ctx(), { form: newForm('Crêpes minces') });
		expect(c).toMatchObject({ status: 'saved', slug: 'crepes-minces-3' });
	});

	it('is draft, whatever the form claims', async () => {
		const f = newForm('Pain inventé');
		f.app = { status: 'verified', added: '1999-01-01' };
		const r = await formSave(ctx(), { form: f }, { today: '2026-09-28' });
		expect(r.status).toBe('saved');
		expect(v.read('recipes/pain-invente.md')).toContain('status: draft\nadded: 2026-09-28\n');
	});

	it('refuses what the file cannot hold, writing nothing', async () => {
		const before = commits().length;
		const f = newForm('');
		const r = await formSave(ctx(), { form: f });
		expect(r).toMatchObject({ status: 'invalid' });
		expect(r.status === 'invalid' && r.errors.map((e) => e.field)).toContain('title');
		expect(commits()).toHaveLength(before);
	});

	it('logs a checker error with its code and returns no text of it', async () => {
		const f = newForm('Biscuits inventés');
		// A unit outside the list: the picker cannot produce it; the checker still refuses it.
		(f.groups[0].items[0] as { unit: string }).unit = 'tasse';
		const before = commits().length;
		const r = await formSave(ctx(), { form: f });
		expect(r).toEqual({ status: 'failed' });
		expect(logs.join('\n')).toMatch(/E201/);
		expect(commits()).toHaveLength(before);
	});
});

describe('formSave — edit', () => {
	it('an unchanged form writes nothing and commits nothing', async () => {
		for (const slug of ['tarte-au-sucre', 'crepes', 'pizza-maison', 'banana-bread']) {
			const before = commits().length;
			const { form, hash } = opened(slug);
			const r = await formSave(ctx(), { form, base: { slug, hash } });
			expect(r, slug).toEqual({ status: 'unchanged', slug, hash });
			expect(commits()).toHaveLength(before);
		}
	});

	it('a title change keeps the slug; the commit is hers', async () => {
		const { form, hash } = opened('crepes');
		form.title = 'Crêpes de la semaine';
		const r = await formSave(ctx(), { form, base: { slug: 'crepes', hash } }, { today: '2026-09-28' });
		expect(r).toMatchObject({ status: 'saved', slug: 'crepes', created: false });
		expect(commits()[0]).toBe(`edit: Crêpes de la semaine|${CAMILLE.name}`);
		const file = v.read('recipes/crepes.md');
		expect(file).toContain('title: Crêpes de la semaine\nslug: crepes\n');
		expect(file).toContain('added: 2026-09-22\nupdated: 2026-09-28\nextracted_by: hand\n');
	});

	it('a stale hash is refused, nothing written, with the other version to show', async () => {
		const { form, hash } = opened('crepes');
		const other = opened('crepes');
		other.form.servings = '6';
		expect((await formSave(v.ctx, { form: other.form, base: { slug: 'crepes', hash } })).status).toBe('saved');
		const on = v.read('recipes/crepes.md');
		const before = commits().length;
		form.servings = '2';
		const r = await formSave(ctx(), { form, base: { slug: 'crepes', hash } });
		expect(r.status).toBe('stale');
		if (r.status !== 'stale') return;
		expect(r.theirs?.form.servings).toBe('6');
		expect(v.read('recipes/crepes.md')).toBe(on);
		expect(commits()).toHaveLength(before);
		// "Garder ma version": the same form, against the new hash.
		const again = await formSave(ctx(), { form, base: { slug: 'crepes', hash: r.theirs!.hash } });
		expect(again.status).toBe('saved');
		expect(v.read('recipes/crepes.md')).toContain('servings: 2\n');
	});

	it('refuses a recipe deleted since, and a file with errors (Q3 A)', async () => {
		const { form, hash } = opened('crepes');
		await remove(v.ctx, 'crepes');
		expect(await formSave(ctx(), { form, base: { slug: 'crepes', hash } })).toEqual({ status: 'refused', reason: 'gone' });
		const { writeFileSync } = await import('node:fs');
		writeFileSync(`${v.dir}/recipes/salade-de-chou.md`, v.read('recipes/salade-de-chou.md').replace(/unit: \w+/, 'unit: tasse'));
		expect(openForm(v.ctx, 'salade-de-chou')).toEqual({ refused: 'broken' });
	});
});

describe('status rule (Q14 A)', () => {
	it('an edit of a verified recipe stays verified', async () => {
		const { form, hash } = opened('pouding-chomeur');
		form.servingsNote = 'une grande famille';
		const r = await formSave(ctx(), { form, base: { slug: 'pouding-chomeur', hash } });
		expect(r.status).toBe('saved');
		expect(checkFile(v.read('recipes/pouding-chomeur.md')).recipe?.status).toBe('verified');
	});

	it('needs-review while a marker remains; draft once every one is settled', async () => {
		const { form, hash } = opened('tarte-au-sucre');
		form.difficulty = 3;
		let r = await formSave(ctx(), { form, base: { slug: 'tarte-au-sucre', hash } });
		expect(r.status).toBe('saved');
		expect(checkFile(v.read('recipes/tarte-au-sucre.md')).recipe?.status).toBe('needs-review');

		const o = opened('tarte-au-sucre');
		const f = o.form;
		confirmField(f, 'title', f.lang);
		confirmField(f, 'source.author', f.lang);
		for (const g of f.groups)
			for (const it of g.items) {
				confirmField(it, 'name', f.lang);
				confirmField(it, 'qty', f.lang);
			}
		expect(fieldMarkers(f, 'title', f.lang).uncertain).toBe(false);
		r = await formSave(ctx(), { form: f, base: { slug: 'tarte-au-sucre', hash: o.hash } });
		expect(r.status).toBe('saved');
		const file = v.read('recipes/tarte-au-sucre.md');
		expect(checkFile(file).recipe?.status).toBe('draft');
		expect(file).not.toMatch(/\[\?|\[illisible\]/);
		expect(file).toContain('[+]');
	});
});

describe('families (Q10 A)', () => {
	it('a new family’s label is written with the recipe, in one commit', async () => {
		const f = newForm('Galettes de sarrasin', (f) => {
			f.family = 'galettes';
			f.variant = 'de sarrasin';
		});
		const r = await formSave(ctx(), { form: f, familyLabel: 'Galettes' });
		expect(r.status).toBe('saved');
		expect(v.read('vocab/families.yaml')).toContain('galettes: { fr: Galettes }');
		expect(changed()).toEqual(['recipes/galettes-de-sarrasin.md', 'vocab/families.yaml']);
		expect(allFamilies(v.ctx).find((x) => x.slug === 'galettes')).toEqual({ slug: 'galettes', label: 'Galettes', count: 1 });
	});

	it('an existing label is never overwritten', async () => {
		await formSave(ctx(), { form: newForm('Galettes A', (f) => ((f.family = 'galettes'), (f.variant = 'A'))), familyLabel: 'Galettes' });
		await formSave(ctx(), { form: newForm('Galettes B', (f) => ((f.family = 'galettes'), (f.variant = 'B'))), familyLabel: 'Autre nom' });
		expect(v.read('vocab/families.yaml')).toContain('galettes: { fr: Galettes }');
		expect(changed()).toEqual(['recipes/galettes-b.md']);
	});

	it('W608 "mettre en famille": both recipes in one commit', async () => {
		const other = currentFile(v.ctx, 'crepes')!;
		const f = newForm('Crêpes minces', (f) => {
			f.family = 'crepes';
			f.variant = 'de sarrasin';
		});
		const check = formCheck(v.ctx, f);
		expect(check.same.map((s) => s.slug)).toEqual(['crepes']);
		expect(check.hints.some((h) => h.code === 'W608' && h.slug === 'crepes')).toBe(true);
		const r = await formSave(ctx(), { form: f, familyLabel: 'Crêpes', pair: { slug: 'crepes', hash: other.hash, variant: 'minces' } });
		expect(r).toMatchObject({ status: 'saved', slug: 'crepes-minces' });
		expect(changed()).toEqual(['recipes/crepes-minces.md', 'recipes/crepes.md', 'vocab/families.yaml']);
		expect(commits()[0]).toBe(`add: Crêpes minces; edit: Crêpes minces|${CAMILLE.name}`);
		const pair = checkFile(v.read('recipes/crepes.md')).recipe!;
		expect(pair).toMatchObject({ family: 'crepes', variant: 'minces', status: 'draft' });
	});

	it('a pair that changed since is refused, nothing written', async () => {
		const before = commits().length;
		const f = newForm('Crêpes minces', (f) => ((f.family = 'crepes'), (f.variant = 'b')));
		const r = await formSave(ctx(), { form: f, pair: { slug: 'crepes', hash: 'old', variant: 'a' } });
		expect(r).toEqual({ status: 'refused', reason: 'pair' });
		expect(commits()).toHaveLength(before);
	});
});

describe('hints and pickers', () => {
	it('W501 and W502 come back on their fields, with the fix', () => {
		const f = newForm('Tarte inventée', (f) => {
			f.tags = ['desert', 'Cabane à sucre'];
			f.family = 'lasagne';
			f.variant = 'x';
		});
		const { hints } = formCheck(v.ctx, f);
		expect(hints).toContainEqual({ code: 'W501', target: 'recipe', field: 'tags', value: 'desert', suggestion: 'dessert' });
		expect(hints).toContainEqual({ code: 'W501', target: 'recipe', field: 'tags', value: 'Cabane à sucre' });
		expect(hints.find((h) => h.code === 'W502')).toMatchObject({ field: 'family', suggestion: 'lasagna' });
	});

	it('an unresolved name maps to its row, empty rows notwithstanding', () => {
		const f = newForm('Soupe inventée', (f) => {
			f.groups[0].items.unshift(newItem());
			const it = newItem();
			Object.assign(it, { qty: '1', unit: 'piece', name: 'légume imaginaire' });
			f.groups[0].items.push(it);
		});
		const target = f.groups[0].items[2].id;
		const { hints } = formCheck(v.ctx, f);
		expect(hints.some((h) => (h.code === 'W305' || h.code === 'W303') && h.target === target)).toBe(true);
	});

	it('the sub-recipe picker never offers the recipe itself or one that uses it (E213)', () => {
		const all = subRecipeCandidates(v.ctx, '', undefined, 100).map((r) => r.slug);
		expect(all).toContain('pizza-maison');
		const forSauce = subRecipeCandidates(v.ctx, '', 'sauce-tomate-maison', 100).map((r) => r.slug);
		expect(forSauce).not.toContain('sauce-tomate-maison');
		expect(forSauce).not.toContain('pizza-maison'); // pizza uses the sauce
		expect(forSauce).toContain('pate-brisee');
		const forBouillon = subRecipeCandidates(v.ctx, '', 'bouillon-de-legumes', 100).map((r) => r.slug);
		// the sauce uses the bouillon, and the pizza uses the sauce: neither is offered
		expect(forBouillon).not.toContain('sauce-tomate-maison');
		expect(forBouillon).not.toContain('pizza-maison');
		expect(subRecipeCandidates(v.ctx, 'pâte', undefined).map((r) => r.slug)).toEqual(expect.arrayContaining(['pate-brisee', 'pate-a-pizza']));
	});

	it('the oven default follows the vault’s majority; the unit order its usage', () => {
		const d = defaultsFor(vaultStats(v.ctx));
		expect(d.ovenUnit).toBe('F');
		expect(d.unitOrder.slice(0, 3)).toContain('cup');
		expect(d.lang).toBe('fr');
		expect(defaultsFor(vaultStats(v.ctx))).toEqual(d);
	});

	it('names are suggested from the registry and the vault, with the "relié" mark', () => {
		const s = suggestNames(v.ctx, 'far', 'fr');
		expect(s[0]).toEqual({ name: 'farine', linked: true });
		expect(suggestNames(v.ctx, '', 'fr')).toEqual([]);
	});
});
