import { describe, expect, it } from 'vitest';
import {
	appendPriceLine,
	csvRecords,
	currentPrices,
	isStale,
	parsePrices,
	PRICE_HEADER,
	priceLine,
	today
} from '../../src/lib/ingredients/prices';
import { formatMoney, formatPack } from '../../src/lib/render/money';

// Invented rows, invented shops.
const CSV = `${PRICE_HEADER}
2026-01-10,farine,4.99,CAD,2.5,kg,Épicerie Aubin,
2026-03-02,farine,5.49,CAD,2.5,kg,Marché Boivin,
2026-03-02,farine,5.29,CAD,2.5,kg,"Marché Boivin, rue Principale",même jour
2025-12-01,beurre,5.99,CAD,454,g,,
2026-04-01,beurre,4.50,USD,454,g,Frontière,
2026-02-14,inconnu,1,CAD,1,piece,,
`;

describe('parsePrices', () => {
	it('reads rows, quoted cells with commas, and the current price with a same-day tie to the later line', () => {
		const { rows, problems } = parsePrices(CSV, { currency: 'CAD', slugs: new Set(['farine', 'beurre']) });
		expect(rows).toHaveLength(6);
		expect(rows[2]).toMatchObject({ line: 4, shop: 'Marché Boivin, rue Principale', note: 'même jour', amount: 5.29, packQty: 2.5, packUnit: 'kg' });
		const cur = currentPrices(rows, 'CAD');
		expect(cur.get('farine')?.line).toBe(4);
		// The latest USD row is kept and shown, but the current price is the CAD one.
		expect(cur.get('beurre')).toMatchObject({ amount: 5.99, currency: 'CAD' });
		expect(problems.map((p) => [p.code, p.line])).toEqual([
			['W815', 6],
			['W814', 7]
		]);
	});

	it('skips and reports a line that does not read, with its line number', () => {
		const text = [
			PRICE_HEADER,
			'2026-13-01,farine,1,CAD,1,kg,,',
			'2026-01-01,Farine!,1,CAD,1,kg,,',
			'2026-01-01,farine,gratuit,CAD,1,kg,,',
			'2026-01-01,farine,1,CAD,0,kg,,',
			'2026-01-01,farine,1,CAD,1,livre,,',
			'2026-01-01,farine,1,CAD,1,kg,IGA, Laval,',
			'2026-01-01,farine,1,dollars,1,kg,,',
			'',
			'2026-01-02,farine,"1,25",,1,kg,,'
		].join('\n');
		const { rows, problems } = parsePrices(text, { currency: 'CAD' });
		expect(problems.map((p) => [p.code, p.line])).toEqual([2, 3, 4, 5, 6, 7, 8].map((l) => ['E813', l]));
		expect(problems[4].message).toMatch(/canonical/);
		// A decimal comma in a quoted cell, an empty currency: the config's.
		expect(rows).toEqual([expect.objectContaining({ line: 10, amount: 1.25, currency: 'CAD' })]);
	});

	it('reads nothing without the header (E812), and nothing from an empty file', () => {
		const { rows, problems } = parsePrices('2026-01-01,farine,1,CAD,1,kg,,\n', { currency: 'CAD' });
		expect(rows).toEqual([]);
		expect(problems).toMatchObject([{ code: 'E812', line: 1 }]);
		expect(parsePrices('', { currency: 'CAD' })).toEqual({ rows: [], problems: [] });
		// Columns in another order, CRLF and a BOM are fine.
		const other = parsePrices('﻿ingredient,date,pack_unit,pack_qty,amount\r\nsel,2026-01-01,kg,1,0.99\r\n', { currency: 'CAD' });
		expect(other.rows).toMatchObject([{ ingredient: 'sel', packUnit: 'kg', amount: 0.99, currency: 'CAD', line: 2 }]);
	});

	it('numbers records by the line they start on, across a quoted newline', () => {
		expect(csvRecords('a,b\n"x\ny",z\nc,d\n').map((r) => r.line)).toEqual([1, 2, 4]);
	});
});

describe('staleness', () => {
	it('flags a price more than a year old', () => {
		expect(isStale('2025-09-27', '2026-09-27')).toBe(false);
		expect(isStale('2025-09-26', '2026-09-27')).toBe(true);
		expect(today(new Date(2026, 0, 5))).toBe('2026-01-05');
	});
});

describe('writing a row', () => {
	const row = { date: '2026-09-27', ingredient: 'farine', amount: 4.5, currency: 'CAD', packQty: 2.5, packUnit: 'kg' as const, shop: 'Aubin, Laval', note: '' };
	it('quotes cells holding a comma or a quote', () => {
		expect(priceLine(row)).toBe('2026-09-27,farine,4.5,CAD,2.5,kg,"Aubin, Laval",');
		expect(priceLine({ ...row, shop: 'Chez "Jo"' })).toBe('2026-09-27,farine,4.5,CAD,2.5,kg,"Chez ""Jo""",');
	});
	it('appends: a header for a new file, a newline when the last line lacks one', () => {
		expect(appendPriceLine('', row)).toBe(`${PRICE_HEADER}\n${priceLine(row)}\n`);
		expect(appendPriceLine(`${PRICE_HEADER}\nx`, row)).toBe(`${PRICE_HEADER}\nx\n${priceLine(row)}\n`);
		const round = parsePrices(appendPriceLine('', row), { currency: 'CAD' });
		expect(round.rows).toEqual([{ ...row, line: 2 }]);
	});
});

describe('money', () => {
	it('formats with the configured locale and currency', () => {
		expect(formatMoney(1.78, { locale: 'fr-CA', currency: 'CAD' }).replace(/\s/g, ' ')).toBe('1,78 $');
		expect(formatMoney(1.78, { locale: 'en-US', currency: 'USD' })).toBe('$1.78');
		expect(formatPack(400, 'g')).toBe('400 g');
		expect(formatPack(6, 'piece')).toBe('6 pièces');
		expect(formatPack(1, 'can')).toBe('1 boîte');
	});
});
