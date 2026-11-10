// The search's own small word lists (docs/VOCAB.md, "Search words"): words a
// search drops, and words that stand for each other. Not vault data: the vault
// vocabulary has no place for them (tags.yaml names tags, the registry names
// ingredients), and they are about how people ask, not about any recipe.
// Every word is folded (no accents, lower case), as search.ts compares them.

/**
 * Words that say nothing alone (« la tourtière de ma tante »). Next to other
 * words a search drops them; alone, one matches only itself, never as the
 * start of a longer word (« ma » is not « maigre »).
 */
export const STOP_WORDS = new Set([
	'a', 'au', 'aux', 'avec', 'ce', 'cet', 'cette', 'chez', 'd', 'de', 'des', 'du', 'en', 'et', 'l', 'la', 'le', 'les', 'ma', 'mes', 'mon',
	'ou', 'par', 'pour', 'sa', 'ses', 'son', 'sur', 'ta', 'tes', 'ton', 'un', 'une', 'and', 'an', 'my', 'of', 'the', 'with', 's'
]);

/**
 * How a group's other names match: `prefix` like a typed word (the kin words:
 * « matante » finds « Matantes »); `word` as a whole word or its plural (the
 * dish words: « tarte » finds « tartes », never « tartelette »).
 */
export interface WordGroup {
	end: 'prefix' | 'word';
	/** Each name, its words separated by spaces. */
	names: string[];
}

/**
 * Words that stand for each other, every way. Kin words as a Québec card
 * writes who a recipe is from (« Matante Rollande », « Mononc' Gilles »,
 * « Mémère »), in both languages; and the dish words an English speaker
 * types for a French title (« carrot cake » → « Gâteau aux carottes »).
 */
export const WORD_GROUPS: WordGroup[] = [
	{ end: 'prefix', names: ['tante', 'matante', 'ma tante', 'aunt', 'auntie'] },
	{ end: 'prefix', names: ['oncle', 'mononc', 'mononcle', 'mon oncle', 'uncle'] },
	{ end: 'prefix', names: ['memere', 'grand mere', 'grandmere', 'grand maman', 'grandmaman', 'grandma', 'granny', 'grandmother'] },
	{ end: 'prefix', names: ['pepere', 'grand pere', 'grandpere', 'grand papa', 'grandpapa', 'grandpa', 'grandfather'] },
	{ end: 'word', names: ['gateau', 'cake'] },
	{ end: 'word', names: ['tarte', 'pie'] },
	{ end: 'word', names: ['carre', 'square'] },
	{ end: 'word', names: ['biscuit', 'cookie'] },
	{ end: 'word', names: ['pain', 'bread'] },
	{ end: 'word', names: ['soupe', 'soup', 'potage'] },
	{ end: 'word', names: ['ragout', 'stew'] },
	{ end: 'word', names: ['boulette', 'meatball'] },
	{ end: 'word', names: ['pouding', 'pudding'] },
	{ end: 'word', names: ['confiture', 'jam'] },
	{ end: 'word', names: ['beigne', 'donut', 'doughnut'] },
	{ end: 'word', names: ['crepe', 'pancake'] },
	{ end: 'word', names: ['salade', 'salad'] },
	{ end: 'word', names: ['grands peres', 'dumpling'] },
	{ end: 'word', names: ['sucre a la creme', 'fudge'] },
	{ end: 'word', names: ['erable', 'maple'] },
	{ end: 'word', names: ['bonbon', 'candy'] }
];

/**
 * Names that head with a word without being a kind of it: allspice is called
 * « piment de la Jamaïque », but it is a spice, not a pepper. A search for the
 * head word (« piment ») leaves them out, and offers each apart under « Aussi
 * : piment de la Jamaïque (2) » when the box has it. Folded, words separated
 * by spaces; an ingredient entry with such a name is held apart whole.
 */
export const NOT_THEIR_HEAD = ['piment de la jamaique', 'poivre de la jamaique', 'noix de muscade', 'noix de coco'];

/** The group a run of folded words names (as a whole name, or its plural), or null. */
export function groupOf(run: string[]): WordGroup | null {
	const k = run.join(' ');
	const one = k.replace(/[sx]$/, '');
	return WORD_GROUPS.find((g) => g.names.some((n) => n === k || n === one)) ?? null;
}
