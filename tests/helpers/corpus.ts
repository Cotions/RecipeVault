// The invented card corpus (tests/fixtures/corpus/, see its README) and its
// answer key, loaded for the ingredient-resolution metrics (plan 03, Phase 0).
// Public test data: the metrics run in the normal suite.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { checkFile } from '../../src/lib/vault/check';
import { stripMarkers } from '../../src/lib/vault/markers';
import type { Ingredient } from '../../src/lib/vault/types';

export const CORPUS_DIR = 'tests/fixtures/corpus';

export interface AnswerKey {
	recipes: number;
	occurrences: number;
	ingredients: Record<string, { category: string; staple?: boolean; variants: string[] }>;
	ambiguous: Record<string, { candidates: string[]; occurrences: number }>;
	confusables: [string, string][];
}

/** One written ingredient name in a corpus recipe: an item or an `or` option. */
export interface Occurrence {
	file: string;
	path: string;
	/** As written, markers stripped: the answer key's form. */
	name: string;
	lang: string;
	/** Sub-recipe line. */
	recipe?: string;
	item?: string;
}

export interface Corpus {
	files: string[];
	/** Files the checker could not read into a recipe. */
	unreadable: string[];
	occurrences: Occurrence[];
	key: AnswerKey;
	/** Written form → expected id, or 'ambiguous'. */
	expected: Map<string, string>;
	/** Written forms listed twice in the answer key. */
	duplicates: string[];
	/** Written forms in the corpus the answer key does not list. */
	missing: string[];
}

export const AMBIGUOUS = 'ambiguous';

export function loadCorpus(dir = CORPUS_DIR): Corpus {
	const key = parse(readFileSync(join(dir, 'expected-ingredients.yaml'), 'utf8')) as AnswerKey;
	const expected = new Map<string, string>();
	const duplicates: string[] = [];
	const own = (name: string, id: string) => {
		if (expected.has(name)) duplicates.push(`${name}: ${expected.get(name)}, ${id}`);
		expected.set(name, id);
	};
	for (const [id, v] of Object.entries(key.ingredients)) for (const n of v.variants) own(n, id);
	for (const n of Object.keys(key.ambiguous ?? {})) own(n, AMBIGUOUS);

	const files = readdirSync(join(dir, 'recipes'))
		.filter((f) => f.endsWith('.md'))
		.sort();
	const unreadable: string[] = [];
	const occurrences: Occurrence[] = [];
	for (const file of files) {
		const { recipe } = checkFile(readFileSync(join(dir, 'recipes', file), 'utf8'));
		if (!recipe) {
			unreadable.push(file);
			continue;
		}
		const push = (it: Ingredient, path: string) =>
			occurrences.push({ file, path, name: stripMarkers(it.name), lang: recipe.lang, recipe: it.recipe, item: it.item });
		recipe.ingredients.forEach((g, gi) =>
			g.items.forEach((it, ii) => {
				const path = `ingredients[${gi}].items[${ii}]`;
				push(it, `${path}.name`);
				it.or?.forEach((o, j) => push(o, `${path}.or[${j}].name`));
			})
		);
	}
	const missing = [...new Set(occurrences.map((o) => o.name).filter((n) => !expected.has(n)))].sort();
	return { files, unreadable, occurrences, key, expected, duplicates, missing };
}

/** The language each written form is used in (first seen). */
export function formLangs(occurrences: Occurrence[]): Map<string, string> {
	const m = new Map<string, string>();
	for (const o of occurrences) if (!m.has(o.name)) m.set(o.name, o.lang);
	return m;
}
