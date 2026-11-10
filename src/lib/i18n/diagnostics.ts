// Checker diagnostics in French and in English, for the people using the app
// (a cook, not a developer), each in the language of their account
// (../prefs.ts). The checker's own `message` / `fix` stay in English whatever
// the account: they feed the fix-request block (for the AI) and `vault check`
// (for the developer). Behind "Détail technique" an English account sees
// them; a French one sees `FIX_FR` instead, with the names they cite
// (`servings`), never the English text.
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
		E003: 'Deux recettes sont collées ensemble, en une seule fiche. L’IA doit les séparer.',
		E101: 'La recette n’a pas de titre.',
		E102: 'L’identifiant de la recette (le nom du fichier) doit être en minuscules, sans accents ni espaces, avec des traits d’union.',
		E103: 'Une recette porte déjà ce nom de fichier. Choisissez ci-dessus : remplacer l’ancienne, ou enregistrer celle-ci sous un autre nom.',
		E104: 'La langue de la recette doit être « fr » ou « en ».',
		E105: 'Un groupe de variantes sans ce qui distingue la variante, ou l’inverse : il faut les deux, ou aucun des deux.',
		E106: 'La provenance est mal écrite, ou son type n’est pas un de ceux-ci : family, book, website, magazine, tv, invented.',
		E107: 'La difficulté et la note vont de 1 à 5.',
		E108: 'Le nombre de portions doit être un nombre entier ; s’il y a un maximum, il doit être plus grand que le minimum.',
		E109: 'Temps mal écrit : il s’écrit 30m, 1h, 1h15m, ou 45m-50m.',
		E110: 'La version du format de la fiche (schema) manque ou est inconnue.',
		E111: 'Le four est mal indiqué : il faut une température en chiffres, avec F ou C.',
		E112: 'La fiche donne elle-même son état ou sa date d’ajout ; c’est l’application qui les fixe. Ils sont retirés à l’enregistrement : rien à faire.',
		E113: 'Le fichier a été renommé ou modifié hors de l’application : son identifiant ne correspond plus au nom du fichier. Renommez le fichier ou remettez l’identifiant.',
		E114: 'L’adresse web de la provenance doit être complète et commencer par https://.',
		E200: 'Il n’y a aucun ingrédient, ou un groupe d’ingrédients est vide.',
		E201: 'Cette unité n’est pas dans la liste des unités : il faut en prendre une de la liste.',
		E202: 'Une unité est donnée sans quantité.',
		E203: 'Une quantité est donnée sans unité (pour des morceaux qu’on compte : piece).',
		E204: 'Quantité illisible : écrivez 2, 1 1/2 ou 2/3 (1.5, pas 1,5).',
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
		W501: 'Étiquette nouvelle : elle n’est pas encore dans la liste des étiquettes. Elle est gardée, marquée à revoir : prenez l’étiquette proposée, ou ajoutez-la à la liste (page Étiquettes).',
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
		E003: 'Two recipes are pasted together, as one card. The AI has to split them.',
		E101: 'The recipe has no title.',
		E102: 'The recipe’s identifier (the file name) must be in lowercase, with no accents or spaces, with hyphens.',
		E103: 'A recipe already has this file name. Choose above: replace the old one, or save this one under another name.',
		E104: 'The recipe’s language must be “fr” or “en”.',
		E105: 'A group of variants without what sets the variant apart, or the reverse: it takes both, or neither.',
		E106: 'The source is badly written, or its type is not one of: family, book, website, magazine, tv, invented.',
		E107: 'Difficulty and rating go from 1 to 5.',
		E108: 'The number of servings must be a whole number; if there is a maximum, it must be greater than the minimum.',
		E109: 'Time badly written: it is written 30m, 1h, 1h15m, or 45m-50m.',
		E110: 'The card’s format version (schema) is missing or unknown.',
		E111: 'The oven is badly given: it needs a temperature in digits, with F or C.',
		E112: 'The card gives its own status or date added; the app sets those. They are removed on saving: nothing to do.',
		E113: 'The file was renamed or changed outside the app: its identifier no longer matches the file name. Rename the file or put the identifier back.',
		E114: 'The source’s web address must be complete and start with https://.',
		E200: 'There are no ingredients, or an ingredient group is empty.',
		E201: 'This unit is not in the list of units: one from the list is needed.',
		E202: 'A unit is given without a quantity.',
		E203: 'A quantity is given without a unit (for pieces that are counted: piece).',
		E204: 'Unreadable quantity: write 2, 1 1/2 or 2/3 (1.5, not 1,5).',
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
		W501: 'New tag: it is not in the tag list yet. It is kept, marked for review: take the suggested tag, or add it to the list (Tags page).',
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
 * "Détail technique" on a French account: how to correct it, in French, for
 * the owner who fixes the text herself (docs/VALIDATION.md, "Human-facing
 * validation"). The checker's English `message` and `fix` stay what the AI
 * and `vault check` get; on a French account the detail gives this line
 * instead, with their code snippets (`qty: "1 1/2"`, language-neutral) as
 * « Écrit » and « À écrire ». An English account reads the checker's own.
 * A test requires an entry for every code.
 */
export const FIX_FR: Readonly<Record<string, string>> = {
	I701: 'Rien à corriger : le texte entre [+] est affiché à part.',
	I702: 'Lisez ce texte : si l’IA pose une question, répondez-lui dans la conversation.',
	E001: 'La fiche commence par une ligne « --- », puis l’en-tête, puis une autre ligne « --- », puis le texte. Demandez à l’IA la fiche complète.',
	E002: 'Corrigez la ligne indiquée : même décalage d’espaces que ses voisines, guillemets autour d’un texte qui contient « : » ou commence par un crochet.',
	E003: 'Chaque recette va dans son propre bloc ```markdown, fermé par ``` avant le suivant.',
	E101: 'Ajoutez une ligne « title: » avec le titre tel qu’écrit sur l’original.',
	E102: 'L’identifiant s’écrit en minuscules, sans accents ni espaces, avec des traits d’union.',
	E103: 'Choisissez plus haut : remplacer la recette existante, ou enregistrer sous un autre nom.',
	E104: 'Écrivez « lang: fr » ou « lang: en ».',
	E105: 'Donnez à la fois le groupe (family) et la variante (variant), ou retirez les deux.',
	E106: 'Écrivez la provenance sous « source: », avec un type de la liste, ou sans type.',
	E107: 'Écrivez un nombre entier de 1 à 5, ou retirez la ligne.',
	E108: 'Écrivez un nombre entier de portions ; un intervalle s’écrit avec « servings_max ».',
	E109: 'Écrivez le temps sous la forme 30m, 1h, 1h15m, ou 45m-50m.',
	E110: 'Ajoutez la ligne « schema: 3 » tout en haut de l’en-tête.',
	E111: 'Écrivez le four ainsi : « oven: { temp: 350, unit: F } ».',
	E112: 'Rien à faire : l’application retire ces lignes à l’enregistrement.',
	E113: 'Renommez le fichier, ou remettez l’identifiant qui correspond à son nom.',
	E114: 'Écrivez l’adresse complète, qui commence par https://, ou retirez-la.',
	E200: 'Ajoutez les ingrédients, rangés en groupes sous « items: ».',
	E201: 'Écrivez le code d’une unité de la liste (cup, tbsp, tsp, lb…) ; l’application affiche le mot français.',
	E202: 'Ajoutez la quantité, ou retirez l’unité si l’original n’en donne pas.',
	E203: 'Ajoutez l’unité ; pour des morceaux qu’on compte, « unit: piece ».',
	E204: 'Écrivez un nombre (2, 0.5) ou une fraction entre guillemets (« "1 1/2" ») ; l’unité va dans « unit ».',
	E205: 'Un intervalle, c’est « qty » (le bas) et « qty_max » (le haut, plus grand) ; sinon retirez « qty_max ».',
	E206: 'Gardez « au goût » (to_taste) sans quantité, ou la quantité sans « au goût ».',
	E207: 'Donnez un nom à l’ingrédient (« name: »).',
	E208: 'Rangez les ingrédients dans un groupe : « - items: » puis la liste.',
	E209: 'Gardez l’ingrédient une seule fois dans ce groupe, ou précisez-le en note.',
	E210: 'Sortez la quantité du nom : elle va dans « qty » et « unit ».',
	E211: 'Séparez les deux ingrédients, ou mettez la précision après la virgule en note.',
	E212: 'Retirez « buy_instead », ou ajoutez la sous-recette (« recipe: »).',
	E213: 'Retirez « recipe: » de l’une des recettes de la boucle.',
	E214: 'L’autre mesure (alt) prend une quantité et une unité, rien d’autre.',
	E215: 'Écrivez les choix (« or: ») en liste, chacun avec son nom.',
	E216: 'Sortez la quantité de la note : elle va dans « qty » et « unit », ou dans les choix.',
	E217: 'Remplacez par [?], [?: autre lecture], [illisible] ou [+], ou retirez les crochets.',
	E218: 'Mettez la valeur entre guillemets, ou écrivez la liste entre crochets (« tags: [dessert] »).',
	E301: 'Mettez les étapes sous « ## Préparation » (« ## Instructions » en anglais).',
	W302: 'Mettez ce mot dans la préparation (« prep: »).',
	W303: 'Créez l’ingrédient depuis « À relier », une fois la recette enregistrée.',
	W304: 'Mettez la taille dans la note (« note: »).',
	W305: 'Confirmez l’ingrédient dans « À relier », une fois la recette enregistrée.',
	W306: 'Rien à faire si la sous-recette sera ajoutée ; sinon, vérifiez son identifiant.',
	W307: 'Créez cet ingrédient, ou corrigez l’identifiant dans « item: ».',
	W401: 'Ajoutez un titre « ## Préparation » au-dessus des étapes.',
	W402: 'Coupez l’étape en une étape par geste.',
	W403: 'Écrivez chaque étape sur sa ligne, avec « 1. » ou « - » devant.',
	W501: 'Prenez l’étiquette proposée, ou ajoutez la nouvelle à la liste (page Étiquettes).',
	W502: 'Vérifiez le nom du groupe de variantes : c’est peut-être le groupe existant.',
	W503: 'Vérifiez que ce n’est pas la même recette collée deux fois.',
	W504: 'Écrivez printemps, ete, automne ou hiver, ou retirez la saison.',
	W505: 'Vérifiez que ce n’est pas la même fiche ; deux variantes du même plat se regroupent.',
	W601: 'Ajoutez le nombre de portions (« servings: ») si l’original le donne.',
	W602: 'Ajoutez les temps (« times: ») que l’original donne, seulement ceux-là.',
	W603: 'Ajoutez une photo du plat si vous en avez une.',
	W604: 'Ajoutez la provenance (« source: ») : livre, auteur, page ou adresse.',
	W605: 'Vérifiez sur l’original, corrigez la lecture, puis retirez la marque.',
	W606: 'Écrivez le nom seul, sans quantité ni « au goût ».',
	W607: 'Mettez la marque à part (« brand: »).',
	W608: 'Si ce sont deux versions du même plat, regroupez-les (case plus haut).',
	W609: 'Ajoutez le four (« oven: { temp: 350, unit: F } »).',
	W610: 'Corrigez le nom du champ (une faute de frappe ?) ou retirez la ligne.',
	E801: 'La fiche d’ingrédient commence par « --- », l’en-tête, puis « --- ».',
	E802: 'Écrivez l’identifiant en minuscules, avec des traits d’union, pareil au nom du fichier.',
	E803: 'Choisissez une catégorie de la liste.',
	E804: 'Donnez au moins un nom, en liste sous « fr » ou « en ».',
	E805: 'Écrivez un nombre plus grand que zéro, en grammes.',
	E806: 'Choisissez une unité de la liste.',
	E807: 'Écrivez true ou false, ou une liste d’identifiants.',
	W808: 'Créez ce substitut, ou retirez-le.',
	W809: 'Choisissez un allergène de la liste.',
	W810: 'Gardez ce nom sous un seul ingrédient.',
	W811: 'Corrigez le nom du champ, ou retirez la ligne.',
	E812: 'Remettez la ligne de titres en tête du fichier des prix.',
	E813: 'Corrigez la ligne (date AAAA-MM-JJ, montant, format, unité), ou retirez-la.',
	W814: 'Créez l’ingrédient, ou corrigez son identifiant sur la ligne.',
	W815: 'Rien à faire : ce prix ne compte pas dans le coût.',
	E820: 'Donnez à la règle des noms et au moins une condition (langue, unité ou mots).',
	W821: 'Rendez les conditions des deux règles distinctes.'
};

/** The code snippets of a checker text (`qty: "1 1/2"`): language-neutral, they carry its specifics. */
export function snippets(text: string | undefined): string[] {
	if (!text) return [];
	return [...text.matchAll(/(?<!`)`([^`\n]{1,80})`(?!`)/g)].map((m) => m[1]).filter((s, i, all) => all.indexOf(s) === i).slice(0, 4);
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
		W305: (p) =>
			p.suggestion
				? `« ${p.value} » n’est pas encore relié. Vouliez-vous dire « ${p.suggestion} » ?`
				: 'Pas encore relié à un ingrédient connu ; la recette s’enregistre quand même.',
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
		W305: (p) =>
			p.suggestion
				? `“${p.value}” is not linked yet. Did you mean “${p.suggestion}”?`
				: 'Not linked to a known ingredient yet; the recipe is saved all the same.',
		W306: () => 'This recipe is not in the vault yet.',
		W605: () => 'Uncertain readings remain to be confirmed (highlighted).'
	}
});

/**
 * The paste box's own sentences, built from the value as written: they say
 * more than the code's line can (docs/VALIDATION.md, "Human-facing
 * validation"). A unit the alias table knows (`tasse`) is not unknown to a
 * cook: the sentence leads with the unit as she wrote it, then says the file
 * writes its code and the app still shows the word.
 */
export const pasteText = localized({
	fr: {
		unitAlias: (value: string, unit: string, word: string) => `Unité «\u00a0${value}\u00a0» : écrivez ${unit} ; l’app affichera «\u00a0${word}\u00a0».`,
		/** E106 on `source.type`: the value, and the buttons under it, one per type (its code and its name). */
		sourceType: (value: string) => `Type de provenance «\u00a0${value}\u00a0» inconnu : lequel est-ce ?`,
		/** W501, one pattern: a new tag is kept as written and waits in Étiquettes; the same word, when there is one, offered first. */
		newTag: (label: string) => `Nouvelle étiquette «\u00a0${label}\u00a0» : gardée telle quelle, elle attendra dans Étiquettes.`,
		tagAccent: (value: string, accented: string) => `Étiquette «\u00a0${value}\u00a0» inconnue : vouliez-vous «\u00a0${accented}\u00a0» ? Sinon, gardez-la : elle attendra dans Étiquettes.`,
		tagKept: (label: string) => `✓ «\u00a0${label}\u00a0» gardée : elle attendra dans Étiquettes.`,
		/** The same value elsewhere in the file: one problem, said once. */
		times: (n: number) => `${n} fois dans cette recette`,
		alsoAt: 'Aussi :',
		colon: ' : ',
		/** E002: where the header stops reading, as a line of the box. */
		lineOf: (n: number) => `Ligne ${n} du texte`,
		badLine: 'L’en-tête de la fiche ne se lit plus à partir de cette ligne : souvent un décalage d’espaces, ou des guillemets oubliés.',
		offBy: (n: number, more: boolean) => `Ligne décalée ${n === 1 ? 'd’un espace' : `de ${n} espaces`} ${more ? 'de trop' : 'en moins'} : l’en-tête ne se lit plus à partir d’ici.`,
		/** Nothing else can be checked until the header reads. */
		laterMaybe: 'D’autres problèmes peuvent apparaître une fois celui-ci corrigé.',
		/** E002's next problems, found in the realigned text: counted with the errors, said so. */
		laterHead: (n: number) =>
			n === 1
				? 'Et 1 autre erreur, listée ci-dessous « à revérifier » : trouvée en lisant la fiche réalignée.'
				: `Et ${n} autres erreurs, listées ci-dessous « à revérifier » : trouvées en lisant la fiche réalignée.`,
		laterNone: 'Une fois la ligne réalignée, rien d’autre n’empêche l’enregistrement.',
		/** W305 with the known ingredient it resembles named. */
		resembles: (value: string, names: string[]) =>
			`« ${value} » ressemble à ${names.length > 1 ? `${names.slice(0, -1).join(', ')} ou ${names.at(-1)}` : names[0]}, ${names.length > 1 ? 'des ingrédients connus' : 'un ingrédient connu'} : à confirmer dans « À relier » une fois la recette enregistrée.`,
		resemblesMany: (value: string, names: string) => `« ${value} » est le nom de plusieurs ingrédients (${names}) : à choisir dans « À relier » une fois la recette enregistrée.`,
		/** W305 whose look-alikes are too far to name (an ending in common only). */
		notLinked: (value: string) => `«\u00a0${value}\u00a0» n’est pas encore relié à un ingrédient connu : à faire dans «\u00a0À relier\u00a0» une fois la recette enregistrée.`,
		/** E207 on a plain-string item: the line is there, only not split. */
		notSplit: (value: string) => `«\u00a0${value}\u00a0» : cette ligne n’est pas découpée en quantité, unité et nom.`,
		/** No step read, though lines look like steps (W401 / W403): the first one quoted. */
		stepsOdd: (n: number, line: string) =>
			n === 1
				? `Aucune étape n’est lue : la ligne «\u00a0${line}\u00a0» ressemble à une étape, mais n’est pas écrite comme une liste («\u00a01.\u00a0» en début de ligne).`
				: `Aucune étape n’est lue : «\u00a0${line}\u00a0» et ${n === 2 ? 'une autre ligne' : `${n - 1} autres lignes`} ressemblent à des étapes, mais ne sont pas écrites comme une liste («\u00a01.\u00a0» en début de ligne).`,
		/** The technical detail, on a French account. */
		codeWords: 'Dans la fiche :'
	},
	en: {
		unitAlias: (value: string, unit: string, word: string) => `Unit “${value}”: write ${unit}; the app will show “${word}”.`,
		sourceType: (value: string) => `Unknown source type “${value}”: which one is it?`,
		newTag: (label: string) => `New tag “${label}”: kept as written, it will wait in Tags.`,
		tagAccent: (value: string, accented: string) => `Unknown tag “${value}”: did you mean “${accented}”? Or keep it: it will wait in Tags.`,
		tagKept: (label: string) => `✓ “${label}” kept: it will wait in Tags.`,
		times: (n: number) => `${n} times in this recipe`,
		alsoAt: 'Also:',
		colon: ': ',
		lineOf: (n: number) => `Line ${n} of the text`,
		badLine: 'The card’s header stops reading from this line: often an indentation slip, or forgotten quotation marks.',
		offBy: (n: number, more: boolean) => `Line indented ${n === 1 ? 'one space' : `${n} spaces`} ${more ? 'too far' : 'too short'}: the header stops reading here.`,
		laterMaybe: 'Other problems may show once this one is fixed.',
		laterHead: (n: number) =>
			n === 1 ? 'And 1 more error, listed below “to check again”: found by reading the realigned card.' : `And ${n} more errors, listed below “to check again”: found by reading the realigned card.`,
		laterNone: 'Once the line is realigned, nothing else keeps it from being saved.',
		resembles: (value: string, names: string[]) =>
			`“${value}” looks like ${names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0]}, ${names.length > 1 ? 'known ingredients' : 'a known ingredient'}: confirm it in “To link” once the recipe is saved.`,
		resemblesMany: (value: string, names: string) => `“${value}” is the name of several ingredients (${names}): choose in “To link” once the recipe is saved.`,
		notLinked: (value: string) => `“${value}” is not linked to a known ingredient yet: do it in “To link” once the recipe is saved.`,
		notSplit: (value: string) => `“${value}”: this line is not split into quantity, unit and name.`,
		stepsOdd: (n: number, line: string) =>
			n === 1
				? `No step is read: the line “${line}” looks like a step, but is not written as a list (“1.” at the start of the line).`
				: `No step is read: “${line}” and ${n === 2 ? 'one other line' : `${n - 1} other lines`} look like steps, but are not written as a list (“1.” at the start of the line).`,
		codeWords: 'In the file:'
	}
});

/**
 * A sentence after a place and a colon: its first letter lowered, unless the
 * first word is an acronym (« IA », « E201 »).
 */
export function afterColon(sentence: string): string {
	return /^\p{Lu}(?:\p{Ll}|[’'\s])/u.test(sentence) ? sentence[0].toLocaleLowerCase() + sentence.slice(1) : sentence;
}

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
		undescribed: 'Problème sans description : voyez les détails pour le dépannage.'
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
		undescribed: 'Problem with no description: see the troubleshooting details.'
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

const HUMAN = localized({
	fr: {
		ingredient: 'ingrédient',
		Group: 'Groupe',
		choice: 'choix',
		alt: 'autre mesure',
		ord: (n: number) => (n === 1 ? '1er' : `${n}e`),
		open: '(',
		close: ')'
	},
	en: {
		ingredient: 'ingredient',
		Group: 'Group',
		choice: 'choice',
		alt: 'other measure',
		ord: (n: number) => {
			const tens = n % 100;
			const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
			return `${n}${suffix}`;
		},
		open: '(',
		close: ')'
	}
});

/** A name as written, short, in parentheses, after a space; '' when there is none. */
function named(v: unknown): string {
	if (typeof v !== 'string' || !v.trim()) return '';
	const s = v.trim().replace(/\s+/g, ' ');
	return ` ${HUMAN.open}${s.length > 40 ? s.slice(0, 39) + '…' : s}${HUMAN.close}`;
}

/**
 * Where a problem is, as a cook would say it, to lead its sentence (the paste
 * box): `ingredients[0].items[1].unit` → "Sirop, 2e ingrédient (eau)" — the
 * group's name (none when there is a single unnamed group), the ingredient's
 * rank and name; the field is left to the sentence ("cette unité…"). Other
 * paths are `placeOf`'s. The full place stays in the technical detail.
 */
export function placeHuman(path: string | null | undefined, file: PlaceContext = {}): string | null {
	if (!path) return null;
	const t = tokens(path);
	if (!t || t[0] !== 'ingredients' || typeof t[1] !== 'number' || t[2] !== 'items' || typeof t[3] !== 'number') return placeOf(path, file);
	const groups = Array.isArray(file.frontmatter?.ingredients) ? (file.frontmatter.ingredients as unknown[]) : [];
	const group = groups[t[1]];
	const gname = isMap(group) && typeof group.group === 'string' && group.group.trim() ? group.group.trim().replace(/\s+/g, ' ') : '';
	const items = isMap(group) && Array.isArray(group.items) ? group.items : [];
	let node: unknown = items[t[3]];
	let s = `${HUMAN.ord(t[3] + 1)} ${HUMAN.ingredient}${named(isMap(node) ? node.name : node)}`;
	let k = 4;
	while (t[k] === 'or' && typeof t[k + 1] === 'number') {
		const j = t[k + 1] as number;
		node = isMap(node) && Array.isArray(node.or) ? node.or[j] : undefined;
		s += `, ${HUMAN.choice} ${j + 1}${named(isMap(node) ? node.name : node)}`;
		k += 2;
	}
	if (t[k] === 'alt') s += `, ${HUMAN.alt}`;
	const lead = gname ? `${gname}, ` : groups.length > 1 ? `${HUMAN.Group} ${t[1] + 1}, ` : '';
	const out = lead + s;
	return out[0].toLocaleUpperCase() + out.slice(1);
}

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
