// Checker diagnostics in French, for the people using the app (a family cook,
// not a developer). The checker's own `message` / `fix` stay in English: they
// feed the fix-request block (for the AI) and `vault check` (for the
// developer), and the UI keeps them behind a "Détail technique" disclosure
// because they carry the specifics (values, the suggested fix).
//
// One entry per code in src/lib/vault/codes.ts; a test fails on a code
// without one. Browser-safe.

import type { Fixer } from '../vault/codes';

/** Per code: what is wrong and what to do, in plain words. */
export const codeText: Readonly<Record<string, string>> = {
	I701: 'Du texte a été ajouté à la transcription ([+]) : il n’est pas sur l’original. Il est affiché à part pour qu’on le reconnaisse. Rien à faire.',
	I702: 'L’IA a écrit du texte en dehors de la recette, peut-être une question. Ce texte n’est pas enregistré : lisez-le au cas où.',
	E001: 'Ce texte n’a pas la forme d’une fiche de recette : l’en-tête entre deux lignes « --- » manque ou n’est pas fermé. L’IA doit renvoyer la fiche complète.',
	E002: 'L’en-tête de la fiche est mal écrit et ne se lit pas (souvent un décalage ou des guillemets oubliés). L’IA doit le corriger.',
	E003: 'Deux recettes sont collées dans un seul bloc. Chaque recette doit avoir son propre bloc ```markdown.',
	E101: 'La recette n’a pas de titre.',
	E102: 'L’identifiant de la recette (le nom du fichier) doit être en minuscules, sans accents ni espaces, avec des traits d’union.',
	E103: 'Une recette porte déjà ce nom de fichier. Choisissez ci-dessus : remplacer l’ancienne, ou enregistrer celle-ci sous un autre nom.',
	E104: 'La langue de la recette doit être « fr » ou « en ».',
	E105: 'Une famille sans version, ou une version sans famille : il faut les deux, ou aucun des deux.',
	E106: 'La provenance est mal écrite, ou son type n’est pas dans la liste (famille, livre, site web, magazine, télévision, inventée).',
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
	W302: 'Le nom finit par une préparation (haché, râpé…) ; elle devrait être à part, en préparation.',
	W303: 'Cet ingrédient ne correspond à aucun ingrédient connu. Rien à faire pour l’instant.',
	W304: 'Le nom commence par une taille (gros, petit…) ; elle devrait aller en note.',
	W305: 'Cet ingrédient a été reconnu à peu près seulement : à confirmer.',
	W306: 'La sous-recette n’est pas encore dans le coffre. Ajoutez-la quand vous pourrez : le lien fonctionnera alors.',
	W401: 'Il n’y a pas de section « Préparation ».',
	W402: 'Une étape est très longue : sans doute plusieurs étapes collées ensemble.',
	W403: 'La préparation est en paragraphes, sans étapes numérotées ni tirets : le mode cuisine ne pourra pas la montrer étape par étape.',
	W501: 'Étiquette hors du vocabulaire. Elle est gardée, marquée à revoir.',
	W502: 'Le nom de famille ressemble beaucoup à une famille existante (une faute de frappe ?). Vérifiez-le.',
	W503: 'Une recette au titre presque identique existe déjà : c’est peut-être un doublon.',
	W504: 'Saison inconnue : ce doit être printemps, été, automne ou hiver.',
	W601: 'Le nombre de portions n’est pas indiqué. Rien à faire si l’original ne le dit pas.',
	W602: 'Aucun temps n’est indiqué. Rien à faire si l’original ne le dit pas.',
	W603: 'Pas de photo du plat.',
	W604: 'La provenance n’est pas indiquée : on ne saura pas d’où vient la recette.',
	W605: 'Une lecture est incertaine ([?]) ou illisible. À vérifier sur l’original ; la recette reste « À relire » en attendant.',
	W606: '« Au goût » sur un ingrédient qui n’est pas un assaisonnement : il faudrait plutôt le nom seul, sans quantité.',
	W607: 'Le nom contient une marque de commerce ; elle devrait être à part, en marque.',
	W608: 'Une recette porte déjà ce titre. Vous pouvez en faire deux versions d’une même famille (case ci-dessus).',
	W609: 'Une étape parle d’une température de four, mais le four n’est pas indiqué dans la fiche.',
	W610: 'Champ inconnu (une faute de frappe ?) : sa valeur est ignorée.'
};

/** The French explanation for a code; a code without one points to the technical detail. */
export function explain(code: string): string {
	return codeText[code] ?? 'Problème sans description : voyez le détail technique.';
}

/** Who settles a code, said to the person in the paste box. */
export const fixerText: Record<Fixer, string> = {
	app: 'Se règle ici, dans l’application — pas par l’IA.',
	ai: 'L’IA s’en charge : copiez la demande de correction.'
};

// --- where: a diagnostic path in French --------------------------------------

/** What the parsed file offers cheaply to name places: group and ingredient names, section headings. */
export interface PlaceContext {
	frontmatter?: Record<string, unknown>;
	body?: { sections: { heading: string }[] };
}

const TOP: Record<string, string> = {
	schema: 'Version du format',
	title: 'Titre',
	slug: 'Identifiant',
	lang: 'Langue',
	family: 'Famille',
	variant: 'Version',
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
};

const FIELD: Record<string, string> = {
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
};

/** `title` for source.title, not the recipe title. */
const SOURCE_FIELD: Record<string, string> = { ...FIELD, title: 'titre' };

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

/** A name as written, short enough for a place, in « ». */
function quoted(v: unknown): string {
	if (typeof v !== 'string' || !v.trim()) return '';
	const s = v.trim().replace(/\s+/g, ' ');
	return ` « ${s.length > 40 ? s.slice(0, 39) + '…' : s} »`;
}

const field = (key: Token, labels = FIELD) => (typeof key === 'number' ? `n° ${key + 1}` : (labels[key] ?? `champ « ${key} »`));

/**
 * A diagnostic path in plain French: `ingredients[0].items[3].unit` →
 * "Ingrédients, groupe 1, ligne 4 « farine » : unité". Names come from the
 * parsed file when given, else positions. Null for a diagnostic about the
 * whole file.
 */
export function placeOf(path: string | null | undefined, file: PlaceContext = {}): string | null {
	if (!path) return null;
	const t = tokens(path);
	if (!t?.length || typeof t[0] !== 'string') return `« ${path} »`;
	const fm = file.frontmatter ?? {};
	const [head, ...rest] = t;

	if (head === 'body') {
		const [part, i] = rest;
		if (part === 'preamble') return 'Texte avant le premier titre';
		if (part === 'steps' && typeof i === 'number') return `Méthode, étape ${i + 1}`;
		if (part === 'sections' && typeof i === 'number') {
			const heading = file.body?.sections[i]?.heading;
			return heading ? `Section${quoted(heading)}` : `Méthode, section ${i + 1}`;
		}
		return 'Méthode';
	}

	if (head === 'ingredients') {
		const parts = ['Ingrédients'];
		const groups = Array.isArray(fm.ingredients) ? fm.ingredients : [];
		let k = 0;
		const g = rest[k];
		if (typeof g !== 'number') return rest.length ? `${parts[0]} : ${field(rest[rest.length - 1])}` : parts[0];
		k++;
		const group = groups[g];
		const gname = isMap(group) ? quoted(group.group) : '';
		parts.push(gname ? `groupe${gname}` : `groupe ${g + 1}`);
		let leaf: string | undefined;
		let node: unknown = isMap(group) ? group.items : undefined;
		if (rest[k] === 'items' && typeof rest[k + 1] === 'number') {
			const i = rest[k + 1] as number;
			const item = Array.isArray(node) ? node[i] : undefined;
			parts.push(`ligne ${i + 1}${isMap(item) ? quoted(item.name) : quoted(item)}`);
			node = item;
			k += 2;
			// Alternatives: `or[2]`, possibly nested.
			while (rest[k] === 'or' && typeof rest[k + 1] === 'number') {
				const j = rest[k + 1] as number;
				const alt = isMap(node) && Array.isArray(node.or) ? node.or[j] : undefined;
				parts.push(`choix ${j + 1}${isMap(alt) ? quoted(alt.name) : quoted(alt)}`);
				node = alt;
				k += 2;
			}
			if (rest[k] === 'alt' && rest.length > k + 1) {
				parts.push('autre mesure');
				k++;
			}
		}
		const left = rest.slice(k);
		if (left.length) leaf = left.map((x) => field(x)).join(', ');
		return leaf ? `${parts.join(', ')} : ${leaf}` : parts.join(', ');
	}

	const top = TOP[head] ?? `Champ « ${head} »`;
	if (!rest.length) return top;
	// A list entry (a tag, a season): show the value as written.
	if (typeof rest[0] === 'number' && rest.length === 1) {
		const list = fm[head];
		const v = Array.isArray(list) ? list[rest[0]] : undefined;
		return v !== undefined && quoted(v) ? `${top}${quoted(v)}` : `${top}, n° ${rest[0] + 1}`;
	}
	const labels = head === 'source' ? SOURCE_FIELD : FIELD;
	return `${top} : ${rest.map((x) => field(x, labels)).join(', ')}`;
}
