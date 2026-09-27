import { describe, expect, it } from 'vitest';
import { parseRecipe } from '../../src/lib/vault/parse';

const wrap = (yaml: string, body = '\n## Préparation\n\n1. Y\n') => `---\n${yaml}\n---\n${body}`;

describe('parseRecipe', () => {
	it('parses frontmatter as YAML 1.2', () => {
		const r = parseRecipe(wrap('note: no\ntime: 1:30\nadded: 2026-09-26\noct: 010\nflag: yes'));
		expect(r.diagnostics).toEqual([]);
		expect(r.frontmatter).toEqual({ note: 'no', time: '1:30', added: '2026-09-26', oct: 10, flag: 'yes' });
	});

	it('normalizes CRLF, BOM and NFC before parsing', () => {
		const r = parseRecipe('﻿---\r\ntitle: Créme\r\n---\r\n');
		expect(r.frontmatter).toEqual({ title: 'Créme' });
	});

	it('treats an empty frontmatter as an empty mapping', () => {
		expect(parseRecipe('---\n---\n').frontmatter).toEqual({});
	});

	it.each([
		['', 'empty'],
		['## Préparation\n', 'does not start'],
		['```markdown\n---\ntitle: X\n---\n```\n', 'code fence'],
		['---\ntitle: X\n', 'no closing']
	])('E001 for %j', (text, words) => {
		const r = parseRecipe(text);
		expect(r.frontmatter).toBeUndefined();
		expect(r.diagnostics).toHaveLength(1);
		expect(r.diagnostics[0].code).toBe('E001');
		expect(r.diagnostics[0].message).toContain(words);
		expect(r.diagnostics[0].fix).toBeTruthy();
	});

	it('E002 carries the parser message with a file line number', () => {
		const r = parseRecipe(wrap('title: X\ntimes:\n  prep: 15m\n cook: 40m'));
		expect(r.diagnostics[0].code).toBe('E002');
		expect(r.diagnostics[0].message).toMatch(/at line 5, column \d+$/);
	});

	it('E002 on duplicate keys', () => {
		expect(parseRecipe(wrap('title: X\ntitle: Y')).diagnostics[0].code).toBe('E002');
	});

	it('E002 when the frontmatter is not a mapping', () => {
		expect(parseRecipe(wrap('- a\n- b')).diagnostics[0].code).toBe('E002');
	});

	it('E002 names the value to quote when a marker broke the YAML', () => {
		const a = parseRecipe(wrap('author: Jeanne Tremblay [?: Tremblé]'));
		expect(a.diagnostics[0].fix).toContain('`author: "Jeanne Tremblay [?: Tremblé]"`');
		const b = parseRecipe(wrap('ingredients:\n  - items:\n      - { qty: 1, unit: cup, name: farine [?] }'));
		expect(b.diagnostics[0].fix).toContain('`name: "farine [?]"`');
		const c = parseRecipe(wrap("ingredients:\n  - items:\n      - { qty: 1, unit: cup, name: pâte d'amande [?] }"));
		expect(c.diagnostics[0].fix).toContain('`name: "pâte d\'amande [?]"`');
	});
});
