import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkBatch, checkRecipe } from '../../src/lib/vault/check';

const DIR = 'tests/fixtures/check';
const md = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
const read = (dir: string, f: string) => ({ name: f, text: readFileSync(join(dir, f), 'utf8') });
const errorCodes = (ds: { code: string; severity: string }[]) => [...new Set(ds.filter((d) => d.severity === 'error').map((d) => d.code))];

/** Every E-code this checker implements; each needs an invalid fixture. */
const IMPLEMENTED = [
	'E001', 'E002', 'E101', 'E102', 'E103', 'E104', 'E105', 'E106', 'E107', 'E108', 'E109', 'E110', 'E111', 'E112',
	'E200', 'E201', 'E202', 'E203', 'E204', 'E205', 'E206', 'E207', 'E208', 'E209', 'E210', 'E211', 'E212', 'E213',
	'E214', 'E215', 'E216', 'E217', 'E218', 'E301'
];

describe('valid fixtures', () => {
	const files = [...md(`${DIR}/valid`).map((f) => read(`${DIR}/valid`, f)), read('tests/fixtures/vault/recipes', 'lasagna-bolognaise.md')];

	it.each(files.map((f) => [f.name, f.text]))('%s has no errors', (_, text) => {
		const r = checkRecipe(text);
		expect(errorCodes(r.diagnostics)).toEqual([]);
		expect(r.recipe).toBeDefined();
	});

	it('have no errors checked together', () => {
		const r = checkBatch(files);
		expect(r.files.flatMap((f) => errorCodes(f.diagnostics))).toEqual([]);
	});
});

describe('invalid fixtures', () => {
	const files = md(`${DIR}/invalid`);

	it.each(files)('%s fires its code and no other error', (f) => {
		const code = f.slice(0, 4);
		const { diagnostics } = checkRecipe(read(`${DIR}/invalid`, f).text);
		if (code[0] === 'W') {
			// A warning: the file saves, the warning is there.
			expect(errorCodes(diagnostics)).toEqual([]);
			expect(diagnostics.some((d) => d.code === code)).toBe(true);
		} else if (code === 'E112') {
			// Stripped with a note on the paste path, not a rejection.
			expect(diagnostics.filter((d) => d.code === 'E112').every((d) => d.severity === 'info')).toBe(true);
			expect(diagnostics.some((d) => d.code === 'E112')).toBe(true);
			expect(errorCodes(diagnostics)).toEqual([]);
		} else {
			expect(errorCodes(diagnostics)).toEqual([code]);
		}
	});

	it.each(md(`${DIR}/invalid`).map((f) => [f]))('%s: every error states a fix', (f) => {
		const { diagnostics } = checkRecipe(read(`${DIR}/invalid`, f).text);
		for (const d of diagnostics.filter((x) => x.severity === 'error' || x.code === f.slice(0, 4))) expect(d.fix, d.code).toBeTruthy();
	});
});

describe('batch fixtures', () => {
	const dirs = readdirSync(`${DIR}/batch`).sort();

	it.each(dirs)('%s fires its code and no other error', (dir) => {
		const code = dir.slice(0, 4);
		const r = checkBatch(md(`${DIR}/batch/${dir}`).map((f) => read(`${DIR}/batch/${dir}`, f)));
		for (const f of r.files) expect(errorCodes(f.diagnostics)).toEqual([code]);
	});
});

describe('coverage', () => {
	it('every implemented E-code has a fixture', () => {
		const covered = new Set([...md(`${DIR}/invalid`), ...readdirSync(`${DIR}/batch`)].map((f) => f.slice(0, 4)));
		expect(IMPLEMENTED.filter((c) => !covered.has(c))).toEqual([]);
	});
});
