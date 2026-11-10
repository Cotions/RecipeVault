// Which known tag a pending tag is "the same word" as, sure enough to be
// preselected under « C'est comme… » on /etiquettes (docs/VOCAB.md, "Tags").
// W501's suggestion (vaultvocab.ts, two edits) is a hint for a typo; picked for
// her, it filed « carrés » under Tarte (« tartes », two letters off) and
// « pain » under Plat principal (« main »). Preselected only:
//
// - the same word but for its ending (plural, feminine, accents): « soupes »,
//   « légume », « tarte » for « tartes »;
// - a typo in a word of five letters or more, one edit away (two from eight),
//   first letter kept: « desert » for « dessert ».
//
// A food word (`food`: the pending tag names an ingredient of the registry,
// « pain », « carrés » is not one) takes only the first: a one-letter change
// there is another food, never a course. Browser-safe.

import { editDistance, fold } from './normalize';
import { stripMarkers } from './markers';

/** A word without its plural or feminine ending: « tartes » → « tart », « légume » → « legum ». */
function stem(word: string): string {
	let w = word;
	if (w.length > 3 && /[sx]$/.test(w)) w = w.slice(0, -1);
	if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
	return w;
}

const words = (s: string) => fold(stripMarkers(s)).split(/[\s-]+/).filter(Boolean);

/** The two read as one word but for their endings, word by word. */
export function sameStem(a: string, b: string): boolean {
	const [x, y] = [words(a), words(b)];
	return x.length > 0 && x.length === y.length && x.every((w, i) => stem(w) === stem(y[i]));
}

/** A typo of the other: one edit in five letters or more, two from eight, the first letter the same. */
export function typoOf(a: string, b: string): boolean {
	const [x, y] = [words(a).join(' '), words(b).join(' ')];
	if (x.length < 5 || !y || x[0] !== y[0]) return false;
	return editDistance(x, y) <= (x.length >= 8 ? 2 : 1);
}

/**
 * The canonical tag to preselect for pending tag `tag`, or undefined: the
 * first canonical tag (alias or slug) of `tags` that is the same word, by the
 * rules above. `tags`: folded alias or canonical → canonical (VaultVocab.tags).
 */
export function preselectTag(tags: ReadonlyMap<string, string>, tag: string, opts: { food?: boolean } = {}): string | undefined {
	let typo: string | undefined;
	for (const [alias, canonical] of [...tags].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]))) {
		if (sameStem(tag, alias)) return canonical;
		if (!opts.food && !typo && typoOf(tag, alias)) typo = canonical;
	}
	return typo;
}

/**
 * A tag written without its accents (`erable`) when the recipe's own text
 * writes the word with them (« sirop d'érable »): the tag with those accents,
 * in the tag's case, word by word (`Erable` → `Érable`). The most used
 * accented form wins. Undefined when no word gains an accent — a tag that
 * has accents already, or a word the text never writes another way.
 */
export function withAccents(value: string, text: string): string | undefined {
	const seen = new Map<string, Map<string, number>>();
	for (const [w] of text.normalize('NFC').matchAll(/\p{L}+/gu)) {
		const lower = w.toLowerCase();
		const key = fold(lower);
		if (key === lower) continue;
		const forms = seen.get(key) ?? new Map<string, number>();
		seen.set(key, forms.set(lower, (forms.get(lower) ?? 0) + 1));
	}
	let changed = false;
	const out = value.normalize('NFC').replace(/\p{L}+/gu, (w) => {
		if (fold(w) !== w.toLowerCase()) return w;
		const best = [...(seen.get(fold(w)) ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0];
		if (!best) return w;
		changed = true;
		return w === w.toUpperCase() && w.length > 1 ? best.toUpperCase() : w[0] === w[0].toUpperCase() ? best[0].toUpperCase() + best.slice(1) : best;
	});
	return changed ? out : undefined;
}
