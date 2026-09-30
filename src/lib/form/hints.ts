// Hints on the form's fields (plan 04, Q9 A): inline, in plain French, never
// a code, never blocking. Two sources:
//
// - the name words (W302 preparation, W304 size, W607 brand), computed here,
//   live, from the same word lists the server checks with — each with its
//   one-tap fix (the word moved to préparation / note / marque);
// - the vault warnings (W501 tag, W502 family, W503 / W608 title, W505
//   ingredients close to another recipe, W303 / W305 / W306 names, W605
//   markers), from the server's check of the form
//   (`formCheck`, `formSave`), as `FormHint`s.
//
// Browser-safe.

import { findAtEdge, findInside, nameWords, type CheckWords } from '../vault/words';
import type { FormItem } from './model';

/** A vault warning on a form field, as the server sends it. */
export interface FormHint {
	code: 'W501' | 'W502' | 'W503' | 'W505' | 'W608' | 'W303' | 'W305' | 'W306' | 'W605';
	/** The row id (item, `or` entry, group) or `recipe`. */
	target: string;
	field: string;
	/** What the field holds: the tag, the family, the other recipe's title. */
	value?: string;
	/** The fix: the closest tag, the near family. */
	suggestion?: string;
	/** The suggested family's label. */
	label?: string;
	/** The other recipe (W503 / W505 / W608). */
	slug?: string;
}

/** The codes the form maps to a field; each has a French text in `formHintText` (src/lib/i18n/diagnostics.ts). */
export const FORM_HINT_CODES = ['W302', 'W304', 'W607', 'W501', 'W502', 'W503', 'W505', 'W608', 'W303', 'W305', 'W306', 'W605'] as const;

/** A word of the name that belongs in another field. */
export interface NameHint {
	code: 'W302' | 'W304' | 'W607';
	/** The field it belongs in. */
	field: 'prep' | 'note' | 'brand';
	/** The word(s) as she typed them. */
	word: string;
	/** The name without them. */
	rest: string;
}

/** The first name-word hint for a name: preparation, then size, then brand (the checker's order). */
export function nameHint(name: string, words: CheckWords | undefined): NameHint | undefined {
	if (!words || !name.trim()) return undefined;
	const n = nameWords(name);
	const prep = findAtEdge(n, words.participles);
	if (prep) return { code: 'W302', field: 'prep', word: prep.text, rest: prep.rest };
	const size = findAtEdge(n, words.descriptors);
	if (size) return { code: 'W304', field: 'note', word: size.text, rest: size.rest };
	const brand = findInside(n, words.brands);
	if (brand) return { code: 'W607', field: 'brand', word: brand.text, rest: brand.rest };
	return undefined;
}

/** The one-tap fix: the word leaves the name for its field, added in front of what the field holds (a brand replaces it). */
export function applyNameHint(item: FormItem, hint: NameHint): void {
	item.name = hint.rest;
	const had = item[hint.field].trim();
	item[hint.field] = had && hint.field !== 'brand' ? `${hint.word}, ${had}` : hint.word;
}
