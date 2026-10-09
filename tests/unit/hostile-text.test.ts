// Text from a paste or a web page goes through regexes on the server; Node runs
// one request at a time, so a pattern that turns quadratic on hostile input
// freezes the whole app. Each case here took seconds to minutes before.
import { describe, expect, it } from 'vitest';
import { segments } from '../../src/lib/render/markers';
import { renderMarkdown } from '../../src/lib/render/markdown';
import { formNumber } from '../../src/lib/server/ingredient';
import { findRecipes, parseIngredientLine, plain } from '../../src/lib/server/webimport';
import { findBadMarkers, findMarkers, stripMarkers } from '../../src/lib/vault/markers';

const N = 200_000;
const fast = (f: () => unknown) => {
	const t0 = performance.now();
	f();
	expect(performance.now() - t0).toBeLessThan(1000);
};

describe('linear on hostile text', () => {
	it.each([
		['[', '['.repeat(N)],
		['[?: ', '[?: a'.repeat(N / 5)],
		['[[a|', '[[a|'.repeat(N / 4)],
		['[a](', '[a]('.repeat(N / 4)],
		['spaces', ' '.repeat(N) + 'x'],
		['blank lines', ' \n'.repeat(N / 2) + 'x'],
		['markers and spaces', '[?] '.repeat(N / 4) + 'x']
	])('markers: %s', (_, s) => {
		fast(() => findMarkers(s, 'x'));
		fast(() => findBadMarkers(s));
		fast(() => stripMarkers(s));
		fast(() => segments(s));
		fast(() => renderMarkdown(s));
	});

	it.each([
		['<', '<'.repeat(N)],
		['form feeds', '\f'.repeat(N) + 'x'],
		['(', '1 tasse ' + '('.repeat(N)],
		['<script', '<script '.repeat(N / 8)],
		['open ld+json', '<script type="application/ld+json">'.repeat(N / 35)],
		['<html', '<html '.repeat(N / 6)]
	])('web import: %s', (_, s) => {
		fast(() => plain(s));
		fast(() => parseIngredientLine(s, 'fr'));
		fast(() => findRecipes(s));
	});

	it('a number typed in a form', () => {
		fast(() => formNumber('1'.repeat(N) + 'x'));
	});
});

describe('the rewritten patterns read the same', () => {
	it('a trailing "(…)" is the note, an earlier one stays in the name', () => {
		expect(parseIngredientLine('1 tasse farine (tamisée)', 'fr')).toMatchObject({ name: 'farine', note: 'tamisée' });
		expect(parseIngredientLine('2 œufs (gros) (battus)', 'fr')).toMatchObject({ name: 'œufs (gros)', note: 'battus' });
		expect(parseIngredientLine('sel ((au goût))', 'fr')).toEqual({ name: 'sel ((au goût))' });
	});

	it('plain keeps one newline for a blank run, tags dropped', () => {
		expect(plain('a<br> \n\n  <b>b</b>\f c')).toBe('a\nb \f c');
	});

	it('finds JSON-LD in any script tag spelling, skips others', () => {
		const html = `<SCRIPT src="x"></script><script id=a type='application/ld+json'>{"@type":"Recipe","name":"T"}</script><script type="application/ld+json">{"@type":"Recipe","name":"U"}</SCRIPT>`;
		expect(findRecipes(html).map((r) => r.name)).toEqual(['T', 'U']);
	});

	it('formNumber', () => {
		expect([formNumber('0,53'), formNumber('.5'), formNumber('12'), formNumber('1.'), formNumber('1.2.3')]).toEqual([0.53, 0.5, 12, NaN, NaN]);
	});
});
