// French agreement of a scaled bare count (docs/DATA-FLOW.md, "Names"):
// « 1 oignon haché » × 2 → « 2 oignons hachés », « 1 pâte à tarte » × 4 →
// « 4 pâtes à tarte ». Display only, browser-safe; the file never changes.
//
// The registry's own forms of a name come first (`nameForms`, ./ingredient.ts);
// these rules are the fallback for a line the registry gives none (an unlinked
// line, the paste preview, kitchen mode without the page's links). A small,
// deliberately cautious rule set: what it cannot read it leaves as written.

/** Words a name or a prep stops agreeing at: what follows belongs to another noun (« pâte à tarte », « en dés », « au goût »). */
const PREPOSITIONS = new Set(['à', 'a', 'au', 'aux', 'de', 'du', 'des', 'en', 'pour', 'sans', 'avec', 'dans', 'sur', 'par', 'si', 'selon', 'comme', 'type', 'environ']);

/** Words that never take the plural: colours from nouns, and labels (« poivrons orange », « sauces maison »). */
const INVARIABLE = new Set([
	'orange',
	'marron',
	'crème',
	'creme',
	'kaki',
	'moka',
	'chocolat',
	'maison',
	'nature',
	'bio',
	'extra',
	'light',
	'cocktail',
	'standard',
	'jumbo',
	'mini'
]);

/** The first part of a compound that never agrees (« mi-cuit » → « mi-cuits »). */
const PREFIXES = new Set(['mi', 'demi', 'semi', 'extra', 'sans', 'avant', 'arrière', 'garde']);

/** -al words that take -s, not -aux. */
const AL_S = new Set(['bal', 'carnaval', 'chacal', 'festival', 'récital', 'régal', 'banal', 'bancal', 'fatal', 'final', 'natal', 'naval']);
/** -au, -eau, -eu words that take -s, not -x. */
const EU_S = new Set(['landau', 'sarrau', 'bleu', 'pneu', 'émeu', 'lieu']);
/** -ou words that take -x. */
const OU_X = new Set(['bijou', 'caillou', 'chou', 'genou', 'hibou', 'joujou', 'pou']);
/** -ail words that take -aux. */
const AIL_AUX = new Set(['bail', 'corail', 'émail', 'soupirail', 'travail', 'vantail', 'vitrail']);

/** Adverbs and joiners inside a prep: skipped, the words around them agree (« finement haché », « pelé et tranché »). */
const PASS = new Set(['et', 'ou', 'bien', 'très', 'tres', 'puis', 'pas', 'trop', 'peu', 'assez', 'plus', 'légèrement']);

/**
 * A prep word that agrees with its noun: a past participle (« haché »,
 * « pilée », « cuit », « fondu », « ramolli », « ouvert ») or a common
 * adjective. Anything else ends the agreement: « coupé en dés » agrees
 * « coupé » only, an unknown word is left alone.
 */
const PARTICIPLE = /(?:é|ée|i|ie|u|ue|it|ite|ise|ert|erte|eint|einte)$/;
const ADJECTIVES = new Set([
	'fin',
	'fine',
	'gros',
	'grosse',
	'petit',
	'petite',
	'moyen',
	'moyenne',
	'grand',
	'grande',
	'froid',
	'froide',
	'chaud',
	'chaude',
	'tiède',
	'mûr',
	'mûre',
	'entier',
	'entière',
	'frais',
	'fraîche',
	'fraiche',
	'sec',
	'sèche',
	'ferme',
	'mou',
	'molle',
	'tendre',
	'épais',
	'épaisse',
	'mince',
	'rond',
	'ronde',
	'vert',
	'verte',
	'rouge',
	'jaune',
	'blanc',
	'blanche',
	'noir',
	'noire',
	'doux',
	'douce',
	'fort',
	'forte',
	'égal',
	'égale',
	'gelé',
	'congelé'
]);

/** A word as it can be read: letters, an inner hyphen; else (a digit, a marker, a parenthesis, an elision) it stops the agreement. */
const WORD = /^[\p{Ll}]+(?:-[\p{Ll}]+)*$/u;
/** Elided articles and prepositions (« d’ail », « l’ »): never part of the noun. */
const ELIDED = /^[dl][’']/i;

/** One French word in the plural (the noun or an adjective that agrees with it). */
export function pluralWordFr(w: string): string {
	if (!w || /[sxz]$/.test(w)) return w;
	if (INVARIABLE.has(w)) return w;
	if (w.includes('-')) {
		const parts = w.split('-');
		return parts.map((p, i) => (i < parts.length - 1 && PREFIXES.has(p) ? p : pluralWordFr(p))).join('-');
	}
	if (/al$/.test(w) && !AL_S.has(w)) return `${w.slice(0, -2)}aux`;
	if (AIL_AUX.has(w)) return `${w.slice(0, -3)}aux`;
	if (/(?:au|eu)$/.test(w) && !EU_S.has(w)) return `${w}x`;
	if (OU_X.has(w)) return `${w}x`;
	return `${w}s`;
}

const agrees = (w: string) => !INVARIABLE.has(w) && (ADJECTIVES.has(w) || PARTICIPLE.test(w));

/** Split keeping the spaces, so a line keeps its own spacing. */
const tokens = (s: string) => s.split(/(\s+)/);

/**
 * A name in the plural: each word before the first preposition (the head
 * noun and the adjectives that follow it), in its plural; what follows a
 * preposition belongs to another noun and stays (« pâtes à tarte »,
 * « pommes de terre », « clous de girofle »). A capitalised word (a variety,
 * a brand) and anything after a marker or a number stay as written.
 */
export function pluralNameFr(name: string): string {
	const parts = tokens(name);
	for (let i = 0; i < parts.length; i += 2) {
		const w = parts[i];
		if (!w) continue;
		if (PREPOSITIONS.has(w.toLowerCase()) || ELIDED.test(w)) break;
		if (!WORD.test(w)) {
			const capital = /^\p{Lu}[\p{Ll}-]*$/u.test(w);
			// The head word capitalised (« Pâte à tarte ») agrees; a capitalised word after it is a name (« pomme Cortland »), left as written.
			if (capital && i === 0) parts[i] = w.charAt(0) + pluralWordFr(w.slice(1));
			else if (!capital) break;
			continue;
		}
		parts[i] = pluralWordFr(w);
	}
	return parts.join('');
}

/**
 * A prep that agrees with its noun's number: its leading participles and
 * adjectives (« haché » → « hachés », « pelée et tranchée » → « pelées et
 * tranchées », « finement haché » → « finement hachés »), up to the first
 * preposition or word it cannot read (« coupé en dés » → « coupés en dés »;
 * « en dés », « au goût » never change). `plural` false takes such words
 * back to the singular.
 */
export function agreePrepFr(prep: string, plural: boolean): string {
	const parts = tokens(prep);
	for (let i = 0; i < parts.length; i += 2) {
		const w = parts[i];
		if (!w) continue;
		const lower = w.toLowerCase();
		if (PASS.has(lower) || /ment$/.test(lower)) continue;
		// A trailing comma ends the agreement after its word: « haché, égoutté » agrees « haché » only.
		const comma = /,$/.test(w);
		const bare = comma ? w.slice(0, -1) : w;
		if (PREPOSITIONS.has(bare.toLowerCase()) || ELIDED.test(bare) || !WORD.test(bare)) break;
		const stem = /s$/.test(bare) && !/ss$/.test(bare) ? bare.slice(0, -1) : '';
		let next: string;
		if (plural) {
			if (agrees(bare)) next = pluralWordFr(bare);
			else if (stem && agrees(stem)) next = bare;
			else break;
		} else if (ADJECTIVES.has(bare)) next = bare;
		else if (stem && agrees(stem)) next = stem;
		else if (agrees(bare)) next = bare;
		else break;
		parts[i] = comma ? `${next},` : next;
		if (comma) break;
	}
	return parts.join('');
}

/** French count agreement: plural from 2 (« 1 ½ oignon », « 2 oignons »), as the unit words (docs/VOCAB.md). */
export const pluralFr = (count: number) => count >= 2;
