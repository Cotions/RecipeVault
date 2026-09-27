// Every UI string, in French (plan 02, decision 5). One module so English can
// be added later as a sibling file; no i18n library.

export const fr = {
	app: {
		name: 'Recettes',
		nav: { browse: 'Recettes', families: 'Familles', add: 'Ajouter', trash: 'Corbeille' },
		skip: 'Aller au contenu'
	},
	status: {
		draft: 'Brouillon',
		'needs-review': 'À relire',
		verified: 'Vérifiée'
	} as Record<string, string>,
	source: {
		family: 'Famille',
		book: 'Livre',
		website: 'Site web',
		magazine: 'Magazine',
		tv: 'Télévision',
		invented: 'Inventée'
	} as Record<string, string>,
	season: { printemps: 'Printemps', ete: 'Été', automne: 'Automne', hiver: 'Hiver' } as Record<string, string>,
	/** Display labels for seed tags whose slug lost its accents. */
	tags: {
		'plat-principal': 'Plat principal',
		entree: 'Entrée',
		'petit-dejeuner': 'Petit-déjeuner',
		gouter: 'Goûter',
		poele: 'Poêle',
		mijote: 'Mijoté',
		grille: 'Grillé',
		vegetarien: 'Végétarien',
		'sans-gluten': 'Sans gluten',
		pasta: 'Pâtes',
		boeuf: 'Bœuf',
		legumes: 'Légumes',
		francais: 'Français',
		quebecois: 'Québécois'
	} as Record<string, string>,
	time: { '30': '30 min ou moins', '60': '1 h ou moins', '120': '2 h ou moins', plus: 'Plus de 2 h' } as Record<string, string>,
	servings: { '1-2': '1 ou 2', '3-4': '3 ou 4', '5-6': '5 ou 6', '7+': '7 et plus' } as Record<string, string>,
	browse: {
		title: 'Recettes',
		search: 'Chercher une recette, un ingrédient…',
		searchLabel: 'Recherche',
		count: (n: number) => (n === 0 ? 'Aucune recette' : n === 1 ? '1 recette' : `${n} recettes`),
		empty: 'Aucune recette ne correspond. Retirez un filtre ou changez la recherche.',
		emptyVault: 'Le coffre est vide. Ajoutez une première recette.',
		filters: 'Filtres',
		showFilters: 'Filtrer',
		closeFilters: 'Voir les recettes',
		clear: 'Tout effacer',
		sort: 'Trier par',
		sorts: {
			relevance: 'Pertinence',
			title: 'Titre',
			added: 'Ajout récent',
			updated: 'Modification récente',
			time: 'Temps total',
			rating: 'Note'
		} as Record<string, string>,
		facets: {
			family: 'Famille',
			tags: 'Étiquettes',
			season: 'Saison',
			time: 'Temps total',
			servings: 'Portions',
			source: 'Provenance',
			author: 'Auteur',
			status: 'État'
		} as Record<string, string>,
		more: (n: number) => `${n} de plus`,
		less: 'Moins',
		pending: 'hors vocabulaire',
		prev: 'Précédentes',
		next: 'Suivantes',
		page: (p: number, n: number) => `Page ${p} sur ${n}`,
		problems: (n: number) => (n === 1 ? '1 fichier du coffre ne passe pas la validation' : `${n} fichiers du coffre ne passent pas la validation`)
	},
	card: {
		servings: (a: number, b?: number | null) => (b ? `${a} à ${b} portions` : `${a} portion${a > 1 ? 's' : ''}`),
		uncertain: (n: number) => (n === 1 ? '1 lecture à vérifier' : `${n} lectures à vérifier`),
		broken: 'Fichier en erreur'
	},
	families: {
		title: 'Familles',
		intro: 'Les versions d’un même plat, et ce qui les distingue.',
		variants: (n: number) => (n === 1 ? '1 version' : `${n} versions`),
		empty: 'Aucune famille pour l’instant. Une famille se crée quand deux recettes portent le même titre.',
		diff: 'Ce qui les distingue',
		common: (n: number) => `Commun à toutes les versions (${n})`,
		only: 'Seulement ici',
		ingredient: 'Ingrédient',
		totalTime: 'Temps total',
		servings: 'Portions',
		difficulty: 'Difficulté',
		rating: 'Note'
	},
	recipe: {
		by: 'de',
		source: 'Provenance',
		/** A `source` without `type`: the kind of source was not evident. */
		sourceUnknown: 'Type de source inconnu',
		page: 'p.',
		prep: 'Préparation',
		cook: 'Cuisson',
		rest: 'Repos',
		total: 'Total',
		oven: 'Four',
		servings: 'Portions',
		yield: 'Donne',
		ingredients: 'Ingrédients',
		optionalGroup: 'facultatif',
		scale: 'Portions',
		scaleFactor: 'Quantité',
		reset: 'Remettre',
		decrease: 'Moins de portions',
		increase: 'Plus de portions',
		variants: 'Autres versions',
		usedBy: 'Utilisée dans',
		legend: 'Légende',
		legendUncertain: 'lecture incertaine',
		legendIllegible: 'illisible sur l’original',
		legendAdded: 'ajouté à la transcription',
		cookMode: 'Cuisiner',
		print: 'Imprimer',
		/** Device setting: method steps numbered instead of bullets, on screen and in print. */
		numberSteps: 'Numéroter les étapes',
		verify: 'Vérifié',
		verifyHelp: 'Marquer comme relue contre l’original',
		verifyBlocked: 'Réglez d’abord les lectures incertaines ([?], [illisible]).',
		verified: 'Recette marquée vérifiée.',
		remove: 'Supprimer',
		removeConfirm: 'Mettre cette recette à la corbeille ? Elle pourra être restaurée.',
		removed: 'Recette mise à la corbeille.',
		file: 'Voir le fichier',
		fileHelp:
			'Lecture seule. Pour corriger, copiez le fichier, faites-le modifier par l’IA, puis collez le résultat dans Ajouter et choisissez « Remplacer ».',
		copy: 'Copier',
		copied: 'Copié',
		broken: 'Le fichier de cette recette ne passe plus la validation. La page montre la dernière version valide.',
		photo: 'Photo du plat',
		heic: 'Photo HEIC : aperçu indisponible dans le navigateur.',
		notFound: 'Cette recette n’existe pas ou a été supprimée.'
	},
	kitchen: {
		back: 'Quitter',
		ingredients: 'Ingrédients',
		start: 'Commencer',
		step: (i: number, n: number) => `Étape ${i} sur ${n}`,
		stepShort: (i: number) => `Étape ${i}`,
		prev: 'Étape précédente',
		next: 'Étape suivante',
		done: 'Bon appétit !',
		list: 'Ingrédients',
		timer: 'Minuteur',
		timerUpTo: (s: string) => `jusqu’à ${s}`,
		stop: 'Arrêter',
		finished: 'Terminé',
		wakeLock: 'L’écran peut se verrouiller : le maintien de l’écran allumé demande HTTPS (Tailscale). ',
		dismiss: 'Compris',
		dark: 'Sombre',
		light: 'Clair',
		expand: 'Voir la recette',
		collapse: 'Masquer',
		noSteps: 'Cette recette n’a pas d’étapes numérotées.',
		offline: 'Hors ligne — recette gardée sur l’appareil.',
		restart: 'Recommencer'
	},
	add: {
		title: 'Ajouter des recettes',
		intro: 'Collez la réponse de l’IA : chaque bloc ```markdown est une recette.',
		paste: 'Réponse de l’IA',
		placeholder: 'Collez ici la réponse complète de l’IA…',
		save: 'Enregistrer',
		saveHint: 'Ctrl+Entrée',
		saving: 'Enregistrement…',
		copyPrompt: 'Copier le prompt',
		promptCopied: 'Prompt copié. Collez-le dans une nouvelle conversation avec l’IA, avec la photo.',
		files: (n: number) => (n === 1 ? '1 recette trouvée' : `${n} recettes trouvées`),
		none: 'Aucune recette trouvée pour l’instant.',
		valid: 'Valide',
		invalid: 'À corriger',
		errors: 'Erreurs',
		warnings: 'Avertissements',
		infos: 'Notes',
		fixBlock: 'Copier la demande de correction',
		fixCopied: 'Demande copiée. Collez-la dans la conversation avec l’IA.',
		appOnly: 'Ces points se règlent ici, pas par l’IA.',
		preview: 'Aperçu',
		saved: (n: number) => (n === 1 ? 'Recette enregistrée :' : `${n} recettes enregistrées :`),
		collision: (slug: string) => `Une recette « ${slug} » existe déjà.`,
		collisionTrash: (slug: string) => `« ${slug} » est dans la corbeille ; ce nom ne sera pas réutilisé.`,
		replace: 'Remplacer',
		saveAs: (slug: string) => `Enregistrer comme ${slug}`,
		sameTitle: 'Même titre qu’une recette existante. En faire deux versions d’une famille ?',
		family: 'Famille',
		variant: 'Version',
		makeFamily: 'Mettre en famille',
		stale: 'La recette à remplacer a changé entre-temps. Vérifiez puis réessayez.',
		notSaved: (n: number) =>
			n === 1 ? '1 recette n’a pas été enregistrée : voyez ce qui la retient ci-dessous.' : `${n} recettes n’ont pas été enregistrées : voyez ce qui les retient ci-dessous.`,
		outside: 'Texte hors des blocs (ignoré — l’IA a peut-être posé une question) :',
		indexError: 'Enregistré, mais l’index n’a pas suivi ; il sera reconstruit au prochain démarrage.',
		error: 'L’enregistrement a échoué :',
		importLabel: 'Importer depuis une adresse web',
		importPlaceholder: 'https://…',
		import: 'Importer',
		importing: 'Import…',
		imported: 'Recette importée dans la zone ci-dessous : relisez-la, puis enregistrez.',
		recipeN: (i: number) => `Recette ${i}`
	},
	trash: {
		title: 'Corbeille',
		intro: 'Les recettes supprimées restent ici, avec leurs photos, jusqu’à ce qu’on les restaure.',
		empty: 'La corbeille est vide.',
		deleted: 'supprimée le',
		restore: 'Restaurer',
		taken: 'Nom repris par une autre recette',
		restored: 'Recette restaurée.'
	},
	error: {
		notFound: 'Page introuvable.',
		generic: 'Une erreur est survenue.',
		home: 'Retour aux recettes'
	}
};

export type Strings = typeof fr;
export const t = fr;

export function tagLabel(tag: string): string {
	if (fr.tags[tag]) return fr.tags[tag];
	const s = tag.replace(/-/g, ' ');
	return s.charAt(0).toUpperCase() + s.slice(1);
}

export function familyLabel(slug: string, label?: string | null): string {
	if (label) return label;
	const s = slug.replace(/-/g, ' ');
	return s.charAt(0).toUpperCase() + s.slice(1);
}
