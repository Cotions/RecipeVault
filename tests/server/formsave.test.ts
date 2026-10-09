// Plan 04, Phase 3: the form's save path. The form serializes its recipe and
// enters the paste path's save; these tests hold it to that, and to the
// form's own rules (slug, status Q14, stale Q18, family Q10, hints Q9).

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withAuthor } from '../../src/lib/server/context';
import {
	allFamilies,
	formCheck,
	formSave,
	openForm,
	subRecipeCandidates,
	suggestAuthors,
	suggestNames,
	vaultStats
} from '../../src/lib/server/formsave';
import { currentFile, save } from '../../src/lib/server/save';
import { remove } from '../../src/lib/server/trash';
import { checkFile } from '../../src/lib/vault/check';
import { confirmField, emptyForm, fieldMarkers, formText, newItem, type FormRecipe, type MethodSection } from '../../src/lib/form/model';
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

	it('a checker error the form missed: logged with its code, returned on its field, nothing written', async () => {
		const f = newForm('Biscuits inventés');
		// A unit outside the list: the picker cannot produce it; the checker still refuses it.
		(f.groups[0].items[0] as { unit: string }).unit = 'tasse';
		const before = commits().length;
		const r = await formSave(ctx(), { form: f });
		expect(r).toEqual({ status: 'invalid', errors: [{ id: f.groups[0].items[0].id, field: 'unit', reason: 'checker', code: 'E201' }] });
		expect(logs.join('\n')).toMatch(/E201/);
		expect(JSON.stringify(r)).not.toMatch(/tasse|not allowed/);
		expect(commits()).toHaveLength(before);
	});
});

describe('formSave — what the checker refuses comes back on its field (P2 review)', () => {
	/** Saves, expects `invalid` with a block on (id, field), nothing committed. */
	async function refused(f: FormRecipe, id: string, field: string, reason: string) {
		const before = commits().length;
		const r = await formSave(ctx(), { form: f });
		expect(r.status).toBe('invalid');
		const errors = r.status === 'invalid' ? r.errors : [];
		expect(errors.find((e) => e.id === id && e.field === field)).toMatchObject({ reason });
		expect(commits()).toHaveLength(before);
		return errors;
	}
	const item = (f: FormRecipe) => f.groups[0].items[0];
	const step = (f: FormRecipe) => (f.sections[0] as MethodSection).rows[0];

	it('E211 / E210 in the name', async () => {
		const a = newForm('Soupe inventée', (f) => Object.assign(item(f), { qty: '', unit: '', name: 'sel, poivre', toTaste: true }));
		const errors = await refused(a, item(a).id, 'name', 'nameComma');
		expect(errors[0].code).toBe('E211');
		expect(logs.join('\n')).toMatch(/E211/);
		const b = newForm('Soupe inventée', (f) => Object.assign(item(f), { qty: '1', unit: 'can', name: 'tomates 796 ml' }));
		await refused(b, item(b).id, 'name', 'nameQuantity');
	});

	it('E216 in the note', async () => {
		const f = newForm('Galettes inventées', (f) => (item(f).note = '1/2 lb'));
		await refused(f, item(f).id, 'note', 'noteQuantity');
	});

	it('E217 in a step and in a note', async () => {
		const f = newForm('Galettes inventées', (f) => (step(f).text = 'Cuire [voir note].'));
		expect((await refused(f, step(f).id, 'text', 'marker'))[0].value).toBe('[voir note]');
		const g = newForm('Galettes inventées', (f) => (item(f).note = 'lecture incertaine'));
		await refused(g, item(g).id, 'note', 'marker');
	});

	it('E108: decimal servings', async () => {
		await refused(newForm('Galettes inventées', (f) => (f.servings = '2,5')), 'recipe', 'servings', 'integer');
	});

	it('E202 / E203 / E205 on the yield; E205 on the alt', async () => {
		const y = (edit: Partial<FormRecipe['yield']>) => newForm('Galettes inventées', (f) => (f.yield = { kind: 'amount', text: '', qty: '', qtyMax: '', unit: '', note: '', ...edit }));
		await refused(y({ qty: '12' }), 'recipe', 'yield.unit', 'unit');
		await refused(y({ unit: 'piece' }), 'recipe', 'yield.qty', 'qty');
		await refused(y({ qty: '3', qtyMax: '2', unit: 'piece' }), 'recipe', 'yield.qtyMax', 'range');
		const a = newForm('Galettes inventées', (f) => (item(f).alt = { qty: '250', qtyMax: '100', unit: 'ml', written: {} }));
		await refused(a, item(a).id, 'alt.qtyMax', 'range');
	});

	it('E301: every step removed beside a section the file does not know', async () => {
		const text = `---\nschema: 3\ntitle: Galettes inventées\nslug: galettes-inventees\nlang: fr\ningredients:\n  - items:\n      - { qty: 1, unit: cup, name: farine }\n---\n\n## Préparation\n\n1. Mélanger.\n\n## Conservation\n\nAu frais.\n`;
		await save(v.ctx, [{ text }]);
		const o = opened('galettes-inventees');
		const m = o.form.sections.find((s) => s.kind === 'method') as MethodSection;
		m.rows.splice(0);
		const before = commits().length;
		const r = await formSave(ctx(), { form: o.form, base: { slug: 'galettes-inventees', hash: o.hash } });
		expect(r).toMatchObject({ status: 'invalid', errors: [{ id: m.id, field: 'steps', reason: 'method' }] });
		expect(commits()).toHaveLength(before);
	});

	it('an oven maximum without a temperature is refused, not dropped', async () => {
		await refused(newForm('Galettes inventées', (f) => (f.oven = { temp: '', tempMax: '375', unit: 'F' })), 'recipe', 'oven.tempMax', 'qty');
	});

	it('an error only the vault finds (E213) comes back on its row, from the live check and the save', async () => {
		const o = opened('bouillon-de-legumes');
		const it = newItem();
		Object.assign(it, { qty: '1', unit: 'piece', name: 'pizza', recipe: 'pizza-maison' });
		o.form.groups[0].items.push(it);
		expect(formCheck(v.ctx, o.form, { slug: 'bouillon-de-legumes', hash: o.hash }).errors).toContainEqual(expect.objectContaining({ id: it.id, code: 'E213' }));
		const r = await formSave(ctx(), { form: o.form, base: { slug: 'bouillon-de-legumes', hash: o.hash } });
		expect(r.status).toBe('invalid');
		expect(r.status === 'invalid' && r.errors.some((e) => e.id === it.id && e.code === 'E213')).toBe(true);
		expect(logs.join('\n')).toMatch(/E213/);
	});

	it('a clean form has no errors in the live check', () => {
		expect(formCheck(v.ctx, newForm('Galettes inventées')).errors).toEqual([]);
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

	it('the picker and the live check follow the index: after a save, and after a write from another connection', async () => {
		const tart = (title: string) =>
			newForm(title, (f) => {
				const it = newItem();
				Object.assign(it, { qty: '1', unit: 'piece', name: 'pâte', recipe: 'pate-brisee' });
				f.groups[0].items.push(it);
			});
		// Warm every cached list first.
		expect(subRecipeCandidates(v.ctx, '', 'pate-brisee', 100).map((r) => r.slug)).not.toContain('tarte-inventee');
		expect(formCheck(v.ctx, newForm('Tarte inventée')).same).toEqual([]);
		expect(formCheck(v.ctx, newForm('Tartes inventées')).hints.some((h) => h.code === 'W503')).toBe(false);

		const r = await formSave(ctx(), { form: tart('Tarte inventée') });
		expect(r).toMatchObject({ status: 'saved', slug: 'tarte-inventee' });
		// It uses the pâte: never offered to the pâte (E213); offered to others.
		expect(subRecipeCandidates(v.ctx, '', 'pate-brisee', 100).map((r) => r.slug)).not.toContain('tarte-inventee');
		expect(subRecipeCandidates(v.ctx, 'tarte inv', 'bouillon-de-legumes').map((r) => r.slug)).toEqual(['tarte-inventee']);
		expect(formCheck(v.ctx, newForm('Tarte inventée')).same.map((s) => s.slug)).toEqual(['tarte-inventee']);
		expect(formCheck(v.ctx, newForm('Tartes inventées')).hints).toContainEqual(expect.objectContaining({ code: 'W503', slug: 'tarte-inventee' }));
		// The pâte, edited to use the tarte, is now a cycle.
		const o = opened('pate-brisee');
		const it = newItem();
		Object.assign(it, { qty: '1', unit: 'piece', name: 'tarte', recipe: 'tarte-inventee' });
		o.form.groups[0].items.push(it);
		expect(formCheck(v.ctx, o.form, { slug: 'pate-brisee', hash: o.hash }).errors).toContainEqual(expect.objectContaining({ id: it.id, code: 'E213' }));

		// Another connection to the index (the CLI's `vault sync`, say) drops the tarte: seen here too.
		const other = new Database(v.ctx.paths.index);
		try {
			other.prepare('DELETE FROM recipes WHERE slug = ?').run('tarte-inventee');
			other.prepare('DELETE FROM ingredients WHERE slug = ?').run('tarte-inventee');
		} finally {
			other.close();
		}
		expect(subRecipeCandidates(v.ctx, 'tarte inv', 'bouillon-de-legumes')).toEqual([]);
		expect(formCheck(v.ctx, newForm('Tarte inventée')).same).toEqual([]);
		expect(formCheck(v.ctx, o.form, { slug: 'pate-brisee', hash: o.hash }).errors).not.toContainEqual(expect.objectContaining({ code: 'E213' }));
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

	it('a name written several ways is suggested in its most-written spelling', () => {
		const add = v.ctx.db.prepare("INSERT INTO ingredients (slug, position, group_idx, name, key, resolution) VALUES ('zz', ?, 0, ?, 'zzpanais', 'none')");
		[['Zzpanais', 1], ['zzpanais', 2], ['zzpanais', 3], ['ZZPANAIS', 4]].forEach(([name, pos]) => add.run(pos, name));
		expect(suggestNames(v.ctx, 'zzpan', 'fr').map((s) => s.name)).toEqual(['zzpanais']);
	});

	it('an author is suggested once, whatever markers or case its recipes write it with, most used first', async () => {
		// The fixture has « Tante Irène [?] »; two more recipes write her as read.
		for (const [title, author] of [['Galettes inventées', 'Tante Irène'], ['Biscuits inventés', 'tante irène']])
			await formSave(ctx(), { form: newForm(title, (f) => (f.source.author = author)) }, { today: '2026-09-28' });
		expect(suggestAuthors(v.ctx, 'irène')).toEqual(['Tante Irène']);
		const all = suggestAuthors(v.ctx, '', 50);
		expect(new Set(all.map((a) => a.toLowerCase())).size).toBe(all.length);
		expect(all[0]).toBe('Tante Irène');
	});
});
