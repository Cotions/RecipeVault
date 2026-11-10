// « Donne » as one field (UI pass, round 5): she types what the card says —
// « 8 », « 6 à 8 portions », « 2 tourtières », « 3 douzaines » — and the form
// files it as the schema has it (docs/RECIPE-SCHEMA.md): a count of portions
// is `servings` (and `servings_max`), anything else is the free `yield` text.
// Browser-safe, no state.

/** Words that mean portions, both languages: « 8 portions », « pour 4 personnes », « serves 6 ». */
const PORTION_WORDS = /^(?:portions?|personnes?|pers\.?|parts?|servings?|people|persons?)$/i;
const NUM = String.raw`\d+(?:[.,]\d+)?`;
/** « 8 », « 6 à 8 », « 6-8 », « pour 4 », « serves 4 », then an optional word. */
const SHAPE = new RegExp(String.raw`^(?:pour\s+|serves\s+)?(${NUM})(?:\s*(?:à|a|-|–|to)\s*(${NUM}))?(?:\s+(.+))?$`, 'i');

export interface Gives {
	/** Portions, as typed (the form's `servings` string); empty when the text is a yield. */
	servings: string;
	servingsMax: string;
	/** The free yield (`yield: "2 tourtières"`); empty when the text is portions. */
	yieldText: string;
}

/** What « Donne » holds: portions when it is a number (with « portions » or no word), else a yield in words. */
export function parseGives(text: string): Gives {
	const s = text.normalize('NFC').replace(/\s+/g, ' ').trim();
	if (!s) return { servings: '', servingsMax: '', yieldText: '' };
	const m = SHAPE.exec(s);
	if (m && (!m[3] || PORTION_WORDS.test(m[3].trim()))) return { servings: m[1], servingsMax: m[2] ?? '', yieldText: '' };
	return { servings: '', servingsMax: '', yieldText: s };
}

/**
 * The noun of a yield in words, after its leading amount: « 2 tourtières » →
 * « tourtières », « 4 pots de 500 ml » → « pots de 500 ml ». None when the
 * text does not start with a number (« environ 4 litres ») or is only one.
 */
export function yieldNoun(text: string): string | null {
	const m = new RegExp(String.raw`^(?:${NUM})(?:\s*(?:à|-|–)\s*${NUM})?\s+(\S.*)$`).exec(text.normalize('NFC').trim());
	return m ? m[1].trim() : null;
}

/** The leading amount she typed (« 2 », « 6 à 8 »), and what follows it: for the suggestions. */
export function splitAmount(text: string): { amount: string; rest: string } {
	const m = new RegExp(String.raw`^(${NUM}(?:\s*(?:à|-|–)\s*${NUM})?)\s*(.*)$`).exec(text.trimStart());
	return m ? { amount: m[1], rest: m[2] } : { amount: '', rest: text.trim() };
}
