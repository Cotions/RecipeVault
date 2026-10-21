// Checker diagnostics in French and in English, for the people using the app
// (a cook, not a developer), each in the language of their account
// (../prefs.ts). The checker's own `message` / `fix` stay in English whatever
// the account: they feed the fix-request block (for the AI) and `vault check`
// (for the developer), and the UI keeps them behind a "Détail technique"
// disclosure because they carry the specifics (values, the suggested fix).
//
// One entry per code in src/lib/vault/codes.ts, in each language; a test
// fails on a code without one. Browser-safe.

import type { Fixer } from '../vault/codes';
import { localized } from './localized';

/** Per code: what is wrong and what to do, in plain words. */
export const codeText: Readonly<Record<string, string>> = localized({
	fr: {
		I701: 'Du texte a été ajouté à la transcription ([+]) : il n’est pas sur l’original. Il est affiché à part pour qu’on le reconnaisse. Rien à faire.',
		I702: 'L’IA a écrit du texte en dehors de la recette, peut-être une question. Ce texte n’est pas enregistré : lisez-le au cas où.',
		E001: 'Ce texte n’a pas la forme d’une fiche de recette : l’en-tête entre deux lignes « --- » manque ou n’est pas fermé. L’IA doit renvoyer la fiche complète.',
		E002: 'L’en-tête de la fiche est mal écrit et ne se lit pas (souvent un décalage ou des guillemets oubliés). L’IA doit le corriger.',
		E003: 'Deux recettes sont collées dans un seul bloc. Chaque recette doit avoir son propre bloc ```markdown.',
		E101: 'La recette n’a pas de titre.',
		E102: 'L’identifiant de la recette (le nom du fichier) doit être en minuscules, sans accents ni espaces, avec des traits d’union.',
		E103: 'Une recette porte déjà ce nom de fichier. Choisissez ci-dessus : remplacer l’ancienne, ou enregistrer celle-ci sous un autre nom.',
		E104: 'La langue de la recette doit être « fr » ou « en ».',
		E105: 'Un groupe de variantes sans ce qui distingue la variante, ou l’inverse : il faut les deux, ou aucun des deux.',
		E106: 'La provenance est mal écrite, ou son type n’est pas dans la liste (recette personnelle, livre, site web, magazine, télévision, inventée).',
		E107: 'La difficulté et la note vont de 1 à 5.',
		E108: 'Le nombre de portions doit être un nombre entier ; s’il y a un maximum, il doit être plus grand que le minimum.',
		E109: 'Un temps est mal écrit. Il s’écrit 30m, 1h, 1h15m, ou 45m-50m pour un intervalle.',
		E110: 'La version du format de la fiche (schema) manque ou est inconnue.',
		E111: 'Le four est mal indiqué : il faut une température en chiffres, avec F ou C.',
		E112: 'La fiche donne elle-même son état ou sa date d’ajout ; c’est l’application qui les fixe. Ils sont retirés à l’enregistrement : rien à faire.',
		E113: 'Le fichier a été renommé ou modifié hors de l’application : son identifiant ne correspond plus au nom du fichier. Renommez le fichier ou remettez l’identifiant.',
		E114: 'L’adresse web de la provenance doit être complète et commencer par https://.',
		E200: 'Il n’y a aucun ingrédient, ou un groupe d’ingrédients est vide.',
		E201: 'Unité inconnue. Il faut une unité de la liste : tasse → cup, c. à thé → tsp, c. à table → tbsp, livre → lb.',
		E202: 'Une unité est donnée sans quantité.',
		E203: 'Une quantité est donnée sans unité (pour des morceaux qu’on compte : piece).',
		E204: 'La quantité n’est ni un nombre ni une fraction comme 1 1/2 ou 2/3 (et pas de virgule décimale : 1.5).',
		E205: 'La quantité maximale est donnée sans quantité de départ, ou n’est pas plus grande qu’elle.',
		E206: 'Un ingrédient est à la fois « au goût » et mesuré : c’est l’un ou l’autre.',
		E207: 'Un ingrédient n’a pas de nom.',
		E208: 'Les ingrédients doivent être rangés en groupes, même quand il n’y en a qu’un.',
		E209: 'Le même ingrédient apparaît deux fois dans le même groupe.',
		E210: 'La quantité est écrite dans le nom de l’ingrédient (« 500 g de lait ») ; elle doit aller dans la quantité et l’unité.',
		E211: 'Le nom contient une virgule : sans doute deux ingrédients fusionnés, ou une précision qui va en note.',
		E212: '« Ou acheter » n’a de sens qu’avec une sous-recette.',
		E213: 'Des sous-recettes s’appellent l’une l’autre en boucle.',
		E214: 'L’autre mesure (alt) doit avoir une quantité et une unité, et rien d’autre.',
		E215: 'La liste des choix (« ou ») est mal écrite.',
		E216: 'Une quantité est écrite dans la note (« 2 lb ») ; elle doit aller dans la quantité et l’unité, ou dans les choix.',
		E217: 'Marque inconnue entre crochets. Seuls [?], [?: …], [illisible] et [+] sont permis.',
		E218: 'Un champ n’a pas la bonne forme — souvent une valeur qui commence par un crochet sans être entre guillemets.',
		E301: 'Aucune section de préparation reconnue : un titre de section inconnu est à la place.',
		W302: 'Le nom contient une préparation (haché, râpé…) ; elle devrait être à part, en préparation.',
		W303: 'Cet ingrédient n’est relié à aucun ingrédient connu, et rien n’y ressemble. Créez-le dans « À relier ».',
		W304: 'Le nom contient une taille (gros, petit…) ; elle devrait aller en note.',
		W305: 'Cet ingrédient n’est pas encore relié, mais un ingrédient connu y ressemble. Confirmez-le dans « À relier ».',
		W307: 'Le champ item de cet ingrédient nomme un ingrédient qui n’existe pas dans la liste des ingrédients.',
		W306: 'La sous-recette n’est pas encore dans le coffre. Ajoutez-la quand vous pourrez : le lien fonctionnera alors.',
		W401: 'Il n’y a pas de section « Préparation ».',
		W402: 'Une étape est très longue : sans doute plusieurs étapes collées ensemble.',
		W403: 'La préparation est en paragraphes, sans étapes numérotées ni tirets : le mode cuisine ne pourra pas la montrer étape par étape.',
		W501: 'Étiquette hors du vocabulaire du coffre. Elle est gardée, marquée à revoir : prenez l’étiquette proposée, ou ajoutez-la à vocab/tags.yaml.',
		W502: 'Le nom du groupe de variantes ressemble beaucoup à un groupe existant (une faute de frappe ?). Vérifiez-le.',
		W503: 'Une recette au titre presque identique existe déjà : c’est peut-être un doublon.',
		W504: 'Saison inconnue : ce doit être printemps, été, automne ou hiver.',
		W505: 'Une recette du coffre, ou un fichier plus haut dans ce collage, a presque les mêmes ingrédients : peut-être la même fiche en double. Si ce sont deux variantes du même plat, regroupez-les.',
		W601: 'Le nombre de portions n’est pas indiqué. Rien à faire si l’original ne le dit pas.',
		W602: 'Aucun temps n’est indiqué. Rien à faire si l’original ne le dit pas.',
		W603: 'Pas de photo du plat.',
		W604: 'La provenance n’est pas indiquée : on ne saura pas d’où vient la recette.',
		W605: 'Une lecture est incertaine ([?]) ou illisible. À vérifier sur l’original ; la recette reste « À relire » en attendant.',
		W606: '« Au goût » sur un ingrédient qui n’est pas un assaisonnement : il faudrait plutôt le nom seul, sans quantité.',
		W607: 'Le nom contient une marque de commerce ; elle devrait être à part, en marque.',
		W608: 'Une recette porte déjà ce titre. Vous pouvez en faire deux variantes du même plat (case ci-dessus).',
		W609: 'Une étape parle d’une température de four, mais le four n’est pas indiqué dans la fiche.',
		W610: 'Champ inconnu (une faute de frappe ?) : sa valeur est ignorée.',
		E801: 'Cette fiche d’ingrédient ne se lit pas : l’en-tête entre deux lignes « --- » manque ou est mal écrit.',
		E802: 'L’identifiant de l’ingrédient doit être en minuscules, sans accents, avec des traits d’union, et pareil au nom du fichier.',
		E803: 'La catégorie de l’ingrédient manque ou n’est pas dans la liste (frais, viande, légume, épicerie…).',
		E804: 'L’ingrédient n’a aucun nom, ou ses noms sont mal écrits (une liste en français, une en anglais).',
		E805: 'La densité ou un poids par unité doit être un nombre plus grand que zéro, en grammes.',
		E806: 'L’unité par défaut de l’ingrédient n’est pas une unité connue.',
		E807: 'Un champ de l’ingrédient n’a pas la bonne forme : « oui/non » attendu, ou une liste d’identifiants.',
		W808: 'Un substitut indiqué n’existe pas (ou c’est l’ingrédient lui-même). Créez-le ou retirez-le.',
		W809: 'Allergène hors de la liste : il est ignoré. Choisissez-en un de la liste.',
		W810: 'Deux ingrédients portent le même nom : les recettes qui l’écrivent restent non reliées. Gardez-le sous un seul.',
		W811: 'Champ inconnu dans la fiche d’ingrédient (une faute de frappe ?) : il est ignoré.',
		E812: 'Le fichier des prix doit commencer par sa ligne de titres (date, ingredient, amount…) : aucun prix n’est lu.',
		E813: 'Cette ligne du fichier des prix ne se lit pas (date, montant, format ou unité) : elle est ignorée.',
		W814: 'Ce prix vise un ingrédient qui n’est pas au registre : il est gardé, mais ne sert pas.',
		W815: 'Ce prix est dans une autre monnaie : il est affiché, mais ne compte pas dans le coût des recettes.',
		E820: 'Une règle « when » de l’ingrédient est mal écrite : il lui faut des noms et au moins une condition (langue, unité ou mots).',
		W821: 'Deux ingrédients ont une règle pour le même nom qui peut valoir sur la même ligne : ces recettes restent non reliées. Rendez les conditions distinctes.'
	},
	en: {
		I701: 'Text was added to the transcription ([+]): it is not on the original. It is shown apart so it can be recognized. Nothing to do.',
		I702: 'The AI wrote text outside the recipe, perhaps a question. That text is not saved: read it just in case.',
		E001: 'This text is not in the shape of a recipe card: the header between two “---” lines is missing or not closed. The AI must send back the complete card.',
		E002: 'The card’s header is badly written and cannot be read (often an indentation slip or forgotten quotation marks). The AI must correct it.',
		E003: 'Two recipes are pasted into a single block. Each recipe must have its own ```markdown block.',
		E101: 'The recipe has no title.',
		E102: 'The recipe’s identifier (the file name) must be in lowercase, with no accents or spaces, with hyphens.',
		E103: 'A recipe already has this file name. Choose above: replace the old one, or save this one under another name.',
		E104: 'The recipe’s language must be “fr” or “en”.',
		E105: 'A group of variants without what sets the variant apart, or the reverse: it takes both, or neither.',
		E106: 'The source is badly written, or its type is not in the list (personal recipe, book, website, magazine, television, invented).',
		E107: 'Difficulty and rating go from 1 to 5.',
		E108: 'The number of servings must be a whole number; if there is a maximum, it must be greater than the minimum.',
		E109: 'A time is badly written. It is written 30m, 1h, 1h15m, or 45m-50m for a range.',
		E110: 'The card’s format version (schema) is missing or unknown.',
		E111: 'The oven is badly given: it needs a temperature in digits, with F or C.',
		E112: 'The card gives its own status or date added; the app sets those. They are removed on saving: nothing to do.',
		E113: 'The file was renamed or changed outside the app: its identifier no longer matches the file name. Rename the file or put the identifier back.',
		E114: 'The source’s web address must be complete and start with https://.',
		E200: 'There are no ingredients, or an ingredient group is empty.',
		E201: 'Unknown unit. It must be a unit from the list: cup → cup, teaspoon → tsp, tablespoon → tbsp, pound → lb.',
		E202: 'A unit is given without a quantity.',
		E203: 'A quantity is given without a unit (for pieces that are counted: piece).',
		E204: 'The quantity is neither a number nor a fraction like 1 1/2 or 2/3 (and no decimal comma: 1.5).',
		E205: 'The maximum quantity is given without a starting quantity, or is not greater than it.',
		E206: 'An ingredient is both “to taste” and measured: it is one or the other.',
		E207: 'An ingredient has no name.',
		E208: 'Ingredients must be arranged in groups, even when there is only one.',
		E209: 'The same ingredient appears twice in the same group.',
		E210: 'The quantity is written in the ingredient’s name (“500 g of milk”); it must go in the quantity and the unit.',
		E211: 'The name contains a comma: probably two ingredients merged, or a detail that belongs in the note.',
		E212: '“Or buy” only makes sense with a sub-recipe.',
		E213: 'Sub-recipes call one another in a loop.',
		E214: 'The other measure (alt) must have a quantity and a unit, and nothing else.',
		E215: 'The list of choices (“or”) is badly written.',
		E216: 'A quantity is written in the note (“2 lb”); it must go in the quantity and the unit, or in the choices.',
		E217: 'Unknown mark in square brackets. Only [?], [?: …], [illisible] and [+] are allowed.',
		E218: 'A field does not have the right shape — often a value that starts with a square bracket without being in quotation marks.',
		E301: 'No method section recognized: an unknown section heading is in its place.',
		W302: 'The name contains a preparation (chopped, grated…); it should be apart, in the preparation.',
		W303: 'This ingredient is not linked to any known ingredient, and nothing resembles it. Create it in “To link”.',
		W304: 'The name contains a size (large, small…); it should go in the note.',
		W305: 'This ingredient is not linked yet, but a known ingredient resembles it. Confirm it in “To link”.',
		W307: 'This ingredient’s item field names an ingredient that does not exist in the list of ingredients.',
		W306: 'The sub-recipe is not in the vault yet. Add it when you can: the link will work then.',
		W401: 'There is no “Preparation” section.',
		W402: 'A step is very long: probably several steps stuck together.',
		W403: 'The method is in paragraphs, with no numbered steps or dashes: cooking mode will not be able to show it step by step.',
		W501: 'Tag outside the vault’s vocabulary. It is kept, marked for review: take the suggested tag, or add it to vocab/tags.yaml.',
		W502: 'The group of variants is named a lot like an existing group (a typo?). Check it.',
		W503: 'A recipe with an almost identical title already exists: it may be a duplicate.',
		W504: 'Unknown season: it must be spring, summer, fall or winter.',
		W505: 'A recipe in the vault, or a file higher up in this paste, has almost the same ingredients: perhaps the same card twice. If they are two variants of the same dish, group them.',
		W601: 'The number of servings is not given. Nothing to do if the original does not say.',
		W602: 'No time is given. Nothing to do if the original does not say.',
		W603: 'No photo of the dish.',
		W604: 'The source is not given: no one will know where the recipe comes from.',
		W605: 'A reading is uncertain ([?]) or illegible. Check it against the original; the recipe stays “To review” in the meantime.',
		W606: '“To taste” on an ingredient that is not a seasoning: the name alone, with no quantity, would be better.',
		W607: 'The name contains a brand name; it should be apart, in the brand.',
		W608: 'A recipe already has this title. You can make them two variants of the same dish (box above).',
		W609: 'A step mentions an oven temperature, but the oven is not given in the card.',
		W610: 'Unknown field (a typo?): its value is ignored.',
		E801: 'This ingredient card cannot be read: the header between two “---” lines is missing or badly written.',
		E802: 'The ingredient’s identifier must be in lowercase, with no accents, with hyphens, and the same as the file name.',
		E803: 'The ingredient’s category is missing or not in the list (fresh, meat, vegetable, grocery…).',
		E804: 'The ingredient has no name, or its names are badly written (one list in French, one in English).',
		E805: 'The density or a weight per unit must be a number greater than zero, in grams.',
		E806: 'The ingredient’s default unit is not a known unit.',
		E807: 'A field of the ingredient does not have the right shape: “yes/no” expected, or a list of identifiers.',
		W808: 'A listed substitute does not exist (or it is the ingredient itself). Create it or remove it.',
		W809: 'Allergen outside the list: it is ignored. Choose one from the list.',
		W810: 'Two ingredients have the same name: recipes that write it stay unlinked. Keep it under only one.',
		W811: 'Unknown field in the ingredient card (a typo?): it is ignored.',
		E812: 'The price file must start with its header line (date, ingredient, amount…): no price is read.',
		E813: 'This line of the price file cannot be read (date, amount, format or unit): it is ignored.',
		W814: 'This price is for an ingredient that is not in the registry: it is kept, but not used.',
		W815: 'This price is in another currency: it is shown, but does not count in the cost of recipes.',
		E820: 'A “when” rule of the ingredient is badly written: it needs names and at least one condition (language, unit or words).',
		W821: 'Two ingredients have a rule for the same name that can apply to the same line: those recipes stay unlinked. Make the conditions distinct.'
	}
});

/** The explanation for a code; a code without one points to the technical detail. */
export function explain(code: string): string {
	return codeText[code] ?? WORDS.undescribed;
}

/**
 * The form's hints (plan 04, Q9 A): the warnings the form can meet, said next
 * to their field, in plain words, never with the code. `word` is the word to
 * move, `value` what the field holds, `suggestion` the fix (a tag, a family's
 * name, another recipe's title). A test requires an entry for each code the
 * form maps (`FORM_HINT_CODES`).
 */
export const formHintText: Readonly<Record<string, (p: { word?: string; value?: string; suggestion?: string }) => string>> = localized({
	fr: {
		W302: (p) => `« ${p.word} » dit comment le préparer. Le mettre dans la préparation ?`,
		W304: (p) => `« ${p.word} » est une taille. Le mettre dans la note ?`,
		W607: (p) => `« ${p.word} » est une marque. La mettre à part, dans la marque ?`,
		W501: (p) =>
			p.suggestion
				? `L’étiquette « ${p.value} » n’est pas dans la liste. Vouliez-vous dire « ${p.suggestion} » ?`
				: `L’étiquette « ${p.value} » est nouvelle : elle est gardée, et le propriétaire la rangera dans la liste.`,
		W502: (p) => `Ce nom de groupe ressemble beaucoup à « ${p.suggestion} ». Est-ce le même ?`,
		W503: (p) => `Une recette au titre presque pareil existe déjà : « ${p.value} ». Ce n’est pas la même ?`,
		W608: (p) => `Une recette porte déjà ce titre : « ${p.value} ». En faire deux variantes du même plat ?`,
		W505: (p) => `« ${p.value} » a presque les mêmes ingrédients. Est-ce la même recette ?`,
		W303: () => 'Pas encore relié à un ingrédient connu ; la recette s’enregistre quand même.',
		W305: () => 'Pas encore relié à un ingrédient connu ; la recette s’enregistre quand même.',
		W306: () => 'Cette recette n’est pas encore dans le coffre.',
		W605: () => 'Des lectures incertaines restent à confirmer (surlignées).'
	},
	en: {
		W302: (p) => `“${p.word}” says how to prepare it. Put it in the preparation?`,
		W304: (p) => `“${p.word}” is a size. Put it in the note?`,
		W607: (p) => `“${p.word}” is a brand. Put it apart, in the brand?`,
		W501: (p) =>
			p.suggestion
				? `The tag “${p.value}” is not in the list. Did you mean “${p.suggestion}”?`
				: `The tag “${p.value}” is new: it is kept, and the owner will file it in the list.`,
		W502: (p) => `This group name looks a lot like “${p.suggestion}”. Is it the same one?`,
		W503: (p) => `A recipe with almost the same title already exists: “${p.value}”. Is it not the same one?`,
		W608: (p) => `A recipe already has this title: “${p.value}”. Make them two variants of the same dish?`,
		W505: (p) => `“${p.value}” has almost the same ingredients. Is it the same recipe?`,
		W303: () => 'Not linked to a known ingredient yet; the recipe is saved all the same.',
		W305: () => 'Not linked to a known ingredient yet; the recipe is saved all the same.',
		W306: () => 'This recipe is not in the vault yet.',
		W605: () => 'Uncertain readings remain to be confirmed (highlighted).'
	}
});

/** Who settles a code, said to the person in the paste box. */
export const fixerText: Record<Fixer, string> = localized({
	fr: {
		app: 'Se règle ici, dans l’application — pas par l’IA.',
		ai: 'L’IA s’en charge : copiez la demande de correction.'
	},
	en: {
		app: 'Settled here, in the app — not by the AI.',
		ai: 'The AI takes care of it: copy the fix request.'
	}
});

// --- where: a diagnostic path in words ---------------------------------------

/** What the parsed file offers cheaply to name places: group and ingredient names, section headings. */
export interface PlaceContext {
	frontmatter?: Record<string, unknown>;
	body?: { sections: { heading: string }[] };
}

const TOP: Record<string, string> = localized({
	fr: {
		schema: 'Version du format',
		title: 'Titre',
		slug: 'Identifiant',
		lang: 'Langue',
		family: 'Groupe de variantes',
		variant: 'Variante',
		source: 'Provenance',
		times: 'Temps',
		oven: 'Four',
		servings: 'Portions',
		servings_max: 'Portions (maximum)',
		servings_note: 'Portions (note)',
		yield: 'Donne',
		tags: 'Étiquettes',
		season: 'Saison',
		difficulty: 'Difficulté',
		rating: 'Note',
		ingredients: 'Ingrédients',
		media: 'Photos',
		status: 'État',
		added: 'Date d’ajout',
		updated: 'Date de modification',
		extracted_by: 'Transcrit par'
	},
	en: {
		schema: 'Format version',
		title: 'Title',
		slug: 'Identifier',
		lang: 'Language',
		family: 'Group of variants',
		variant: 'Variant',
		source: 'Source',
		times: 'Times',
		oven: 'Oven',
		servings: 'Servings',
		servings_max: 'Servings (maximum)',
		servings_note: 'Servings (note)',
		yield: 'Makes',
		tags: 'Tags',
		season: 'Season',
		difficulty: 'Difficulty',
		rating: 'Rating',
		ingredients: 'Ingredients',
		media: 'Photos',
		status: 'Status',
		added: 'Date added',
		updated: 'Date modified',
		extracted_by: 'Transcribed by'
	}
});

const FIELD: Record<string, string> = localized({
	fr: {
		// source
		type: 'type',
		author: 'auteur',
		url: 'adresse web',
		page: 'page',
		// times
		prep: 'préparation',
		cook: 'cuisson',
		rest: 'repos',
		total: 'total',
		// oven
		temp: 'température',
		temp_max: 'température maximale',
		// media
		final: 'photo du plat',
		// ingredient, alt, yield
		name: 'nom',
		qty: 'quantité',
		qty_max: 'quantité maximale',
		unit: 'unité',
		note: 'note',
		brand: 'marque',
		optional: 'facultatif',
		to_taste: 'au goût',
		recipe: 'sous-recette',
		buy_instead: 'ou acheter',
		item: 'ingrédient du registre',
		alt: 'autre mesure',
		or: 'choix',
		// group
		group: 'nom du groupe',
		items: 'liste'
	},
	en: {
		// source
		type: 'type',
		author: 'author',
		url: 'web address',
		page: 'page',
		// times
		prep: 'preparation',
		cook: 'cooking',
		rest: 'resting',
		total: 'total',
		// oven
		temp: 'temperature',
		temp_max: 'maximum temperature',
		// media
		final: 'photo of the dish',
		// ingredient, alt, yield
		name: 'name',
		qty: 'quantity',
		qty_max: 'maximum quantity',
		unit: 'unit',
		note: 'note',
		brand: 'brand',
		optional: 'optional',
		to_taste: 'to taste',
		recipe: 'sub-recipe',
		buy_instead: 'or buy',
		item: 'registry ingredient',
		alt: 'other measure',
		or: 'choice',
		// group
		group: 'group name',
		items: 'list'
	}
});

/** The words a place is built from. `colon` differs: French puts a space before it. */
const WORDS = localized({
	fr: {
		open: '« ',
		close: ' »',
		colon: ' : ',
		nth: 'n° ',
		field: 'champ',
		Field: 'Champ',
		// `title` under source: not the recipe title.
		sourceTitle: 'titre',
		group: 'groupe',
		line: 'ligne',
		choice: 'choix',
		alt: 'autre mesure',
		method: 'Méthode',
		step: 'étape',
		section: 'section',
		Section: 'Section',
		preamble: 'Texte avant le premier titre',
		undescribed: 'Problème sans description : voyez le détail technique.'
	},
	en: {
		open: '“',
		close: '”',
		colon: ': ',
		nth: 'no. ',
		field: 'field',
		Field: 'Field',
		sourceTitle: 'title',
		group: 'group',
		line: 'line',
		choice: 'choice',
		alt: 'other measure',
		method: 'Method',
		step: 'step',
		section: 'section',
		Section: 'Section',
		preamble: 'Text before the first heading',
		undescribed: 'Problem with no description: see the technical detail.'
	}
});

type Token = string | number;

function tokens(path: string): Token[] | undefined {
	const out: Token[] = [];
	const re = /([^.[\]]+)|\[(\d+)\]/g;
	let m: RegExpExecArray | null;
	let consumed = 0;
	while ((m = re.exec(path))) {
		out.push(m[2] !== undefined ? Number(m[2]) : m[1]);
		consumed += m[0].length;
	}
	// Dots are the only characters not captured.
	if (consumed + (path.match(/\./g)?.length ?? 0) !== path.length) return undefined;
	return out;
}

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** In the language's quotation marks: « x » or “x”. */
const inQuotes = (s: string) => `${WORDS.open}${s}${WORDS.close}`;

/** A name as written, short enough for a place, in quotation marks, after a space. */
function quoted(v: unknown): string {
	if (typeof v !== 'string' || !v.trim()) return '';
	const s = v.trim().replace(/\s+/g, ' ');
	return ` ${inQuotes(s.length > 40 ? s.slice(0, 39) + '…' : s)}`;
}

const field = (key: Token, source = false) =>
	typeof key === 'number' ? `${WORDS.nth}${key + 1}` : ((source && key === 'title' ? WORDS.sourceTitle : FIELD[key]) ?? `${WORDS.field} ${inQuotes(key)}`);

/**
 * A diagnostic path in plain words: `ingredients[0].items[3].unit` →
 * "Ingrédients, groupe 1, ligne 4 « farine » : unité", or in English
 * "Ingredients, group 1, line 4 “flour”: unit". Names come from the parsed
 * file when given, else positions. Null for a diagnostic about the whole
 * file.
 */
export function placeOf(path: string | null | undefined, file: PlaceContext = {}): string | null {
	if (!path) return null;
	const t = tokens(path);
	if (!t?.length || typeof t[0] !== 'string') return inQuotes(path);
	const fm = file.frontmatter ?? {};
	const [head, ...rest] = t;

	if (head === 'body') {
		const [part, i] = rest;
		if (part === 'preamble') return WORDS.preamble;
		if (part === 'steps' && typeof i === 'number') return `${WORDS.method}, ${WORDS.step} ${i + 1}`;
		if (part === 'sections' && typeof i === 'number') {
			const heading = file.body?.sections[i]?.heading;
			return heading ? `${WORDS.Section}${quoted(heading)}` : `${WORDS.method}, ${WORDS.section} ${i + 1}`;
		}
		return WORDS.method;
	}

	if (head === 'ingredients') {
		const parts = [TOP.ingredients];
		const groups = Array.isArray(fm.ingredients) ? fm.ingredients : [];
		let k = 0;
		const g = rest[k];
		if (typeof g !== 'number') return rest.length ? `${parts[0]}${WORDS.colon}${field(rest[rest.length - 1])}` : parts[0];
		k++;
		const group = groups[g];
		const gname = isMap(group) ? quoted(group.group) : '';
		parts.push(gname ? `${WORDS.group}${gname}` : `${WORDS.group} ${g + 1}`);
		let leaf: string | undefined;
		let node: unknown = isMap(group) ? group.items : undefined;
		if (rest[k] === 'items' && typeof rest[k + 1] === 'number') {
			const i = rest[k + 1] as number;
			const item = Array.isArray(node) ? node[i] : undefined;
			parts.push(`${WORDS.line} ${i + 1}${isMap(item) ? quoted(item.name) : quoted(item)}`);
			node = item;
			k += 2;
			// Alternatives: `or[2]`, possibly nested.
			while (rest[k] === 'or' && typeof rest[k + 1] === 'number') {
				const j = rest[k + 1] as number;
				const alt = isMap(node) && Array.isArray(node.or) ? node.or[j] : undefined;
				parts.push(`${WORDS.choice} ${j + 1}${isMap(alt) ? quoted(alt.name) : quoted(alt)}`);
				node = alt;
				k += 2;
			}
			if (rest[k] === 'alt' && rest.length > k + 1) {
				parts.push(WORDS.alt);
				k++;
			}
		}
		const left = rest.slice(k);
		if (left.length) leaf = left.map((x) => field(x)).join(', ');
		return leaf ? `${parts.join(', ')}${WORDS.colon}${leaf}` : parts.join(', ');
	}

	const top = TOP[head] ?? `${WORDS.Field} ${inQuotes(head)}`;
	if (!rest.length) return top;
	// A list entry (a tag, a season): show the value as written.
	if (typeof rest[0] === 'number' && rest.length === 1) {
		const list = fm[head];
		const v = Array.isArray(list) ? list[rest[0]] : undefined;
		return v !== undefined && quoted(v) ? `${top}${quoted(v)}` : `${top}, ${WORDS.nth}${rest[0] + 1}`;
	}
	return `${top}${WORDS.colon}${rest.map((x) => field(x, head === 'source')).join(', ')}`;
}
