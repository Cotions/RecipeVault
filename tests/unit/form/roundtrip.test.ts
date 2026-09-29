// The round-trip promise (plan 04, Phase 2.2): a recipe opened in the form and
// saved without a change serializes byte-identical to the canonical file the
// paste path writes, over every valid fixture and every corpus recipe.
// Allowed losses (Q4 A) are the serializer's own: YAML comments and unknown keys.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formText, fromForm, toForm } from '../../../src/lib/form/model';
import { checkFile } from '../../../src/lib/vault/check';
import { serialize } from '../../../src/lib/vault/serialize';

const DIRS = ['tests/fixtures/vault/recipes', 'tests/fixtures/check/valid', 'tests/fixtures/corpus/recipes'];

const files = DIRS.flatMap((d) =>
	readdirSync(d)
		.filter((f) => f.endsWith('.md'))
		.sort()
		.map((f) => ({ dir: d, name: f, text: readFileSync(join(d, f), 'utf8') }))
);

function roundTrip(text: string) {
	const file = checkFile(text);
	if (!file.recipe || !file.body) return undefined;
	const canonical = serialize(file.recipe, file.body);
	const form = toForm(file.recipe, file.body);
	const viaJson = JSON.parse(JSON.stringify(form));
	return { canonical, form, direct: formText(form), json: formText(viaJson), errors: fromForm(form).errors };
}

describe('form round trip', () => {
	it('reads every file', () => {
		expect(files.filter((f) => !checkFile(f.text).recipe).map((f) => f.name)).toEqual([]);
		expect(files.filter((f) => f.dir.endsWith('corpus/recipes'))).toHaveLength(320);
	});

	for (const dir of DIRS) {
		it(`${dir}: every file serializes byte-identical through the form, and through its JSON`, () => {
			const failed: string[] = [];
			let n = 0;
			for (const f of files.filter((x) => x.dir === dir)) {
				const r = roundTrip(f.text)!;
				n++;
				if (r.direct !== r.canonical || r.json !== r.canonical || r.errors.length) failed.push(f.name);
			}
			expect(failed).toEqual([]);
			expect(n).toBeGreaterThan(0);
		});
	}
});
