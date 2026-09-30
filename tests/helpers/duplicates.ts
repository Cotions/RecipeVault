// Planted duplicates (plan 05, Phase 0.2): copies of corpus cards built inside
// the tests, never committed as corpus files, so plan 03's corpus figures stay
// as they are. For each card of a fixed sample, three copies a person could
// paste by mistake, each under another title and slug:
//
//   (a) `title`     the same card, nothing else changed;
//   (b) `reorder`   its lines in reverse order in each group, and one written
//                   form swapped for another form of the same ingredient
//                   (from the answer key, expected-ingredients.yaml);
//   (c) `minus-one` the same card with one counted line removed.
//
// A copy never carries the card's `family`/`variant`: a pasted transcription
// has none (the family is decided in the app, AI-TEMPLATE.md rule 19), and a
// copy in the card's own family would be a family pair (plan 05, Q16 C).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { checkFile, hasErrors } from '../../src/lib/vault/check';
import { stripMarkers } from '../../src/lib/vault/markers';
import { serialize } from '../../src/lib/vault/serialize';
import type { Ingredient, Recipe } from '../../src/lib/vault/types';
import { CORPUS_DIR, type AnswerKey } from './corpus';

export type PlantKind = 'title' | 'reorder' | 'minus-one';

export interface Planted {
	kind: PlantKind;
	/** The card it copies. */
	original: string;
	slug: string;
	text: string;
	/** For `reorder`: the form swapped, `from → to`; absent when no line had another form. */
	swapped?: string;
}

/** slug → dish key (tests/fixtures/corpus/expected-dishes.yaml). */
export function loadDishes(dir = CORPUS_DIR): Map<string, string> {
	return new Map(Object.entries(parse(readFileSync(join(dir, 'expected-dishes.yaml'), 'utf8')) as Record<string, string>));
}

/** Lines that count in an ingredient set (plan 05, Q10 A): not optional (item or group), not `to_taste`. */
export function countedLines(r: Recipe): Ingredient[] {
	return r.ingredients.flatMap((g) => (g.optional ? [] : g.items.filter((it) => !it.optional && !it.toTaste)));
}

/** The fixed sample: every `step`-th card (sorted by slug) with at least `min` counted lines. */
export function plantSample(texts: Map<string, string>, step = 12, min = 4): string[] {
	const ok = [...texts.keys()].sort().filter((slug) => {
		const r = checkFile(texts.get(slug)!).recipe;
		return !!r && countedLines(r).length >= min;
	});
	return ok.filter((_, i) => i % step === 0);
}

const TITLES: Record<PlantKind, (t: string) => string> = {
	title: (t) => `${t} de la boîte à recettes`,
	reorder: (t) => `${t} (deuxième fiche)`,
	'minus-one': (t) => `${t} d’une autre main`
};

/**
 * The three copies of each sampled card. `same(a, b, lang)` says whether two
 * written names are one ingredient for the vault (its resolver): the swap in
 * (b) takes the first other form of the line's id that it accepts.
 */
export function plantDuplicates(
	texts: Map<string, string>,
	sample: string[],
	key: AnswerKey,
	same: (a: string, b: string, lang: string) => boolean = () => true
): Planted[] {
	const idOf = new Map<string, string>();
	for (const [id, v] of Object.entries(key.ingredients)) for (const n of v.variants) idOf.set(n, id);
	const out: Planted[] = [];
	for (const original of sample) {
		const file = checkFile(texts.get(original)!);
		if (!file.recipe || !file.body) throw new Error(`${original}: not a recipe`);
		const base: Recipe = { ...file.recipe, family: undefined, variant: undefined };
		const copy = (kind: PlantKind, change: (r: Recipe) => Recipe, swapped?: string) => {
			const slug = `${original}-copie-${kind}`;
			const r = change({ ...structuredClone(base), title: TITLES[kind](stripMarkers(base.title)), slug });
			const text = serialize(r, file.body!);
			const back = checkFile(text);
			if (!back.recipe || hasErrors(back.diagnostics)) throw new Error(`planted ${slug} does not check: ${back.diagnostics.map((d) => d.code).join(', ')}`);
			out.push({ kind, original, slug, text, ...(swapped ? { swapped } : {}) });
		};
		copy('title', (r) => r);

		let swapped: string | undefined;
		copy(
			'reorder',
			(r) => {
				for (const g of r.ingredients) g.items.reverse();
				for (const it of countedLines(r)) {
					if (it.recipe) continue;
					const name = stripMarkers(it.name).trim();
					const id = idOf.get(name);
					const other = id ? key.ingredients[id].variants.find((v) => v !== name && same(name, v, r.lang)) : undefined;
					if (other) {
						swapped = `${name} → ${other}`;
						it.name = other;
						break;
					}
				}
				return r;
			},
			undefined
		);
		if (swapped) out[out.length - 1].swapped = swapped;

		copy('minus-one', (r) => {
			// The last counted line of the card: a fixed choice, not the easiest one.
			const lines = countedLines(r);
			const drop = lines[lines.length - 1];
			for (const g of r.ingredients) g.items = g.items.filter((it) => it !== drop);
			r.ingredients = r.ingredients.filter((g) => g.items.length);
			return r;
		});
	}
	return out;
}
