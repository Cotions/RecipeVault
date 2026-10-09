import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkRecipe } from '../../src/lib/vault/check';
import { formatNumber } from '../../src/lib/render/fraction';
import { formatOven, toC, toF } from '../../src/lib/render/temperature';
import { scaleFactor } from '../../src/lib/render/scale';
import { formatSeconds, formatDurationValue } from '../../src/lib/render/duration';
import { ingredientText, formatAmount } from '../../src/lib/render/ingredient';
import { segments } from '../../src/lib/render/markers';
import { renderInline, renderMarkdown } from '../../src/lib/render/markdown';
import { clock, findDurations } from '../../src/lib/render/timers';
import { stepIngredients } from '../../src/lib/render/steps';
import { parseQuantity } from '../../src/lib/vault/quantity';

const q = (raw: number | string) => {
	const p = parseQuantity(raw);
	if (!p.ok) throw new Error('bad qty');
	return { raw, value: p.value };
};

describe('fractions', () => {
	it('shows fractions as fractions', () => {
		expect(formatNumber(2 / 3)).toBe('⅔');
		expect(formatNumber(1.5)).toBe('1 ½');
		expect(formatNumber(0.667)).toBe('⅔');
		expect(formatNumber(0.125)).toBe('⅛');
		expect(formatNumber(3)).toBe('3');
		expect(formatNumber(0.3)).toBe('0,3');
		expect(formatNumber(0.3, 'en')).toBe('0.3');
		expect(formatNumber(250.5)).toBe('251');
		expect(formatNumber(22.5)).toBe('22,5');
		expect(formatNumber(1.999)).toBe('2');
	});
});

describe('temperature', () => {
	it('converts like an oven dial', () => {
		expect(toC(350)).toBe(180);
		expect(toC(375)).toBe(190);
		expect(toC(425)).toBe(220);
		expect(toF(180)).toBe(350);
		expect(toF(200)).toBe(400);
		expect(formatOven({ temp: 350, unit: 'F' })).toEqual({ written: '350 °F', converted: '180 °C' });
		expect(formatOven({ temp: 350, tempMax: 375, unit: 'F' }).converted).toBe('180–190 °C');
		expect(formatOven({ temp: 350, tempMax: 360, unit: 'F' })).toEqual({ written: '350–360 °F', converted: '180 °C' });
	});
});

describe('scale and durations', () => {
	it('scales by servings', () => {
		expect(scaleFactor({ servings: 4 }, 6)).toBe(1.5);
		expect(scaleFactor({}, 6)).toBe(1);
	});
	it('formats durations', () => {
		expect(formatSeconds(5400)).toBe('1 h 30');
		expect(formatSeconds(3600)).toBe('1 h');
		expect(formatSeconds(1500)).toBe('25 min');
		expect(formatDurationValue({ raw: '45m-50m', seconds: 2700, maxSeconds: 3000 })).toBe('45–50 min');
		expect(formatDurationValue({ raw: '1h-1h30m', seconds: 3600, maxSeconds: 5400 })).toBe('1 h à 1 h 30');
	});
});

describe('ingredient lines', () => {
	const fr = { lang: 'fr' as const };
	it('reads naturally in Québec French', () => {
		expect(ingredientText({ qty: q(2), unit: 'cup', name: 'farine', prep: 'tamisée' }, fr)).toBe('2 tasses de farine tamisée');
		expect(ingredientText({ qty: q(2), unit: 'clove', name: 'ail' }, fr)).toBe('2 gousses d’ail');
		expect(ingredientText({ qty: q(1), unit: 'tsp', name: 'sel' }, fr)).toBe('1 c. à thé de sel');
		expect(ingredientText({ qty: q('2/3'), unit: 'cup', name: 'sirop d’érable' }, fr)).toBe('⅔ tasse de sirop d’érable');
		expect(ingredientText({ qty: q('1 1/2'), unit: 'lb', name: 'boeuf haché' }, fr)).toBe('1 ½ lb de boeuf haché');
		expect(ingredientText({ qty: q(3), unit: 'piece', name: 'oignons', note: 'gros' }, fr)).toBe('3 oignons (gros)');
		expect(ingredientText({ name: 'sel', toTaste: true }, fr)).toBe('sel, au goût');
		expect(ingredientText({ qty: q(6), qtyMax: q(8), unit: 'tbsp', name: 'eau' }, fr)).toBe('6 à 8 c. à table d’eau');
		expect(ingredientText({ qty: q(250), unit: 'ml', name: 'crème', alt: { qty: q(1), unit: 'cup' } }, fr)).toBe('250 ml (1 tasse) de crème');
		expect(ingredientText({ qty: q(2), unit: 'ml', name: 'cannelle', or: [{ qty: q(1), unit: 'ml', name: 'muscade' }] }, fr)).toBe(
			'2 ml de cannelle, ou 1 ml de muscade'
		);
		expect(ingredientText({ qty: q(1), unit: 'piece', name: 'pâte brisée', recipe: 'pate-brisee', buyInstead: true }, fr)).toBe(
			'1 pâte brisée — ou acheter : pâte brisée du commerce'
		);
		expect(ingredientText({ name: 'noix', optional: true }, fr)).toBe('noix (facultatif)');
		expect(ingredientText({ qty: q('250 [?]'), unit: 'g', name: 'noix' }, fr)).toBe('250 g [?] de noix');
	});
	it('rescales every quantity, ranges and alternatives too', () => {
		expect(formatAmount({ qty: q(2), qtyMax: q(3), unit: 'cup' }, { lang: 'fr', factor: 0.5 })).toBe('1 à 1 ½ tasse');
		expect(ingredientText({ qty: q(250), unit: 'ml', name: 'lait', alt: { qty: q(1), unit: 'cup' } }, { lang: 'fr', factor: 2 })).toBe(
			'500 ml (2 tasses) de lait'
		);
	});
	it('reads in English', () => {
		expect(ingredientText({ qty: q('1/3'), unit: 'cup', name: 'butter', prep: 'melted' }, { lang: 'en' })).toBe('⅓ cup butter, melted');
		expect(ingredientText({ qty: q(2), unit: 'cup', name: 'flour' }, { lang: 'en' })).toBe('2 cups flour');
	});
});

describe('markers and markdown', () => {
	it('splits text around markers', () => {
		expect(segments('beurre [illisible] fondu [?: 2]')).toEqual([
			{ text: 'beurre ' },
			{ text: '[illisible]', marker: 'illegible' },
			{ text: ' fondu ' },
			{ text: '[?: 2]', marker: 'uncertain-alt', alternative: '2' }
		]);
	});
	it('never lets raw HTML through', () => {
		const html = renderMarkdown('1. Mélanger <script>alert(1)</script> <img src=x onerror=alert(1)>');
		expect(html).not.toContain('<script');
		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;script&gt;');
	});
	it('styles markers and resolves wikilinks, dead ones as text', () => {
		const html = renderInline('voir [[pate-brisee]] et [[absente]], cuire [?] 20 min [+]', {
			resolve: (s) => (s === 'pate-brisee' ? 'Pâte brisée' : undefined)
		});
		expect(html).toContain('<a class="wikilink" href="/r/pate-brisee">Pâte brisée</a>');
		expect(html).toContain('<span class="wikilink dead" title="Recette absente">absente</span>');
		expect(html).toContain('<mark class="mk mk-uncertain"');
		expect(html).toContain('<mark class="mk mk-added"');
	});
	it('renumbers steps', () => {
		expect(renderMarkdown('1. a\n1. b\n1. c')).toMatch(/<ol>\s*<li>a<\/li>\s*<li>b<\/li>/);
	});
});

describe('method steps display', () => {
	const BODY = '## Préparation\n\n1. Un.\n1. Deux.\n- Trois.\n  - détail\n\n### Glaçage\n\n4) Quatre.\n\n## Variantes\n\n- Autre.\n';

	it('shows steps as bullets by default, whatever the file wrote', () => {
		const html = renderMarkdown(BODY);
		expect(html).not.toContain('<ol');
		expect(html.match(/<ul class="steps">/g)).toHaveLength(3);
		expect(html).toContain('<ul class="steps">\n<li>Trois.\n<ul>\n<li>détail</li>');
		expect(html).toContain('<h2>Variantes</h2>\n<ul>\n<li>Autre.</li>');
	});

	it('numbers steps 1…n across the method when asked', () => {
		const html = renderMarkdown(BODY, { numbered: true });
		expect([...html.matchAll(/<li value="(\d+)">/g)].map((m) => m[1])).toEqual(['1', '2', '3', '4']);
		expect(html).not.toContain('start=');
		expect(html.match(/<ol class="steps">/g)).toHaveLength(3);
		// Nested and non-method lists stay bullets.
		expect(html).toContain('<li value="3">Trois.\n<ul>\n<li>détail</li>');
		expect(html).toContain('<h2>Variantes</h2>\n<ul>\n<li>Autre.</li>');
	});

	it('finds the method under a title heading, as the parser does', () => {
		expect(renderMarkdown('## Tarte\n\n### Préparation\n\n- Cuire.\n', { numbered: true })).toContain('<ol class="steps">\n<li value="1">Cuire.</li>');
		expect(renderMarkdown('## Notes\n\n- Froid.\n', { numbered: true })).toContain('<ul>\n<li>Froid.</li>');
	});
});

describe('timers', () => {
	const found = (s: string) => findDurations(s).map((d) => [d.text, d.seconds, d.maxSeconds]);
	it('finds durations in step text', () => {
		expect(found('Laisser réduire 25 min à feu doux.')).toEqual([['25 min', 1500, undefined]]);
		expect(found('Cuire 1 h 30 au four.')).toEqual([['1 h 30', 5400, undefined]]);
		expect(found('Cuire 45-50 minutes.')).toEqual([['45-50 minutes', 2700, 3000]]);
		expect(found('Cuire 35 à 40 min à 350 °F.')).toEqual([['35 à 40 min', 2100, 2400]]);
		expect(found('Laisser mijoter 1 heure.')).toEqual([['1 heure', 3600, undefined]]);
		expect(found('Bake 60 to 70 minutes.')).toEqual([['60 to 70 minutes', 3600, 4200]]);
		expect(found('Ajouter 2 tasses de lait et 350 g de farine.')).toEqual([]);
	});
	it('formats a countdown', () => {
		expect(clock(90_000)).toBe('1:30');
		expect(clock(3_725_000)).toBe('1:02:05');
		expect(clock(-5)).toBe('0:00');
	});
});

describe('step ingredients', () => {
	it('matches names in step text, accent-, case- and plural-insensitive', () => {
		const r = checkRecipe(readFileSync('tests/fixtures/vault/recipes/lasagna-bolognaise.md', 'utf8')).recipe!;
		const names = (s: string) => stepIngredients(s, r.ingredients, { suffixes: ['x', 's'], minLength: 4 }).map((x) => x.ingredient.name);
		expect(names("Ajouter l'ail, puis le boeuf haché. Laisser colorer.")).toEqual(['bœuf haché', 'ail']);
		expect(names('Faire revenir les oignons.')).toEqual(['oignon']);
		expect(names('Rien ici.')).toEqual([]);
	});
	it('takes its plural endings from the vault (vocab/normalize.yaml), none without it', () => {
		const r = checkRecipe(readFileSync('tests/fixtures/vault/recipes/lasagna-bolognaise.md', 'utf8')).recipe!;
		expect(stepIngredients('Faire revenir les oignons.', r.ingredients).map((x) => x.ingredient.name)).toEqual([]);
		expect(stepIngredients('Faire revenir l’oignon.', r.ingredients).map((x) => x.ingredient.name)).toEqual(['oignon']);
		expect(stepIngredients('Faire revenir les oignonz.', r.ingredients, { suffixes: ['z'], minLength: 4 }).map((x) => x.ingredient.name)).toEqual(['oignon']);
	});
});
