// Kitchen mode's « Pour cette étape »: which lines a step uses. Invented recipes and steps.
import { describe, expect, it } from 'vitest';
import { matchStep, matchSteps } from '../../src/lib/render/steps';
import type { IngredientGroup } from '../../src/lib/vault/types';

const FR = { suffixes: ['x', 's'], minLength: 4 };
const g = (group: string | undefined, ...names: string[]): IngredientGroup => ({ group, items: names.map((name) => ({ name })) });

/** An invented meat pie: a long filling, a one-line crust. */
const pie = [g('Farce', 'porc haché', 'veau haché maigre', 'oignons', 'ail', 'eau bouillante', 'cannelle', 'clou de girofle', 'sel', 'poivre'), g('Croûte', 'pâte brisée')];
/** An invented pudding: butter in both groups. */
const pudding = [g('Sirop', 'cassonade', 'eau', 'beurre'), g('Gâteau', 'beurre', 'sucre', 'oeufs', 'farine', 'poudre à pâte', 'lait')];

const names = (m: { lines: { group: number; ingredient: { name: string } }[] }) => m.lines.map((l) => `${l.group}:${l.ingredient.name}`);

describe('matchStep', () => {
	it('reads « la viande » as the meat lines, « l’eau » as the water line, and a plural name in the singular', () => {
		const m = matchStep('Mijoter la viande avec l’oignon et l’eau 30 minutes.', pie, FR);
		expect(names(m)).toEqual(['0:porc haché', '0:veau haché maigre', '0:oignons', '0:eau bouillante']);
		expect(m.sure).toBe(true);
	});
	it('reads « les épices » as the spice lines, and « saler, poivrer » as salt and pepper', () => {
		expect(names(matchStep('Ajouter les épices, le sel et le poivre.', pie, FR))).toEqual(['0:cannelle', '0:clou de girofle', '0:sel', '0:poivre']);
		expect(names(matchStep('Saler, poivrer.', pie, FR))).toEqual(['0:sel', '0:poivre']);
	});
	it('reads a group’s name as the whole group: one chip when long, its lines when short', () => {
		const long = matchStep('Laisser refroidir la farce.', pie, FR);
		expect(long.groups).toEqual([0]);
		expect(long.lines).toHaveLength(9);
		const short = matchStep('Couvrir d’une abaisse.', pie, FR);
		expect(short.groups).toEqual([]);
		expect(names(short)).toEqual(['1:pâte brisée']);
		expect(names(matchStep('Abaisser la pâte.', pie, FR))).toEqual(['1:pâte brisée']);
		// A doneness check names what is in the oven, not something to add.
		expect(names(matchStep('Cuire jusqu’à ce que la pâte soit dorée.', pie, FR))).toEqual([]);
	});
	it('says it is unsure when a generic word has nothing to stand for, or the step says « le reste »', () => {
		const herbs = matchStep('Ajouter les fines herbes et l’ail.', pie, FR);
		expect(names(herbs)).toEqual(['0:ail']);
		expect(herbs.sure).toBe(false);
		// « les légumes » with onions in the list: the onions, and sure.
		expect(matchStep('Ajouter les légumes.', pie, FR)).toMatchObject({ sure: true, lines: [{ ingredient: { name: 'oignons' } }] });
		expect(matchStep('Incorporer le reste des ingrédients.', pie, FR)).toMatchObject({ lines: [], sure: false });
		// A step that uses nothing is sure of it.
		expect(matchStep('Enfourner 40 minutes.', pie, FR)).toMatchObject({ lines: [], groups: [], sure: true });
	});
	it('keeps the group the step works in when a name is in two groups', () => {
		expect(names(matchStep('Fondre la cassonade, l’eau et le beurre.', pudding, FR))).toEqual(['0:cassonade', '0:eau', '0:beurre']);
		expect(names(matchStep('Battre le beurre et le sucre ; ajouter les oeufs.', pudding, FR))).toEqual(['1:beurre', '1:sucre', '1:oeufs']);
		// No other clue: both.
		expect(names(matchStep('Beurrer le moule avec du beurre.', pudding, FR))).toEqual(['0:beurre', '1:beurre']);
	});
	it('does not read « poudre à pâte » as the pastry, nor a longer name as a shorter one', () => {
		expect(names(matchStep('Ajouter la farine et la poudre à pâte.', pudding, FR))).toEqual(['1:farine', '1:poudre à pâte']);
		const nuts = [g(undefined, 'beurre', 'beurre d’arachides', 'sucre')];
		expect(names(matchStep('Crémer le beurre d’arachides avec le sucre.', nuts, FR))).toEqual(['0:beurre d’arachides', '0:sucre']);
		// A plural is every line of that noun.
		const sugars = [g(undefined, 'sucre', 'sucre brun', 'farine')];
		expect(names(matchStep('Crémer avec les sucres.', sugars, FR))).toEqual(['0:sucre', '0:sucre brun']);
		expect(names(matchStep('Crémer avec le sucre.', sugars, FR))).toEqual(['0:sucre']);
	});
	it('reads « les pâtes » as the pasta, and English names by their last word', () => {
		const bake = [g('Sauce', 'tomates', 'ail', 'huile', 'basilic'), g(undefined, 'nouilles larges', 'fromage cheddar')];
		expect(names(matchStep('Alterner les pâtes, la sauce et le fromage.', bake, FR))).toEqual(['0:tomates', '0:ail', '0:huile', '0:basilic', '1:nouilles larges', '1:fromage cheddar']);
		const en = [g(undefined, 'ground beef', 'yellow onion', 'all-purpose flour')];
		expect(names(matchStep('Brown the beef with the onion, then sprinkle the flour.', en, null, 'en'))).toEqual(['0:ground beef', '0:yellow onion', '0:all-purpose flour']);
	});
	it('finds a line the registry does not know by a step word one letter off, and a line by its entry’s other names', () => {
		// An invented card with a typo: the line says « oigon », the step « l’oignon ».
		const card = [g(undefined, 'porc haché', 'oigon', 'eau', 'cassonade')];
		const known = { unlinked: [1], aliases: { 3: ['sucre brun', 'cassonade'] } };
		expect(names(matchStep('Mettre la viande, l’oignon et l’eau.', card, FR, 'fr', known))).toEqual(['0:porc haché', '0:oigon', '0:eau']);
		// Only lines not linked to the registry, five letters at least, same first letter.
		expect(names(matchStep('Mettre la viande, l’oignon et l’eau.', card, FR, 'fr', {}))).toEqual(['0:porc haché', '0:eau']);
		expect(names(matchStep('Ajouter le sucre brun.', card, FR, 'fr', known))).toEqual(['0:cassonade']);
		// Another line's own name wins over an alias.
		const butter = [g('Sirop', 'beurre salé'), g('Pâte', 'beurre', 'sucre')];
		expect(names(matchStep('Crémer le beurre et le sucre.', butter, FR, 'fr', { aliases: { 0: ['beurre'] } }))).toEqual(['1:beurre', '1:sucre']);
	});
	it('is unsure when the step names a food no line accounts for, instead of dropping it', () => {
		const card = [g(undefined, 'porc haché', 'oigon', 'eau')];
		const m = matchStep('Mettre la viande, l’oignon et l’eau.', card, FR);
		expect(names(m)).toEqual(['0:porc haché', '0:eau']);
		expect(m.sure).toBe(false);
		// « mais » is « but », not corn.
		expect(matchStep('Mijoter, mais sans bouillir, le porc.', card, FR).sure).toBe(true);
	});
	it('reads a line by the head of its entry’s other names, never by a generic word', () => {
		// Invented: the card says « steak haché » and « poivron vert », the step « le bœuf » and « le piment ».
		const card = [g(undefined, 'steak haché', 'oignon', 'poivron vert', 'porc haché')];
		const known = { aliases: { 0: ['bœuf haché', 'viande à hamburger'], 2: ['piment vert'] } };
		const m = matchStep('Dorer le boeuf avec l’oignon et le piment.', card, FR, 'fr', known);
		expect(names(m)).toEqual(['0:steak haché', '0:oignon', '0:poivron vert']);
		expect(m.sure).toBe(true);
		// « la viande » stays every meat line, not the one whose entry says « viande à hamburger ».
		expect(names(matchStep('Dorer la viande.', card, FR, 'fr', known))).toEqual(['0:steak haché', '0:porc haché']);
	});
	it('does not read a doneness check as something to add', () => {
		const m = matchStep('Cuire au four 40 minutes, jusqu’à ce que la pâte soit dorée.', pie, FR);
		expect(m.lines).toEqual([]);
		expect(m.sure).toBe(true);
		const en = [g(undefined, 'pie crust', 'ground pork')];
		expect(names(matchStep('Bake until the crust is golden. Serve with the pork.', en, null, 'en'))).toEqual(['0:ground pork']);
	});
});

describe('matchSteps', () => {
	it('reads a word in « -é » as a word of its own, not the noun it looks like without its accent', () => {
		const crisp = [g(undefined, 'pommes', 'beurre', 'cassonade', 'sucre')];
		// « un plat beurré » greases a dish: no butter for this step.
		expect(names(matchStep('Mettre les pommes dans un plat beurré.', crisp, FR))).toEqual(['0:pommes']);
		expect(names(matchStep('Étendre sur une pâte sucrée, puis ajouter le beurre.', crisp, FR))).toEqual(['0:beurre']);
		// All four forms, and a line written with its participle still found by it.
		for (const w of ['beurré', 'beurrée', 'beurrés', 'beurrées']) expect(names(matchStep(`Un moule ${w}.`, crisp, FR))).toEqual([]);
		const pie = [g(undefined, 'porc haché', 'pâte brisée', 'pâté de foie')];
		expect(names(matchStep('Brunir le porc haché.', pie, FR))).toEqual(['0:porc haché']);
		expect(names(matchStep('Abaisser la pâte.', pie, FR))).toEqual(['0:pâte brisée']);
		expect(names(matchStep('Tartiner le pâté.', pie, FR))).toEqual(['0:pâté de foie']);
		// Not one letter off an unlinked line either.
		expect(names(matchStep('Un plat beurré.', crisp, FR, 'fr', { unlinked: [1] }))).toEqual([]);
		// The aliases still count (« sucre brun » for the cassonade line).
		expect(names(matchStep('Ajouter le sucre brun.', crisp, FR, 'fr', { aliases: { 2: ['sucre brun'] } }))).toEqual(['0:cassonade']);
	});
	it('reads a generic word for lines an earlier step used as that step’s product: the group’s chip', () => {
		const ms = matchSteps(['Mijoter la viande avec l’oignon et l’eau.', 'Remplir de viande et couvrir d’une abaisse.'], pie, FR);
		expect(ms[0].groups).toEqual([]);
		expect(ms[1].groups).toEqual([0]);
		expect(names(ms[1])).toContain('1:pâte brisée');
		expect(ms[1].lines).toHaveLength(10);
		// Alone, the second step is still the meat lines.
		expect(matchStep('Remplir de viande et couvrir d’une abaisse.', pie, FR).groups).toEqual([]);
	});
	it('reads « le mélange » as the group the step before worked in; nothing without named groups', () => {
		const ms = matchSteps(['Battre le sucre et les oeufs.', 'Verser le mélange dans le moule.'], pudding, FR);
		expect(ms[1].groups).toEqual([1]);
		const flat = [g(undefined, 'sucre', 'oeufs', 'farine')];
		expect(matchSteps(['Battre le sucre et les oeufs.', 'Verser le mélange dans le moule.'], flat, FR)[1].lines).toEqual([]);
	});
});
