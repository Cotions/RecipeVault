// Every UI string, in French (plan 02, decision 5): the reference, whose shape
// en.ts must have. Pages import `t` from ./index.ts, which answers in the
// language of the person being served; no i18n library.

export const fr = {
	app: {
		/** The app's own name: the wordmark and the end of every page title (not the « Recettes » tab). */
		name: 'Boîte à recettes',
		/** The page description (search engines, link previews). */
		description: 'Archive de recettes : fiches, coupures, livres et sites numérisés, faciles à chercher et à lire.',
		nav: {
			browse: 'Recettes',
			families: 'Variantes',
			ingredients: 'Ingrédients',
			pantry: 'Garde-manger',
			add: 'Ajouter',
			trash: 'Corbeille',
			/** The work queues in « Plus », their count beside them (only Étiquettes and Doublons count on the button). */
			queue: 'À relier',
			pendingTags: 'Étiquettes',
			duplicates: 'Doublons'
		},
		skip: 'Aller au contenu',
		/** The header's menu: the pages used less often, the account. */
		more: 'Plus',
		moreLabel: 'Autres pages et compte',
		/** Beside « Plus », what its number counts, by kind (tags to decide, new duplicate cards; never the backlogs): its tooltip and what a screen reader hears. */
		waiting: (tags: number, dups = 0) =>
			[tags ? `${tags} étiquette${tags > 1 ? 's' : ''} à décider` : '', dups ? `${dups} doublon${dups > 1 ? 's' : ''} nouveau${dups > 1 ? 'x' : ''}` : '']
				.filter(Boolean)
				.join(' et '),
		/** At a queue's item's end in « Plus ». */
		toDecide: (n: number) => `${n} à décider`,
		/** The part of a duplicates line in « Plus » its number counts (« Doublons · 1 nouveau · 74 groupes »). */
		freshPart: (n: number) => (n === 1 ? '1 nouveau' : `${n} nouveaux`),
		queueLeft: (n: number) => (n === 1 ? '1 nom' : `${n} noms`),
		/** Doublons' line in « Plus »: cards, said so (« Doublons · 74 groupes »). */
		groups: (n: number) => (n === 1 ? '1 groupe' : `${n} groupes`),
		/** The toast after a decision on a queue page (lib/settle.svelte.ts). */
		undo: 'Annuler',
		undone: 'Annulé.',
		undoFailed: 'Impossible d’annuler ; rechargez la page.',
		/** A page's ⋯ menu. */
		actions: 'Autres actions',
		navLabel: 'Principale',
		close: 'Fermer',
		/** A name or a word quoted in a sentence, and the two marks alone (around a component). */
		quote: (s: string) => `« ${s} »`,
		quotes: ['« ', ' »']
	},
	status: {
		draft: 'Brouillon',
		'needs-review': 'À relire',
		verified: 'Vérifiée'
	} as Record<string, string>,
	source: {
		family: 'Recette personnelle',
		book: 'Livre',
		website: 'Site web',
		magazine: 'Magazine',
		tv: 'Télévision',
		invented: 'Inventée'
	} as Record<string, string>,
	season: { printemps: 'Printemps', ete: 'Été', automne: 'Automne', hiver: 'Hiver' } as Record<string, string>,
	time: { '30': '30 min ou moins', '60': '1 h ou moins', '120': '2 h ou moins', plus: 'Plus de 2 h' } as Record<string, string>,
	servings: { '1-2': '1 ou 2', '3-4': '3 ou 4', '5-6': '5 ou 6', '7+': '7 et plus' } as Record<string, string>,
	browse: {
		title: 'Recettes',
		/** Short enough for a 320 px phone; the longer hint is read out with it (searchHint). */
		search: 'Titre, ingrédient, personne…',
		searchHint: 'Cherchez par titre, ingrédient, personne ou livre.',
		searchLabel: 'Recherche',
		count: (n: number) => (n === 0 ? 'Aucune recette' : n === 1 ? '1 recette' : `${n} recettes`),
		emptyVault: 'Le coffre est vide. Ajoutez une première recette : une fiche numérisée, une page web ou le formulaire.',
		filters: 'Filtres',
		showFilters: 'Filtres',
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
			family: 'Variantes',
			tags: 'Étiquettes',
			season: 'Saison',
			time: 'Temps total',
			servings: 'Portions',
			source: 'Provenance',
			author: 'Auteur',
			status: 'État',
			unresolved: 'Ingrédients'
		} as Record<string, string>,
		unresolved: { non: 'Ingrédients à relier' } as Record<string, string>,
		/** The active filters above the results, each removable. */
		active: 'Filtres actifs',
		remove: (label: string) => `Retirer le filtre « ${label} »`,
		/** The filter button's badge, for a screen reader. */
		activeCount: (n: number) => (n === 1 ? '1 filtre actif' : `${n} filtres actifs`),
		/** The recipe-box letter index of a list sorted by title. */
		letters: 'Aller à la lettre',
		letter: (l: string, n: number) => (l === '#' ? `Autres titres (${n})` : n === 0 ? `Aucune recette en ${l}` : n === 1 ? `1 recette en ${l}` : `${n} recettes en ${l}`),
		/** Why a search result matched, when its title does not say. */
		match: {
			ingredients: (n: number): string => (n === 1 ? 'Ingrédient' : 'Ingrédients'),
			tags: (n: number): string => (n === 1 ? 'Étiquette' : 'Étiquettes'),
			author: 'Auteur',
			body: 'Texte'
		},
		range: (from: number, to: number, total: number) => `Recettes ${from} à ${to} sur ${total}`,
		more: (n: number) => (n === 1 ? '+ 1 autre' : `+ ${n} autres`),
		less: 'Moins',
		pending: 'hors vocabulaire',
		prev: 'Précédentes',
		next: 'Suivantes',
		page: (p: number, n: number) => `Page ${p} sur ${n}`,
		problems: (n: number) => (n === 1 ? '1 fichier du coffre ne passe pas la validation' : `${n} fichiers du coffre ne passent pas la validation`),
		pages: 'Pages',
		/** The line above the results: how many, and for which search. */
		forQuery: (q: string) => `pour « ${q} »`,
		/** Phone: a few filters to tap, under the search box (the most used in the list). */
		quick: 'Filtres suggérés',
		/** Phone, beside the count: what the list is sorted by (the sort itself is in the filter sheet). */
		sortedBy: (sort: string) => ` · par ${sort.toLowerCase()}`,
		/** The pager and the letter index: which titles a page holds. */
		pageLetters: (a: string, b: string) => (a === b ? `Titres en ${a}` : `Titres de ${a} à ${b}`),
		onPage: (p: number) => `page ${p}`,
		/** Sorted by relevance: before the first result whose title lacks a word of the search. */
		/**
		 * Rows with the same title, shown under it once: « 3 fiches », plain (not a
		 * link) — apart from a family's « 4 variantes », a link with the Variantes drawing.
		 */
		sameTitle: (n: number) => `${n} fiches`,
		compare: 'Comparer les variantes',
		/** A row whose recipe says nothing of where it is from (its drawing's name too). */
		unknownFrom: 'Provenance inconnue',
		/** The drawing at the start of a same-title group. */
		glyphStack: 'Plusieurs fiches du même titre',
		/** The drawing before a row's « 3 variantes » link (the Variantes tab's). */
		glyphVariants: 'Variantes d’un même plat',
		/** A letter continued at the top of the second column, or of the next page. */
		cont: (l: string) => `${l} (suite)`,
		/** Sorted by relevance: the heading before the results whose title lacks the words, by where they are (search.ts sections). */
		section: {
			ingredients: (n: number) => (n === 1 ? 'Dans les ingrédients d’une recette' : `Dans les ingrédients de ${n} recettes`),
			tags: (n: number) => (n === 1 ? 'Dans les étiquettes d’une recette' : `Dans les étiquettes de ${n} recettes`),
			author: (n: number) => (n === 1 ? 'Dans la provenance d’une recette' : `Dans la provenance de ${n} recettes`),
			body: (n: number) => (n === 1 ? 'Dans le texte d’une recette' : `Dans le texte de ${n} recettes`),
			/** Last, quieter: recipes that only mention the words in a note — not more of what she looked for. */
			notes: (n: number, q?: string) =>
				q ? (n === 1 ? `Mentionne aussi « ${q} »` : `Mentionnent aussi « ${q} »`) : n === 1 ? 'Dans les notes d’une recette' : `Dans les notes de ${n} recettes`
		} as Record<string, (n: number, q?: string) => string>,
		/** Nothing with every word: each word alone, a link when it finds some (« « carrot » seul : 27 recettes »). */
		partial: {
			none: 'Aucune recette avec tous les mots.',
			alone: (w: string) => `« ${w} » seul`,
			count: (n: number) => (n === 0 ? 'aucune' : n === 1 ? '1 recette' : `${n} recettes`),
			label: 'Chaque mot seul'
		},
		/** A word that stands for several ingredients (« poivron »): each by the name the box writes, a link that narrows. */
		also: 'Aussi :',
		alsoLabel: 'Chercher plutôt',
		/** « Aussi : piment de la Jamaïque (2) »: a name the word heads without meaning it, not among the results. */
		alsoApart: 'Autre ingrédient, pas dans ces résultats :',
		/** Sorted by note: a row's rating. */
		rating: (n: number) => `Note : ${n} sur 5`,
		/** The home's row of filters to tap (the whole box). */
		start: {
			label: 'Parcourir',
			quick: 'Rapide · 30 min',
			/** The pantry search (/garde-manger), last of the row: what to make with what is at home. */
			pantry: 'Avec ce que j’ai'
		},
		/** A close spelling that finds more: « Vouliez-vous dire « tourtière » ? », the word a link. */
		didYouMean: { before: 'Vouliez-vous dire ', after: ' ?' },
		/** The typed words found nothing: the results shown are the correction's. */
		noneFor: (q: string) => `Aucune recette pour « ${q} ».`,
		resultsFor: (q: string) => `Résultats pour « ${q} »`,
		/** The typed words found nothing and the close spelling's results are shown: said once, over them, with the way back to the words as typed. */
		respelled: (q: string, typed: string) => `Résultats pour « ${q} » (vous aviez tapé « ${typed} »)`,
		searchExact: 'Chercher exactement',
		/** Nothing found. With filters on: they are listed, with « Tout effacer ». */
		emptyFiltered: 'Aucune recette ne correspond avec ces filtres :',
		emptyUnfiltered: (n: number) => (n === 1 ? 'Sans les filtres : 1 recette' : `Sans les filtres : ${n} recettes`),
		emptyQuery: (q: string) => `Aucune recette pour « ${q} ». Vérifiez l’orthographe ou essayez un seul mot.`,
		/** Phone: the filter sheet's close button. */
		closeSheet: 'Fermer les filtres',
		/** A facet value that would leave no recipe with the filters on (greyed). */
		facetNone: 'aucune recette avec les filtres actuels',
		/** Over the index (the whole box, first page): a few ideas for « qu’est-ce qu’on mange dimanche ? ». */
		ideas: {
			title: 'Des idées',
			/** Wide screen: one row of three cards; the others behind this toggle, in place. */
			more: 'Plus d’idées',
			less: 'Moins d’idées',
			random: 'Une fiche au hasard',
			another: 'Une autre fiche au hasard',
			season: (s: string) => `De saison · ${s.toLowerCase()}`,
			seasonAll: (n: number) => `Les ${n}`,
			seasonAllLabel: (n: number, s: string) => `Les ${n} recettes de saison (${s.toLowerCase()})`,
			recent: 'Ajoutées récemment',
			recentAll: 'Toutes',
			recentAllLabel: 'Toutes les recettes, par ajout récent',
			/** The ↻ button's visible word. */
			anotherShort: 'Une autre',
			/** Phone: which of the idea cards is in view. */
			position: (i: number, n: number) => `Idée ${i} sur ${n}`,
			/** More ways in, read off the files (query.ts RAILS): each card's head is the link to its whole list. */
			rails: {
				long: 'Longs mijotés · plus de 2 h',
				crowd: 'Pour une tablée · 7 et plus',
				liked: 'Les mieux notées'
			} as Record<string, string>,
			railAll: (key: string, n: number) => (key === 'liked' ? 'Toutes' : `Les ${n}`),
			railAllLabel: (key: string, n: number) =>
				key === 'long'
					? `Les ${n} plats principaux de plus de 2 h`
					: key === 'crowd'
						? `Les ${n} recettes pour 7 portions et plus`
						: 'Toutes les recettes, les mieux notées d’abord'
		}
	},
	card: {
		servings: (a: number, b?: number | null) => (b ? `${a} à ${b} portions` : `${a} portion${a > 1 ? 's' : ''}`),
		uncertain: (n: number) => (n === 1 ? '1 lecture à vérifier' : `${n} lectures à vérifier`),
		broken: 'Fichier en erreur'
	},
	families: {
		title: 'Variantes',
		intro: 'Les variantes d’un même plat, regroupées, et ce qui les distingue.',
		count: (n: number) => (n === 1 ? '1 groupe' : `${n} groupes`),
		variants: (n: number) => (n === 1 ? '1 variante' : `${n} variantes`),
		empty: 'Aucune variante pour l’instant. Un groupe se crée quand deux recettes portent le même titre.',
		diff: 'Ce qui les distingue',
		common: (n: number) => `Commun à toutes les variantes (${n})`,
		only: 'Seulement ici',
		ingredient: 'Ingrédient',
		totalTime: 'Temps total',
		servings: 'Portions',
		difficulty: 'Difficulté',
		rating: 'Note',
		rename: 'Changer le nom du groupe',
		label: 'Nom affiché',
		labelHelp: (slug: string) =>
			`Le nom montré partout pour ce groupe de variantes. Les recettes gardent l’identifiant « ${slug} ». Laissez vide pour revenir au titre le plus court de ses recettes.`,
		labelSave: 'Enregistrer le nom',
		labelSaved: 'Nom du groupe enregistré.',
		/** On a group's page (the owner): one more recipe in the group. */
		add: '+ Ajouter une recette à ce groupe',
		addSearch: 'Chercher une recette',
		addSave: 'Ajouter au groupe',
		joined: (title: string, group: string) => `« ${title} » est maintenant une variante de « ${group} ».`,
		/** « Annuler » after grouping went through. */
		ungrouped: (title: string) => `Groupe défait : « ${title} » n’en fait plus partie.`,
		/** Before « Grouper »: how many of its ingredients the other side has too. */
		shared: (n: number, of: number) => `${n} ${n > 1 ? 'ingrédients' : 'ingrédient'} en commun sur ${of}, hors ingrédients de base (sel, farine…).`,
		/** Under SHARED_LOW of them in common. */
		fewShared: 'Peu d’ingrédients en commun : est-ce bien le même plat ?',
		/** A group of one recipe on Variantes: waiting for its others. */
		toComplete: 'à compléter',
		toCompleteHelp: 'Un groupe d’une seule recette attend ses autres variantes : ouvrez-le pour en ajouter.',
		/** What a group of one recipe is missing, after « à compléter ». */
		toCompleteWhat: 'ajoutez une 2ᵉ variante',
		/** A variant's label from the kind of source, when no author or title says more (lib/form/family.ts fromLabel). */
		fromType: { book: 'du livre', magazine: 'de la revue', website: 'du site', tv: 'de la télé' } as Record<string, string>,
		/** The comparison: a name not linked yet that is likely an ingredient of the other variants. */
		maybeSame: 'même ingrédient ?',
		maybeLink: 'Relier',
		maybeLinkTitle: (name: string, entry: string) => `Relier « ${name} » à « ${entry} », dans toutes les recettes`,
		/** /familles, under a group's name: what its recipes are. */
		summaryLabel: 'Ce qui les distingue',
		/** /familles?grouper=: one recipe, grouped from its ⋯ menu. */
		/** The recipe's ⋯ menu (the owner). */
		groupWith: 'Grouper avec…',
		groupTitle: (title: string) => `Grouper « ${title} » avec…`,
		groupHelp: 'Un groupe de variantes existant, ou une autre recette : elles deviendront deux variantes d’un même plat.',
		groupSearch: 'Chercher un groupe ou une recette',
		groupIsFamily: (n: number) => (n === 1 ? 'groupe · 1 variante' : `groupe · ${n} variantes`),
		groupIsRecipe: 'recette',
		groupSave: 'Grouper',
		groupCancel: 'Annuler',
		/** In the comparison table: ✓ in it, – not; for a screen reader, oui / non. */
		yes: 'oui',
		no: 'non',
		legend: '✓ : dans cette variante · – : absent',
		/** « Grouper avec… »: the closest group or recipe, before she types (the same score as the search's order). */
		suggestion: 'Suggestion :',
		suggestionPick: 'Grouper',
		/** /familles, the owner: a group's name in her words, on its line. */
		renameShort: 'Renommer',
		renameTitle: (name: string) => `Renommer « ${name} »`,
		renameLabel: (name: string) => `Nouveau nom pour « ${name} »`,
		refused: {
			slug: 'nom de groupe invalide.',
			notNames: (file: string) => `${file} n’est pas une liste de noms ; corrigez-le d’abord.`,
			changed: 'les noms de groupes ont changé depuis l’ouverture de la page ; rechargez-la.',
			commit: (why: string) => `le nom n’a pas pu être enregistré (git) ; rien n’a changé : ${why}`
		}
	},
	/** Pending tags, /etiquettes (plan 04, Phase 8; Q11 B). */
	pendingTags: {
		title: 'Étiquettes en attente',
		intro: 'Gardez une étiquette nouvelle, ou dites à laquelle elle correspond.',
		empty: 'Aucune étiquette en attente : toutes les étiquettes des recettes sont dans le vocabulaire.',
		recipes: (n: number) => (n === 1 ? '1 recette' : `${n} recettes`),
		written: (forms: string[]) => `Écrite : ${forms.map((f) => `« ${f} »`).join(', ')}`,
		broken: 'fichier en erreur',
		suggestion: (label: string) => `Proche de « ${label} »`,
		accept: 'Nouvelle étiquette',
		acceptHelp: (slug: string) => `Ajoutée au vocabulaire sous l’identifiant « ${slug} ». Les recettes ne changent pas.`,
		acceptHelpShort: 'Ajoutée au vocabulaire des étiquettes. Les recettes ne changent pas.',
		/** The pending tags left, in the page's head. */
		count: (n: number) => (n === 1 ? '1 à décider' : `${n} à décider`),
		acceptNoSlug: 'Cette étiquette n’a aucune lettre ou chiffre dont faire un identifiant : reliez-la ou retirez-la.',
		label: 'Nom affiché',
		acceptSave: 'Ajouter au vocabulaire',
		/** One row per tag: « Garder « Érable » » (✎ changes the name), « C'est comme… », « Retirer ». */
		keep: (label: string) => `Garder « ${label} »`,
		rename: 'Changer le nom affiché',
		recipesOf: 'Les recettes',
		map: 'C’est comme…',
		mapHelp: 'Relier à une étiquette existante : les recettes la montreront sous ce nom. Les recettes ne changent pas.',
		mapLabel: 'Étiquette existante',
		mapSave: 'Relier',
		drop: 'Retirer',
		dropHelp: (n: number) =>
			`Enlève cette étiquette de ${n === 1 ? 'la recette' : `ces ${n} recettes`}, en une seule modification. C’est la seule action qui change les recettes ; l’historique garde l’ancienne version.`,
		dropSave: (n: number) => (n === 1 ? 'Retirer de la recette' : `Retirer des ${n} recettes`),
		accepted: (label: string) => `« ${label} » est maintenant une étiquette du vocabulaire.`,
		mapped: (tag: string, label: string) => `« ${tag} » est reliée à « ${label} ».`,
		dropped: (tag: string, n: number) => `« ${tag} » a été retirée de ${n === 1 ? '1 recette' : `${n} recettes`}.`,
		refused: {
			notTags: (file: string) => `${file} n’est pas une liste d’étiquettes ; corrigez-le d’abord.`,
			edit: (file: string) => `${file} n’a pas pu être modifié proprement ; rien n’a changé.`,
			notPending: 'cette étiquette n’est plus en attente ; rechargez la page.',
			write: (why: string) => `le vocabulaire n’a pas pu être écrit ; rien n’a changé : ${why}`,
			commit: (why: string) => `le vocabulaire n’a pas pu être enregistré (git) ; rien n’a changé : ${why}`,
			changed: 'le vocabulaire a changé depuis l’ouverture de la page ; rechargez-la.',
			noSlug: 'cette étiquette n’a aucune lettre ou chiffre dont faire un identifiant ; reliez-la à une étiquette existante ou retirez-la.',
			known: (slug: string) => `« ${slug} » est déjà dans le vocabulaire ; utilisez « C’est comme… ».`,
			pick: 'choisissez une étiquette du vocabulaire.',
			moreRecipes: 'd’autres recettes portent cette étiquette depuis l’ouverture de la page ; rechargez-la.',
			recipeChanged: 'une des recettes a changé depuis l’ouverture de la page ; rechargez-la.',
			recipeInvalid: (slug: string) => `la recette « ${slug} » ne passe pas la validation ; faites-la corriger d’abord.`,
			recipesWrite: (why: string) => `les recettes n’ont pas pu être écrites ; rien n’a changé : ${why}`,
			recipesCommit: (why: string) => `les recettes n’ont pas pu être enregistrées (git) ; rien n’a changé : ${why}`,
			undo: 'impossible d’annuler ce choix ; voyez l’historique du vocabulaire.',
			undoStale: 'impossible d’annuler : le vocabulaire a changé depuis ; rechargez la page.'
		}
	},
	duplicates: {
		title: 'Doublons possibles',
		intro: 'Recettes presque pareilles, les plus proches d’abord. Chaque choix s’annule.',
		empty: 'Aucun doublon possible : aucune paire de recettes n’a presque les mêmes ingrédients.',
		count: (n: number) => (n === 1 ? '1 paire' : `${n} paires`),
		/** The page's head: cards left, and how many are very close (≥ 90 %). */
		head: (n: number, close: number, fresh: number, done = 0) =>
			[
				`${n === 1 ? '1 groupe' : `${n} groupes`} à décider`,
				done ? `${done} sur ${n + done} fait${done > 1 ? 's' : ''}` : '',
				close ? `${close} très semblable${close > 1 ? 's' : ''}` : '',
				fresh ? `${fresh} nouveau${fresh > 1 ? 'x' : ''}` : ''
			]
				.filter(Boolean)
				.join(' · '),
		/** After a decision, in its toast: what is left. */
		left: (n: number) => (n ? ` Reste ${n === 1 ? '1 groupe' : `${n} groupes`} à décider.` : ' Plus aucun groupe à décider.'),
		/** The two fiches of a card's closest pair, on their cards. */
		closestMark: 'Les plus proches',
		/** « Toutes différentes »: the cards little alike (duplicates.ts LOW_CLOSE). */
		low: (n: number, pct: number) =>
			`${n === 1 ? '1 groupe est peu semblable' : `${n} groupes sont peu semblables`} : moins de ${pct} % en commun, des titres et des préparations différents, une même langue.`,
		lowOpen: 'Les marquer toutes différentes…',
		lowHelp: 'Ces fiches ne seront plus proposées ensemble. Les recettes ne changent pas, et « Annuler » les remet.',
		lowSave: (n: number) => (n === 1 ? 'Marquer ce groupe : recettes différentes' : `Marquer ces ${n} groupes : recettes différentes`),
		lowDone: (n: number) => (n === 1 ? '1 groupe écarté : il ne sera plus proposé.' : `${n} groupes écartés : ils ne seront plus proposés.`),
		/** A card of more than two recipes. */
		similar: (n: number) => `${n} fiches semblables`,
		/** Before the badges of a card of three or more: they are about its closest pair. */
		closest: 'Les 2 plus proches :',
		/** A card of two standing for every pair between two dishes kept apart. */
		bridged: (n: number) => `Et ${n === 1 ? '1 autre paire' : `${n} autres paires`} entre ces deux plats, écartée${n > 1 ? 's' : ''} avec elle s’ils sont différents.`,
		/** The members beyond the closest, behind a button. */
		moreMembers: (n: number) => (n === 1 ? '+ 1 autre fiche' : `+ ${n} autres fiches`),
		fewer: (n: number) => `Montrer seulement les ${n} plus proches`,
		fresh: 'Nouveau',
		/** The head's « 1 nouveau », a link to the first new card (they sort first). */
		freshCount: (n: number) => (n === 1 ? '1 nouveau' : `${n} nouveaux`),
		/** The one line a decided card folds into, with « Annuler » after it. */
		receiptDone: 'Fait :',
		receiptVersions: (name: string, n: number) => `${name} : ${n} variantes`,
		receiptSame: (kept: string, n: number) => `${kept} gardée · ${n === 1 ? '1 fiche' : `${n} fiches`} à la corbeille`,
		receiptDistinct: (titles: string) => `${titles} : recettes différentes`,
		receiptLow: (n: number) => `${n === 1 ? '1 groupe peu semblable' : `${n} groupes peu semblables`} : recettes différentes`,
		/** After a decision about some of a card's recipes: the card stays for the others. */
		receiptRest: (n: number) => `la carte reste : ${n} fiches encore semblables`,
		andMore: (first: string, n: number) => `${first} et ${n === 1 ? '1 autre' : `${n} autres`}`,
		/** The keyboard path, one line above the cards (a wide screen). */
		keys: 'Clavier : J / K carte suivante / précédente · 1, 2, 3 les trois choix · Échap referme',
		keysToggle: 'Raccourcis clavier',
		/** Which recipes of a card a decision is about (a card of three or more). */
		pick: 'La décision vise :',
		pickHelp: 'Les deux plus proches sont cochées ; cochez-en d’autres pour les inclure.',
		pickTwo: 'cochez au moins deux fiches.',
		comparePairs: 'Comparer deux fiches',
		compareThese: (a: string, b: string, pct: number) => `${a} et ${b} (${pct} %)`,
		detail: 'Détail',
		slugs: 'Identifiants des fichiers',
		groupName: 'Nom du groupe',
		groupNameHelp: 'Le nom montré pour ce plat sur Variantes ; modifiable plus tard.',
		groupJoin: (label: string) => `Elles rejoignent le groupe « ${label} ».`,
		groupPick: 'Groupe à rejoindre',
		score: (pct: number) => `${pct} % en commun`,
		sameMethod: 'Même préparation, mot pour mot',
		sameTitle: 'Même titre',
		nearTitle: 'Titre presque pareil',
		shared: 'En commun',
		only: (title: string) => `Seulement dans « ${title} »`,
		noSource: 'Provenance inconnue',
		familyOf: (label: string, variant: string | null) => (variant ? `Variante de ${label} — ${variant}` : `Variante de ${label}`),
		compare: 'Comparer',
		versions: 'Deux variantes du même plat',
		versionsMany: 'Variantes d’un même plat',
		versionsHelp: 'Les recettes restent ; elles deviennent des variantes d’un même plat, regroupées.',
		family: 'Groupe de variantes',
		familyLabel: 'Nom affiché du groupe',
		variant: (title: string) => `Ce qui distingue « ${title} »`,
		variantPlaceholder: 'ex. zeste de citron, sans sucre',
		versionsSave: 'En faire deux variantes',
		versionsSaveMany: (n: number) => `En faire ${n} variantes`,
		sameFamily: 'Déjà variantes du même plat, avec les mêmes ingrédients et quantités : c’est sans doute la même fiche.',
		same: 'C’est la même recette',
		sameHelp: 'Gardez-en une ; l’autre va à la corbeille, d’où elle peut revenir.',
		keep: (title: string) => `Garder « ${title} »`,
		sameSave: 'Mettre l’autre à la corbeille',
		sameSaveMany: (n: number) => `Mettre ${n} fiches à la corbeille`,
		sameHelpMany: 'Gardez-en une ; les autres fiches cochées vont à la corbeille, d’où elles peuvent revenir.',
		pickDrop: 'cochez au moins une autre fiche.',
		pickOne: 'choisissez la recette à garder.',
		usedBy: 'Sert de sous-recette dans',
		keepUsed: (title: string) => `« ${title} » sert de sous-recette ailleurs : c’est celle-là qui reste.`,
		bothUsed: 'Les deux servent de sous-recette ailleurs : changez d’abord ces recettes pour n’en utiliser qu’une, puis revenez ici.',
		distinct: 'Recettes différentes',
		distinctHelp: 'Cette paire ne sera plus proposée. Les recettes ne changent pas.',
		distinctHelpAll: 'Ces fiches ne seront plus proposées ensemble. Les recettes ne changent pas.',
		distinctHelpSome: 'La fiche cochée ne sera plus proposée avec les autres. Les recettes ne changent pas.',
		distinctHelpTicked: 'Les fiches cochées ne seront plus proposées ensemble ; les autres restent sur la carte. Les recettes ne changent pas.',
		distinctHelpBridge: (n: number) => `Les ${n} paires entre ces deux plats ne seront plus proposées. Les recettes ne changent pas.`,
		distinctSave: 'Ce sont deux recettes différentes',
		distinctSaveMany: 'Ce sont des recettes différentes',
		distinctSaveSome: 'Pas le même plat que les autres',
		versionsDone: (n: number, family: string) => `${n === 2 ? 'Les deux recettes sont' : `Les ${n} recettes sont`} maintenant des variantes de « ${family} ».`,
		sameDone: (titles: string[]) =>
			titles.length === 1 ? `« ${titles[0]} » est dans la corbeille.` : `${titles.map((x) => `« ${x} »`).join(', ')} sont dans la corbeille.`,
		distinctDone: (pairs: number): string => (pairs === 1 ? 'Paire écartée : elle ne sera plus proposée.' : 'Fiches écartées : elles ne seront plus proposées ensemble.'),
		undo: 'Annuler',
		undone: 'Annulé.',
		undoRefused: 'Impossible d’annuler : une des recettes a changé depuis. Voyez son historique.',
		/** A phone: the cards of the page past the first 5. */
		showRest: (n: number) => (n === 1 ? 'Voir la suivante' : `Voir les ${n} suivantes`),
		prev: 'Précédentes',
		next: 'Suivantes',
		page: (p: number, n: number) => `Page ${p} sur ${n}`,
		compareTitle: 'Comparer deux recettes',
		compareHelp: 'Chaque ligne où elles diffèrent ; le reste est pareil.',
		compareSame: 'Les deux recettes sont identiques, au titre près.',
		back: 'Retour aux doublons',
		refused: {
			notPairs: (file: string) => `${file} n’est pas une liste de paires ; corrigez-le d’abord.`,
			edit: (file: string) => `${file} n’a pas pu être modifié sans rien perdre ; corrigez-le à la main.`,
			commit: (why: string) => `le choix n’a pas pu être enregistré (git) ; rien n’a changé : ${why}`,
			pair: 'paire invalide.',
			changed: 'la liste a changé depuis l’ouverture de la page ; rechargez-la.',
			family: 'choisissez un nom de groupe.',
			variants: 'dites ce qui distingue chacune des variantes.',
			variant: 'dites ce qui distingue cette variante.',
			variantTaken: 'une autre recette du groupe porte déjà ce nom de variante.',
			sameVariant: 'donnez deux noms de variante différents.',
			versions: (why: string) => `les deux variantes n’ont pas pu être enregistrées ; rien n’a changé : ${why}`,
			used: (titles: string[]) =>
				`cette recette sert de sous-recette dans ${titles.map((x) => `« ${x} »`).join(', ')} ; gardez-la plutôt, ou changez d’abord ces recettes.`,
			trash: 'la recette n’a pas pu être mise à la corbeille ; rien n’a changé.'
		}
	},
	queue: {
		title: 'Ingrédients à relier',
		intro: 'Les noms d’ingrédients des recettes qui ne correspondent à aucun ingrédient du registre, les plus fréquents d’abord. Relier un nom une fois le relie dans toutes les recettes qui l’emploient ; aucune recette n’est modifiée.',
		empty: 'Tous les noms d’ingrédients sont reliés au registre.',
		count: (n: number, r: number) => `${n} fois dans ${r === 1 ? '1 recette' : `${r} recettes`}`,
		recipes: 'Voir les recettes',
		ambiguous: 'Ce nom appartient à plusieurs ingrédients : il reste non relié tant qu’il n’en garde qu’un.',
		ruleClash: (names: string[]) =>
			`Les règles de ${names.map((n) => `« ${n} »`).join(' et de ')} valent toutes deux sur certaines lignes. Une règle passe avant un nom : relier ce nom ou créer un ingrédient n’y changerait rien. Retirez le nom (et sa règle) de l’un d’eux, ou rendez leurs conditions distinctes.`,
		/** A name as written and how many times. */
		form: (name: string, count: number) => `« ${name} » (${count})`,
		suggestions: 'Suggestions',
		none: 'Aucun ingrédient proche.',
		thisOne: 'C’est ça',
		/** The key that takes a suggestion on /resoudre. */
		key: (n: number) => (n === 1 ? 'Touche 1 ou Entrée' : `Touche ${n}`),
		/** A guess (no clear match): its key only puts the focus on it, Entrée then takes it. */
		keyGuess: (n: number) => `Touche ${n}, puis Entrée`,
		/** The heading of suggestions none of which is a clear match. */
		guesses: 'Peut-être (à vérifier)',
		owners: 'Ingrédients qui portent ce nom',
		remove: (name: string) => `Retirer de « ${name} »`,
		link: 'Relier à un ingrédient existant',
		linkField: 'Ingrédient',
		linkSubmit: 'Relier',
		create: 'Créer un ingrédient',
		slug: 'Identifiant',
		slugHelp: 'Lettres minuscules sans accents, chiffres et traits d’union. Le fichier sera ingredients/<identifiant>.md.',
		category: 'Catégorie',
		categoryPick: 'Choisir…',
		staple: 'Toujours à la maison (sel, farine…)',
		createSubmit: 'Créer',
		rule: 'Selon l’unité ou la préparation',
		ruleHelp: 'Relie seulement les lignes qui remplissent toutes les conditions cochées ; les autres restent ici. La règle est enregistrée dans le fichier de l’ingrédient.',
		ruleUnits: 'Unités',
		ruleClass: { mass: 'tout poids', volume: 'toute mesure de volume', count: 'toute unité de compte', container: 'tout contenant' } as Record<string, string>,
		ruleWords: 'Mots de la préparation ou de la note',
		ruleWordsHelp: 'Séparés par des virgules, par exemple : haché, en cubes.',
		ruleLang: (lang: string) => `Seulement dans les ${lang}`,
		ruleSubmit: 'Ajouter la règle',
		linked: (form: string, name: string, recipes: number) => `« ${form} » est relié à ${name}${recipes ? ` dans ${recipes === 1 ? '1 recette' : `${recipes} recettes`}` : ''}.`,
		created: (slug: string) => `Ingrédient ${slug} créé.`,
		removed: (name: string) => `Nom retiré de ${name}.`,
		ruled: (form: string, name: string, n: number) =>
			`Règle ajoutée : « ${form} » va à ${name} ${n === 1 ? 'sur 1 ligne' : `sur ${n} lignes`} qui la remplissent.`,
		more: (n: number) => `${n} autres noms plus bas dans la liste.`,
		/** The page's head. */
		headCount: (n: number) => (n === 1 ? '1 ingrédient à relier' : `${n} ingrédients à relier`),
		/** Under the cards shown, when more wait. */
		shown: (n: number, total: number) => `${n} sur ${total}`,
		next: 'Voir les suivants',
		detail: 'Détail',
		gone: 'Ce nom est déjà relié au registre : il n’est plus dans la liste.',
		lang: { fr: 'recettes en français', en: 'recettes en anglais' } as Record<string, string>,
		refused: {
			ruleClash: (form: string, names: string[]) =>
				`« ${form} » reste ambigu : les règles de ${names.join(' et de ')} valent toutes deux sur certaines lignes, et une règle passe avant un nom. Un nouveau nom n’y changerait rien ; retirez ce nom (et sa règle) de l’un d’eux, ou rendez leurs conditions distinctes.`,
			commit: (why: string) => `l’ingrédient n’a pas pu être enregistré (git) ; rien n’a changé : ${why}`,
			/** `codes`: the checker's codes, empty when the file does not read at all. */
			invalid: (codes: string) => `l’ingrédient ne passerait pas la validation (${codes || 'illisible'}).`,
			slug: 'identifiant d’ingrédient invalide.',
			changed: (slug: string) => `l’ingrédient ${slug} a changé depuis l’ouverture de la page ; rechargez-la.`,
			linked: 'ce nom est déjà relié ; rechargez la page.',
			newSlug: 'identifiant invalide : lettres minuscules sans accents, chiffres et traits d’union.',
			exists: (slug: string) => `l’ingrédient ${slug} existe déjà ; reliez le nom à celui-ci, ou choisissez un autre identifiant.`,
			notAName: (slug: string) => `ce nom n’est plus un nom de ${slug} ; rechargez la page.`,
			noCondition: 'choisissez au moins une condition : une unité, un mot ou la langue.',
			sameRule: (slug: string) => `${slug} a déjà cette règle.`,
			undo: 'impossible d’annuler ce choix ; voyez l’historique de l’ingrédient.',
			undoStale: 'impossible d’annuler : l’ingrédient a changé depuis ; rechargez la page.'
		}
	},
	ingredients: {
		title: 'Ingrédients',
		intro: 'Le registre des ingrédients et leur prix. Pour que le coût des recettes se remplisse vite, commencez par le haut : les ingrédients les plus employés qui n’ont pas encore de prix.',
		count: (n: number, priced: number) => `${n === 1 ? '1 ingrédient' : `${n} ingrédients`} · ${priced} avec un prix`,
		search: 'Chercher un ingrédient',
		category: 'Catégorie',
		allCategories: 'Toutes',
		priced: 'Prix',
		pricedAll: 'Tous',
		pricedYes: 'Avec un prix',
		pricedNo: 'Sans prix',
		staple: 'Essentiels',
		stapleAll: 'Tous',
		stapleYes: 'Essentiels seulement',
		stapleNo: 'Sans les essentiels',
		filter: 'Filtrer',
		clear: 'Tout effacer',
		cols: { nom: 'Ingrédient', categorie: 'Catégorie', recettes: 'Recettes', date: 'Prix actuel', 'a-saisir': 'À saisir' } as Record<string, string>,
		sortDefault: 'Ordre de saisie : sans prix et les plus employés d’abord',
		stapleMark: 'essentiel',
		per: (pack: string) => `/ ${pack}`,
		stale: 'plus d’un an',
		staleTitle: 'Prix de plus d’un an : à revoir',
		noPrice: 'Aucun prix',
		enter: 'Saisir un prix',
		enterFor: (name: string) => `Saisir un prix pour ${name}`,
		amount: 'Montant',
		packQty: 'Format',
		packUnit: 'Unité',
		unitPick: 'Choisir…',
		shop: 'Magasin',
		date: 'Date',
		save: 'Enregistrer',
		cancel: 'Annuler',
		keys: 'Entrée enregistre et passe à la ligne suivante ; Échap annule.',
		saved: (name: string, price: string) => `Prix enregistré : ${name}, ${price}.`,
		empty: 'Aucun ingrédient ne correspond.',
		emptyRegistry: 'Le registre est vide. Les ingrédients se créent depuis la page « À relier ».',
		problems: (n: number) => (n === 1 ? '1 problème dans prices.csv' : `${n} problèmes dans prices.csv`),
		line: (n: number) => `Ligne ${n}`,
		refused: {
			amount: 'le montant doit être un nombre plus grand que zéro.',
			packQty: 'le format doit être un nombre plus grand que zéro.',
			packUnit: 'choisissez l’unité du format.',
			date: 'la date doit s’écrire AAAA-MM-JJ.',
			header: (missing: string[]) =>
				`la première ligne de prices.csv n’est pas un en-tête lisible (il manque ${missing.join(', ')}) ; corrigez-la d’abord. Rien n’a été écrit.`,
			column: (missing: string[]) => `prices.csv n’a pas de colonne ${missing.join(' ni ')} : ajoutez-la à l’en-tête, ou laissez ce champ vide. Rien n’a été écrit.`,
			line: 'la ligne ne se relirait pas telle que saisie avec l’en-tête de prices.csv ; vérifiez le fichier. Rien n’a été écrit.',
			write: (why: string) => `prices.csv n’a pas pu être écrit ; rien n’a changé : ${why}`,
			commit: (why: string) => `le prix n’a pas pu être enregistré (git) ; rien n’a changé : ${why}`
		},
		unit: {
			g: 'g',
			kg: 'kg',
			ml: 'ml',
			cl: 'cl',
			l: 'L',
			cup: 'tasse',
			tbsp: 'c. à table',
			tsp: 'c. à thé',
			pinch: 'pincée',
			drop: 'goutte',
			lb: 'lb',
			oz: 'oz',
			qt: 'pinte',
			pint: 'chopine',
			piece: 'pièce',
			clove: 'gousse',
			leaf: 'feuille',
			sprig: 'brin',
			stalk: 'branche',
			bunch: 'botte',
			slice: 'tranche',
			can: 'boîte',
			packet: 'sachet',
			bottle: 'bouteille',
			jar: 'pot',
			bag: 'sac'
		} as Record<string, string>
	},
	/** The ingredient view, /ingredients/<slug> (plan 03, Phase 6). */
	ingredient: {
		back: 'Tous les ingrédients',
		notFound: 'Cet ingrédient n’est pas dans le registre.',
		staple: 'toujours à la maison',
		auGout: 'peut être « au goût »',
		allergens: 'Allergènes',
		noAllergen: 'Aucun allergène noté.',
		names: 'Noms',
		lang: { fr: 'Français', en: 'Anglais' } as Record<string, string>,
		addName: 'Ajouter un nom',
		addNameField: 'Nom tel qu’écrit dans les recettes',
		addNameLang: 'Langue',
		addNameSubmit: 'Ajouter',
		nameAdded: (name: string) => `Nom « ${name} » ajouté. Les recettes qui l’écrivent sont maintenant reliées.`,
		rules: 'Selon l’unité ou la préparation',
		rule: (names: string[], cond: string[]) => `« ${names.join(' », « ')} » quand ${cond.join(' et ')}`,
		ruleLang: (lang: string) => `dans les recettes en ${lang === 'en' ? 'anglais' : 'français'}`,
		ruleUnit: (units: string[]) => `l’unité est ${units.join(' ou ')}`,
		ruleWords: (words: string[]) => `la préparation dit ${words.map((w) => `« ${w} »`).join(' ou ')}`,
		facts: 'Mesures',
		defaultUnit: 'Unité de référence',
		defaultUnitHelp: 'Pour additionner les quantités des recettes et comme unité proposée pour un prix.',
		density: 'Densité',
		densityValue: (d: string) => `${d} g par ml`,
		weights: 'Poids d’une unité',
		weightValue: (unit: string, g: string) => `1 ${unit} = ${g} g`,
		none: '—',
		price: 'Prix',
		noPrice: 'Aucun prix pour l’instant.',
		enterPrice: 'Saisir un prix',
		current: 'Prix actuel',
		stale: 'Ce prix a plus d’un an : à revoir.',
		history: 'Historique des prix',
		historyCols: { date: 'Date', price: 'Prix', shop: 'Magasin', change: 'Variation' } as Record<string, string>,
		foreign: (cur: string) => `en ${cur} : affiché, pas compté dans les coûts`,
		/** `pct`: signed, without the sign of percent (`+12`). */
		change: (pct: string) => `${pct} %`,
		same: 'stable',
		recipes: (n: number) => (n === 0 ? 'Aucune recette ne l’emploie.' : n === 1 ? 'Employé dans 1 recette' : `Employé dans ${n} recettes`),
		byAmount: (unit: string) => `Triées par quantité employée, en ${unit}. Les quantités qui ne se convertissent pas viennent ensuite.`,
		unitFrom: {
			default: 'l’unité de référence',
			price: 'l’unité du prix actuel',
			usage: 'l’unité la plus employée'
		} as Record<string, string>,
		total: (amount: string, n: number) => `Total dans le coffre : ${amount} dans ${n === 1 ? '1 recette' : `${n} recettes`}`,
		unconverted: (n: number) => (n === 1 ? '1 recette dont la quantité ne se convertit pas' : `${n} recettes dont la quantité ne se convertit pas`),
		noQty: 'sans quantité',
		toTaste: 'au goût',
		optional: 'facultatif',
		option: 'au choix, avec un autre ingrédient',
		substitutes: 'Se remplace par',
		substituteFor: 'Remplace',
		noSubstitute: 'Aucun.',
		drift: 'Noms non reliés qui lui ressemblent',
		driftHelp: 'Des noms écrits dans les recettes qui ne sont reliés à aucun ingrédient, et pour lesquels celui-ci est suggéré.',
		driftNone: 'Aucun nom non relié ne lui ressemble.',
		driftAmbiguous: 'nom partagé avec un autre ingrédient',
		driftQueue: 'Régler dans « À relier »',
		linkHere: 'Relier ici',
		linked: (form: string) => `« ${form} » est relié à cet ingrédient.`,
		edit: 'Modifier l’ingrédient',
		editHelp: 'Un nom par ligne. Le fichier de l’ingrédient est modifié et enregistré ; aucune recette n’est touchée.',
		namesField: (lang: string) => `Noms en ${lang === 'en' ? 'anglais' : 'français'}`,
		category: 'Catégorie',
		stapleField: 'Toujours à la maison (sel, farine…)',
		auGoutField: 'Peut s’écrire « au goût » (sel, poivre, huiles, beurre…)',
		unitNone: 'Aucune',
		densityField: 'Densité (g par ml)',
		weightsField: 'Poids d’une unité (g)',
		weightUnit: 'Unité',
		weightGrams: 'Grammes',
		substitutesField: 'Se remplace par (identifiants, séparés par des virgules)',
		allergensField: 'Allergènes',
		save: 'Enregistrer',
		saved: 'Ingrédient enregistré.',
		merge: 'Fusionner dans…',
		mergeHelp: (name: string) =>
			`Pour un doublon : les noms, règles, substituts et allergènes de « ${name} » passent à l’ingrédient choisi, puis son fichier est supprimé. Refusé si « ${name} » a des prix.`,
		mergeField: 'Ingrédient qui le remplace',
		mergeSubmit: 'Fusionner',
		mergeConfirm: (from: string, into: string) => `Fusionner « ${from} » dans « ${into} » et supprimer « ${from} » ?`,
		merged: (from: string, into: string) => `« ${from} » a été fusionné dans ${into}.`,
		problems: 'Problèmes dans le fichier',
		broken: 'Le fichier de cet ingrédient ne passe plus la validation. La page montre la dernière version valide.',
		file: (path: string) => `Fichier : ${path}`,
		refused: {
			noName: 'gardez au moins un nom.',
			density: 'la densité doit être un nombre plus grand que zéro (grammes par millilitre).',
			weightUnit: 'choisissez l’unité de chaque poids.',
			weight: (unit: string) => `le poids d’une unité (${unit}) doit être un nombre de grammes plus grand que zéro.`,
			substitute: (slugs: string) => `substitut inconnu : ${slugs}.`,
			allergen: (names: string) => `allergène hors de la liste : ${names}.`,
			unchanged: 'rien n’a changé.',
			nameMissing: 'écrivez le nom à ajouter.',
			lang: 'langue inconnue.',
			self: 'choisissez un autre ingrédient que celui-ci.',
			prices: (slug: string, n: number) =>
				`${slug} a ${n === 1 ? '1 prix' : `${n} prix`} dans prices.csv ; le fichier des prix ne se réécrit pas. Fusionnez à la main ou gardez les deux ingrédients.`,
			overrides: (slug: string, recipes: string) => `des recettes nomment ${slug} dans « item: » (${recipes}) ; corrigez-les d’abord.`,
			bought: (slug: string, recipes: string) =>
				`des recettes achètent ${slug} au lieu de le faire (« recipe: ${slug} » avec « buy_instead: true » : ${recipes}) ; sans l’ingrédient ${slug}, ces lignes perdraient leur prix et leur place au garde-manger. Corrigez-les d’abord.`
		}
	},
	/** Pantry search, /garde-manger (plan 03, Phase 7). */
	pantry: {
		title: 'Garde-manger',
		intro: 'Dites ce que vous avez sous la main : les recettes qu’on peut faire tout de suite viennent en premier, puis celles où il manque peu.',
		have: 'J’ai',
		must: 'Doit contenir',
		avoid: 'À éviter',
		add: 'Ajouter un ingrédient',
		addTo: 'dans',
		addSubmit: 'Ajouter',
		addHelp: 'Un nom d’ingrédient, en français ou en anglais.',
		remove: (name: string) => `Retirer ${name}`,
		unknown: (name: string) => `« ${name} » n’est pas un ingrédient du registre.`,
		allergens: 'Sans allergènes',
		staples: 'Supposer les essentiels (sel, farine, beurre…)',
		apply: 'Chercher',
		clear: 'Tout effacer',
		empty: 'Ajoutez au moins un ingrédient que vous avez.',
		none: 'Aucune recette n’emploie ces ingrédients.',
		tiers: {
			pret: 'Prêt à cuisiner',
			substitution: 'Avec une substitution',
			presque: 'Presque',
			idees: 'Idées'
		} as Record<string, string>,
		tierHelp: {
			pret: 'Rien ne manque.',
			substitution: 'Ce qui manque se remplace par ce que vous avez : ce n’est plus tout à fait la recette d’origine.',
			presque: 'Il manque un ou deux ingrédients.',
			idees: 'Emploie au moins un de vos ingrédients.'
		} as Record<string, string>,
		count: (n: number) => (n === 1 ? '1 recette' : `${n} recettes`),
		more: (n: number) => `Voir les ${n} autres`,
		coverage: (m: number, r: number) => `${m} sur ${r}`,
		coverageTitle: 'Ingrédients requis que vous avez (les essentiels supposés, les « au goût » et les facultatifs ne comptent pas)',
		missing: 'Manque :',
		or: ' ou ',
		swaps: 'Remplacer :',
		unresolved: (n: number) => (n === 1 ? '+ 1 ingrédient pas encore relié' : `+ ${n} ingrédients pas encore reliés`),
		unresolvedTitle: 'Ces noms ne sont reliés à aucun ingrédient du registre : la recherche ne peut pas savoir si vous les avez.'
	},
	category: {
		frais: 'Frais',
		viande: 'Viande',
		poisson: 'Poisson',
		legume: 'Légumes',
		fruit: 'Fruits',
		cremerie: 'Crèmerie',
		epicerie: 'Épicerie',
		conserve: 'Conserves',
		surgele: 'Surgelés',
		epice: 'Épices',
		boisson: 'Boissons',
		autre: 'Autre'
	} as Record<string, string>,
	recipe: {
		by: 'de',
		/** « de Francine », « d’Aline »: the provenance line's person, with French elision. */
		from: (name: string): string => (/^[aeiouyàâäéèêëîïôöùûüœæ]/i.test(name.trim()) ? 'd’' : 'de '),
		/** A book, magazine, show or site: « Tiré de <titre> ». */
		takenFrom: 'Tiré de',
		/** The steps' style, two buttons on the method's head (issue #5: bullets by default, per device). */
		stepStyle: 'Présentation des étapes',
		stepsBullets: 'Puces',
		hintDismiss: 'Compris',
		/** The head's first line: « Une des 4 variantes de » + the family's name (a link). One word, « variante », for sibling recipes everywhere. */
		versionOf: (n: number, name: string): string => {
			const de = /^[aeiouyàâäéèêëîïôöùûüœæ]/i.test(name.trim()) ? 'd’' : 'de ';
			return n > 1 ? `Une des ${n} variantes ${de}` : `Seule variante ${de}`;
		},
		addPhoto: 'Ajouter une photo',
		addPhotoShort: '+ Photo',
		/** Beside the print of the photo in the recipe head, and its tooltip: opens it full size. */
		photoOpen: 'Voir la photo en grand',
		/** « Autres variantes »: the first three, then the rest behind this. */
		moreVariants: (n: number) => (n === 1 ? 'Voir l’autre' : `Voir les ${n} autres`),
		unresolved: (n: number) => `Ingrédients pas encore reliés (${n})`,
		unresolvedHelp: 'Ces noms ne correspondent à aucun ingrédient du registre. La recette reste utilisable ; ils restent seulement hors des listes d’épicerie et des coûts tant qu’ils ne sont pas reliés.',
		vocab: (n: number) => `Étiquettes et variantes à revoir (${n})`,
		/** At the page's foot, for the keeper (usability round 6): one line per W501 / W502, its decision a link away; the code behind « Détails ». */
		vocabTag: (tag: string) => `Étiquette nouvelle : ${tag}`,
		vocabTagGo: 'Décider dans Étiquettes ›',
		vocabFamily: (name: string) => `Nom de plat proche d’un autre : ${name}`,
		vocabFamilyGo: 'Décider dans Variantes ›',
		vocabDetails: 'Détails',
		vocabHelp: 'Une étiquette hors du vocabulaire du coffre, ou un nom de groupe de variantes très proche d’un autre. La recette reste utilisable ; corrigez le fichier ou le vocabulaire (vocab/tags.yaml, vocab/families.yaml).',
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
		/** Phone, a long ingredient list: down to the method and back up. */
		/** One column: the sticky bar over the sheet, « Ingrédients | Préparation » (usability round 4). */
		jumpLabel: 'Aller à',
		method: 'Préparation',
		/** After a line that is a sub-recipe: a small link to its page. */
		subRecipeShort: 'recette',
		subRecipeGo: (name: string) => `Recette : ${name}`,
		/** After a line linked to its ingredient: a small › to the ingredient's page. */
		itemGo: (name: string) => `Fiche de l’ingrédient : ${name}`,
		decrease: 'Moins de portions',
		increase: 'Plus de portions',
		variants: 'Autres variantes',
		usedBy: 'Utilisée dans',
		legend: 'Légende',
		legendUncertain: 'lecture incertaine',
		legendIllegible: 'illisible sur l’original',
		/** The chip that shows `[+]` in the text, and the legend's line for it. */
		markerAdded: 'ajouté',
		legendAdded: 'absent de l’original, ajouté à la transcription',
		/** Ingredients ticked off on the read page (per tab, per recipe). */
		ticked: (n: number) => (n === 1 ? '1 ingrédient coché' : `${n} ingrédients cochés`),
		untickAll: 'Tout décocher',
		cookMode: 'Cuisiner',
		/** A cook in progress on this device (kitchen mode's saved session): the head's button resumes it. */
		/** `amount`: the session's own amount when it is not the page's (« · 10 portions »). */
		cookResume: (step: number | null, amount?: string) => (step ? `Reprendre · étape ${step}` : 'Reprendre') + (amount ? ` · ${amount}` : ''),
		cookResumeTitle: 'Reprendre la cuisson commencée sur cet appareil, à la même quantité',
		print: 'Imprimer',
		/** Device setting: method steps numbered instead of bullets, on screen and in print. */
		numberSteps: 'Numéros',
		verify: 'Marquer vérifiée',
		verifyHelp: 'Marquer comme relue contre l’original',
		verifyBlocked: 'Réglez d’abord les lectures incertaines ([?], [illisible]).',
		/** A draft with no original to check it against (no source, or an invented one, and no photo): its badge and what it means. */
		noOriginal: 'Saisie sans fiche d’origine',
		noOriginalWhy: 'pas encore relue',
		/** The keeper's line under the red rule: the names not yet linked, to the list at the foot of the page. */
		upkeep: 'Suivi de l’archive',
		toLink: (n: number) => (n === 1 ? '1 ingrédient à relier' : `${n} ingrédients à relier`),
		/** In that list, after each name: its row in the resolve queue. */
		linkIt: 'Relier ›',
		/** Beside the status badge, for whoever keeps the archive: what it means. */
		statusWhy: {
			draft: 'pas encore relue contre la fiche',
			'needs-review': 'lectures incertaines à vérifier sur l’original'
		} as Record<string, string>,
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
		/** The recipe's one photo (`media.final`): the dish, or the card it came from. */
		photo: 'Photo de la recette',
		heic: 'Photo HEIC : aperçu indisponible dans le navigateur.',
		notFound: 'Cette recette n’existe pas ou a été supprimée.',
		tags: 'Étiquettes',
		servingsRange: (lo: string, hi: string) => `${lo}\u00a0à\u00a0${hi}`,
		/** What hovering a marker says ([?], [?: …], [illisible], [+]). */
		marker: {
			uncertain: 'Lecture incertaine',
			'uncertain-alt': 'Lecture incertaine, autre lecture possible :',
			illegible: 'Illisible sur l’original',
			added: 'Ajouté à la transcription, absent de l’original'
		},
		refused: {
			change: 'la modification ne passe pas la validation.',
			markers: 'des marqueurs [?] ou [illisible] restent à régler.',
			verify: (why: string) => `la vérification n’a pas pu être enregistrée ; rien n’a changé : ${why}`
		}
	},
	/** Dish photo upload (plan 04, Phase 6; Q12 A, Q13 A). */
	photo: {
		add: 'Ajouter une photo',
		addHelp: 'Une photo du plat, prise avec l’appareil ou choisie dans la galerie.',
		replace: 'Remplacer la photo',
		remove: 'Retirer la photo',
		sending: 'Envoi de la photo…',
		removed: 'Photo retirée. Le fichier reste dans le coffre.',
		tooBig: (mb: number) => `Cette photo dépasse ${mb} Mo. Choisissez-en une plus petite.`,
		failed: 'La photo n’a pas pu être ajoutée ; rien n’a changé.',
		offline: 'Pas de connexion : la photo n’a pas été envoyée.',
		refused: {
			none: 'aucune photo reçue.',
			empty: 'le fichier est vide.',
			tooBig: (mb: number) => `la photo dépasse ${mb} Mo.`,
			type: 'ce fichier n’est pas une photo (JPEG, PNG, WebP, AVIF ou HEIC).',
			unreadable: 'cette photo n’a pas pu être lue ; elle est peut-être abîmée.'
		}
	},
	/** The cost line on the recipe page (plan 03, Phase 5). */
	cost: {
		label: 'Coût estimé :',
		/** `≈ 4,20 $`: consumed cost, at the servings shown. */
		approx: (money: string) => `≈ ${money}`,
		perServing: (money: string) => `${money} par portion`,
		/** One denominator, the recipe's ingredient lines (optional ones aside): « 6 ingrédients sur 11 ont un prix », the disclosure's summary. */
		coverage: (priced: number, lines: number) => `${priced} ${priced > 1 ? 'ingrédients' : 'ingrédient'} sur ${lines} ${priced > 1 ? 'ont' : 'a'} un prix`,
		/** After the coverage, where the lines the page does not list come from: « (dont 5 dans Pâte brisée) ». */
		coverageFrom: (parts: { n: number; title: string }[]) => `(dont ${parts.map((p) => `${p.n} dans ${p.title}`).join(' et ')})`,
		/** Below the coverage threshold, for the archive's keeper only, one line that opens on the missing ones: « Coût : 7 prix manquants › ». */
		short: 'Coût :',
		missing: (n: number) => `${n} prix ${n > 1 ? 'manquants' : 'manquant'} ›`,
		stale: 'certains prix ont plus d’un an',
		/** The disclosure's two lists. */
		unpriced: (n: number) => `Sans prix (${n})`,
		priced: (n: number) => `Avec un prix (${n})`,
		unpricedHelp: 'Le total n’additionne que les lignes qui ont un prix. Pour juger s’il est assez complet, les essentiels (sel, beurre…) et les « au goût » ne comptent pas.',
		/** After the reason of a line that does not count toward « assez de prix ». */
		staple: 'essentiel, ne compte pas',
		toTaste: 'au goût, ne compte pas',
		reason: {
			unresolved: 'pas encore relié',
			'no-price': 'aucun prix',
			'no-qty': 'sans quantité',
			'no-conversion': 'unité non convertible',
			'no-recipe': 'recette absente',
			'no-scale': 'rendement inconnu',
			cycle: 'recette circulaire'
		} as Record<string, string>,
		via: (title: string) => `dans ${title}`,
		/** Beside a name not linked to the registry. */
		unlinked: 'pas encore relié',
		unlinkedTitle: 'Ce nom ne correspond à aucun ingrédient du registre : le relier',
		linkTitle: (name: string) => `Voir l’ingrédient ${name}`
	},
	kitchen: {
		back: 'Quitter',
		ingredients: 'Ingrédients',
		start: 'Commencer',
		step: (i: number, n: number) => `Étape ${i} sur ${n}`,
		stepShort: (i: number) => `Étape ${i}`,
		prev: 'Étape précédente',
		/** The phone's pager: under the arrow, the word alone. */
		prevShort: 'Précédente',
		next: 'Étape suivante',
		done: 'Bon appétit !',
		list: 'Ingrédients',
		timer: 'Minuteur',
		/** The timer strip: one chip per timer; on another step, a tap on its step goes back there. */
		timers: 'Minuteurs',
		timerGoTo: (i: number) => `Aller à l’étape ${i}, celle de ce minuteur`,
		/** Resumed after a reload or a return: one line near the bottom, gone by itself, with « Recommencer ». */
		resumedAt: (i: number | null, amount: string | null) => [i ? `Repris à l’étape ${i}` : 'Repris là où vous en étiez', amount].filter(Boolean).join(' · '),
		resumedServings: (n: string) => `${n} portions`,
		resumedBefore: (shown: string, before: string) => `${shown} (avant : ${before})`,
		restarted: 'Cuisine recommencée',
		/** The current step's own timer, large under the step. */
		stepTimer: (label: string) => `Minuteur de cette étape : ${label}`,
		timerUpTo: (s: string) => `jusqu’à ${s}`,
		stop: 'Arrêter',
		finished: 'Terminé',
		finishedAgo: (ago: string) => `Minuteur terminé ${ago}`,
		finishedAgoShort: (ago: string) => `Terminé ${ago}`,
		agoNow: 'à l’instant',
		agoMin: (m: number) => `il y a ${m} min`,
		agoHours: (h: number, m: number) => `il y a ${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`,
		relaunch: 'Relancer',
		clearTimer: 'Effacer',
		timerOfStep: (i: number) => `Minuteur · étape ${i}`,
		timersCount: (n: number) => `${n} minuteurs`,
		/** The screen toggle in the header (Wake Lock); when it cannot be kept on, a note once near the bottom, then a crossed-out sun in the header. */
		wakeKeep: 'Garder l’écran allumé',
		wakeOnTitle: 'Écran gardé allumé. Touchez pour le laisser s’éteindre.',
		wakePausedTitle: 'L’écran peut s’éteindre. Touchez pour le garder allumé.',
		wakeNote: 'L’écran peut s’éteindre : touchez-le parfois',
		wakeOff: 'L’écran peut s’éteindre',
		/** The crossed-out sun's name and tooltip: what a tap on it does. */
		wakeOffRetry: 'L’écran peut s’éteindre · Réactiver',
		wakeOffInsecure: 'L’écran peut s’éteindre — adresse non sécurisée',
		wakeOffWhy: 'Le navigateur ne garde l’écran allumé que sur une adresse sécurisée (https), comme celle que donne Tailscale. Sur une adresse en http, il s’éteint comme d’habitude.',
		wakeRefusedWhy: 'Le navigateur a refusé de garder l’écran allumé (mode économie d’énergie ?). Touchez « Réessayer » ou l’écran de temps en temps.',
		wakeRetry: 'Réessayer',
		wakeDismiss: 'Fermer',
		/** Always in the header: the screen kept on, or not, with the way to ask again (a tap is what some browsers wait for). */
		wakeOn: 'Écran allumé',
		/** From 64rem, the state in full. */
		wakeOnLong: 'Écran gardé allumé',
		/** Kept on before (an earlier visit, a moment ago) and not any more: the way back. */
		wakeReactivate: 'Réactiver',
		wakeMaySleep: 'L’écran peut s’éteindre',
		wakeKeepShort: 'Garder allumé',
		/** A range (« 35 à 40 minutes »): the chip runs to the upper bound and calls at the lower one. */
		timerRange: (lo: string, hi: string) => `${lo}–${hi}`,
		timerCheck: (lo: string) => `${lo} : vérifier la cuisson`,
		checkShort: 'Vérifier',
		/** « Recommencer » beside the step counter; with a timer on, one line asks first. */
		restartAsk: (n: number) => (n > 1 ? `${n} minuteurs en marche` : 'Un minuteur en marche'),
		restartYes: 'Recommencer quand même',
		restartNo: 'Annuler',
		/** The cook chip, on every page but kitchen mode: a cook in progress on this device. */
		chipTitle: (what: string) => `Retour en mode cuisine — ${what}`,
		chipCooking: 'En cuisine',
		chipMore: (n: number) => `+${n}`,
		chipMoreTitle: (n: number) => (n > 1 ? `${n} autres recettes en cuisine` : 'Une autre recette en cuisine'),
		chipHide: 'Masquer',
		/** « +1 »'s list: every recipe cooking on this device. */
		chipListLabel: 'Recettes en cuisine',
		/** A rung timer's ×: no longer called out on other pages (kitchen mode keeps it until stopped). */
		chipPutAway: (title: string) => `Masquer « Terminé » — ${title}`,
		chipEnd: 'Terminer',
		chipEndTitle: (title: string) => `Terminer la cuisson — ${title}`,
		/** In kitchen mode's timer strip, another recipe's timer: a tap opens that recipe's kitchen mode. */
		otherTimer: (title: string, step: number) => `${title}, étape ${step} : ouvrir son mode cuisine`,
		/** The ⋯ menu: the step text's size, remembered on the device. */
		textSize: 'Taille du texte',
		smaller: 'Texte plus petit',
		larger: 'Texte plus grand',
		dark: 'Mode sombre',
		more: 'Plus d’options',
		view: 'Ingrédients ou étapes',
		steps: 'Étapes',
		resume: (i: number) => `Reprendre à l’étape ${i}`,
		forStep: 'Pour cette étape',
		/** Over the step's chips when the step names something the list could not account for (« le reste », « les fines herbes »). */
		forStepMaybe: 'Mentionnés',
		allIngredients: 'Tous les ingrédients',
		/** A chip for a whole ingredient group the step names (« la garniture »). */
		wholeGroup: (group: string) => `${group} (tout)`,
		startTimer: (s: string) => `Démarrer un minuteur : ${s}`,
		backToRecipe: 'Retour à la recette',
		expand: 'Voir la recette',
		collapse: 'Masquer',
		noSteps: 'Cette recette n’a pas d’étapes numérotées.',
		offline: 'Hors ligne — recette gardée sur l’appareil.',
		restart: 'Recommencer',
		/** The last step's main button; then « Bon appétit » and back to the recipe. */
		finishCook: 'Terminé ✓',
		leaving: 'Retour à la recette dans un instant…',
		/** Over the previous and next steps' text, around the current one. */
		before: 'Avant :',
		after: 'Ensuite :',
		/** The timer strip. */
		pause: 'Pause',
		play: 'Reprendre',
		paused: 'En pause',
		addMinute: '+1 min',
		addMinuteTitle: 'Ajouter une minute',
		/** Under the step text, until she has started a timer once on this device. */
		timerTip: 'Touchez la durée pour lancer un minuteur',
		/** Wide screen: the checklist folded to a rail. */
		hideList: 'Replier les ingrédients',
		showList: (n: number) => `Ingrédients (${n})`,
		/** The photo (often the card itself) over the checklist, as a thumbnail; open, a tap zooms. */
		seePhoto: 'Voir la photo',
		photoZoom: 'Touchez pour agrandir',
		photoFit: 'Touchez pour voir en entier'
	},
	/** Plan 05: a recipe read at another amount. Nothing scaled is ever written (Q9 A). */
	scaling: {
		approxTitle: 'Arrondi à la mesure de cuisine la plus proche : la quantité exacte ne se mesure pas avec les tasses et les cuillères',
		times: (f: string) => `× ${f}`,
		yieldTimes: (f: string) => `(× ${f})`,
		tapHint: 'Touchez une quantité pour tout ajuster',
		tapHintClose: 'Masquer l’astuce',
		tapTitle: 'Ajuster la recette à cette quantité',
		have: (written: string) => `La recette demande ${written}. J’en ai :`,
		/** At another amount: what the line shows now, and the card's amount the factor is reckoned from. */
		haveScaled: (f: string, now: string, base: string) => `La recette × ${f} demande ${now} (base : ${base}). J’en ai :`,
		/** The stepper's count, tapped to type one. */
		countTitle: 'Taper un nombre de portions',
		countLabel: (n: string) => `${n} portions — taper un nombre`,
		/** « Recette × 2 · donne 4 tourtières · Remettre »: the yield at the factor, on the scale line. */
		yields: 'donne',
		/** The one note under the ingredients at another amount (usability round 6): what stays the card's, joined by « · » with the pan and `approxShort`. */
		kept: ({ steps, oven, pan }: { steps: boolean; oven: boolean; pan: boolean }) => {
			const w = [...(steps ? ['étapes'] : []), 'temps', ...(oven ? ['four'] : []), ...(pan ? ['moule'] : [])];
			const s = `${w.length > 1 ? `${w.slice(0, -1).join(', ')} et ` : ''}${w[w.length - 1]} inchangés`;
			return s.charAt(0).toUpperCase() + s.slice(1);
		},
		approxShort: '≈ arrondi',
		/** The head's servings when scaled: the stepper's count, then the card's own beside it (UI round 2). */
		servingsWas: (n: string) => `recette : ${n}`,
		apply: 'Ajuster',
		cancel: 'Annuler',
		other: 'Autre quantité',
		/** The same button on a phone, where the pill leaves room for one word. */
		otherShort: 'Autre…',
		factorLabel: 'Multiplier la recette par',
		/** « Pour [10] portions »: the count she wants, typed. */
		forLabel: 'Pour',
		unreadable: 'Écrivez un nombre : 3, 2,5 ou 1 1/2.',
		outOfRange: (min: string, max: string) => `Entre × ${min} et × ${max}.`,
		factorShown: (f: string) => `recette × ${f}`,
		/** Q6 B: the scaled value shown after an amount written in a step. */
		stepSystemTitle: 'Dans vos mesures ; la carte dit ce qui précède la flèche',
		stepAmountTitle: (f: string) => `Quantité pour la recette × ${f} ; la carte dit ce qui précède la flèche`,
		/** Q6, kitchen mode at another amount, one line: on step 1 and on a step with a time, a temperature or a pan. */
		stepNotice: (f: string) => `× ${f} · temps et four inchangés`,
		/** Plan 05, "The pan": pans whose bottom makes the scaled area. */
		pan: (f: string, options: string[], written: string) => `Moule : pour × ${f}, ${options.join(' ou ')} ; la fiche dit ${written} (même épaisseur, mêmes temps).`,
		panArea: (f: string) => `Moule : prévoir × ${f} la surface de celui de la recette (même épaisseur, mêmes temps).`,
		panCount: (count: number, word: string, size: string) => `${count} ${count > 1 && !/[sx]$/.test(word) ? `${word}s` : word} de ${size}`,
		/** The card's own pan, without a count: « plat de 9 x 13 ». */
		panWritten: (word: string, size: string) => `${word} de ${size}`,
		/** The same, short, in the note under the ingredients: « moule : 2 moules de 8 po ou 1 plat de 9 x 13 », « moule : × 1 ½ la surface ». */
		panShort: (options: string[]) => `moule : ${options.join(' ou ')}`,
		panAreaShort: (f: string) => `moule : × ${f} la surface`,
		/** Whole pies or cakes, one per pan (usability round 4), in that note: « prévoir 4 assiettes à tarte ». */
		panBakedShort: (approx: boolean, n: string, pans: string, size: string) => `prévoir ${approx ? '≈ ' : ''}${n} ${pans}${size ? ` de ${size}` : ''}`,
		panSize: (w: string, h: string, round: boolean, cm: boolean) => (round ? `${w} ${cm ? 'cm' : 'po'}` : `${w} x ${h}${cm ? ' cm' : ''}`),
		/** Q5 A: a sub-recipe read at a derived amount, in kitchen mode. */
		subScaled: (f: string) => `recette × ${f}`,
		/** Q5 A: a sub-recipe the line's amount cannot scale, shown as written. */
		subWhole: (yieldText: string | null) => (yieldText ? `Recette complète : donne ${yieldText}` : 'Recette complète')
	},
	add: {
		title: 'Ajouter des recettes',
		intro: 'Collez toute la réponse de l’IA, telle quelle.',
		paste: 'Réponse de l’IA',
		/** The box after a web page's import: what the page gave, not an AI's answer. */
		pasteWeb: 'Recette lue sur la page',
		placeholder: 'Collez ici la réponse complète de l’IA…',
		save: 'Enregistrer',
		saveHint: 'Ctrl+Entrée',
		tooMany: (n: number) => `Au plus ${n} recettes à la fois : enregistrez-en une partie, puis le reste.`,
		saving: 'Enregistrement…',
		copyPrompt: 'Copier les consignes pour l’IA',
		promptCopied: 'Consignes copiées',
		/** The copy just made (2 s), then "Copier à nouveau"; no clipboard here (plain http): the prompt shown, selected. */
		copied: 'Copié',
		copyAgain: 'Copier à nouveau',
		showPrompt: 'Voir les consignes',
		promptText: 'Les consignes à donner à l’IA',
		copyManual: 'Copie automatique impossible ici : Ctrl+C, ou appui long › Copier.',
		stepsLabel: 'Ajouter une fiche en trois étapes',
		/** The ways in, as the tabs of one card: a card in a photo (the AI, its answer pasted here), a web page; by hand beside them. */
		waysLabel: 'Comment ajouter la recette',
		tabCard: 'Une fiche en photo',
		tabWeb: 'Une page web',
		wayAiText: 'L’IA transcrit la fiche ; vous relisez ici avant d’enregistrer.',
		step1Help: 'Elles disent à l’IA comment écrire la fiche pour l’app.',
		/** Step 2's action: the AI opened in a new tab (a computer), or the prompt shared to its app (a phone). */
		openAi: 'Ouvrir Claude',
		openAiLabel: 'Ouvrir Claude dans un nouvel onglet ; les consignes sont copiées en même temps',
		step2Help: 'Collez-y les consignes, joignez la photo de la fiche.',
		sharePrompt: 'Partager les consignes…',
		sharePromptHelp: 'Vers l’app de l’IA (Claude, ChatGPT…) ; joignez-y la photo de la fiche.',
		step3: 'Coller sa réponse ici',
		/** A phone that can share a photo with an app (navigator.share): photo first, then both to the AI in one tap. */
		pickPhoto: 'Choisir la photo de la fiche',
		pickPhotoHelp: 'Prenez-la ou choisissez-la : elle reste sur ce téléphone.',
		changePhoto: 'Changer',
		sendToAi: 'Envoyer à l’IA',
		sendToAiHelp: 'La photo et les consignes partent ensemble vers l’app de l’IA que vous choisissez.',
		sendToAiOnlyPhoto: 'L’app n’a reçu que la photo ?',
		shareFailed: 'Envoi impossible : les consignes sont copiées. Ouvrez l’app de l’IA, collez-les et joignez la photo.',
		/** Steps 1–2 folded to one line on a phone, once the prompt is given. */
		sentLine: 'Photo et consignes envoyées',
		promptGivenBefore: 'Consignes déjà données',
		review: 'Revoir',
		/** "Coller": the clipboard into the box, for the way back from the AI's app. */
		pasteButton: 'Coller',
		clipboardRefused: 'Le presse-papiers n’est pas accessible ici : collez dans la boîte (appui long, puis Coller).',
		clipboardEmpty: 'Le presse-papiers est vide.',
		/** After a save: the card's photo on the recipe. */
		attachAsk: 'Garder la photo de la fiche avec la recette ?',
		attach: 'Joindre cette photo à la recette',
		attachTo: (title: string) => `Joindre à « ${title} »`,
		attachNo: 'Non merci',
		attachClose: 'Fermer',
		attachThumb: 'La photo de la fiche',
		attachedTo: 'Photo jointe à',
		photoAttached: 'Photo de la fiche jointe :',
		photosAttached: (n: number) => (n === 1 ? 'Photo de la fiche jointe.' : `${n} photos de fiche jointes.`),
		/** On a pasted file's card: a photo sent with it, right after its save. */
		cardPhoto: 'Joindre la photo de la fiche',
		cardPhotoHelp: 'Facultatif : elle sera gardée avec la recette.',
		cardPhotoSet: 'Photo jointe à l’enregistrement.',
		cardPhotoDrop: 'Retirer',
		/** The web page tab: its address, imported into the box. */
		wayWeb: 'Adresse de la page',
		webHelp: 'La plupart des sites de recettes donnent la recette toute prête : elle arrive ici, vous la relisez avant d’enregistrer.',
		wayHand: 'Taper à la main',
		or: 'ou',
		/** The steps once something is pasted, each ticked when done. */
		progress: ['Copier les consignes', 'Réponse collée', 'Vérifiée'] as readonly string[],
		/** Step 1 of the progress line, once the prompt was copied, shared or the AI opened. */
		progressPromptDone: 'Consignes copiées',
		/** A web page imported into the box: its own steps. */
		progressWeb: ['Page lue', 'Vérifiée'] as readonly string[],
		progressDone: 'fait',
		ingredientsN: (n: number) => (n <= 1 ? `${n} ingrédient` : `${n} ingrédients`),
		stepsN: (n: number) => (n <= 1 ? `${n} étape` : `${n} étapes`),
		/** No step read: the lines W401's fix would put under « Préparation ». */
		outsideSteps: (n: number) => (n === 1 ? '1 ligne hors Préparation' : `${n} lignes hors Préparation`),
		/** The box filled again from this tab after a reload; « Recommencer » empties it (the ways in come back), « Annuler » puts it back. */
		restored: 'Texte repris de votre dernière visite',
		restart: 'Recommencer',
		restarted: 'Zone vidée.',
		undo: 'Annuler',
		/** E002's next problems, listed with the errors: found in the realigned text. */
		recheck: 'à revérifier',
		/** The quick fixes made in this paste: one line, the last one undone from it. */
		fixesDone: (n: number) => (n === 1 ? '1 correction faite' : `${n} corrections faites`),
		undoLast: 'Annuler la dernière',
		/** W303 / W305 together: one row, the lines inside. */
		linkLater: (n: number) => `${n} ingrédients à relier plus tard`,
		editText: 'Modifier le texte',
		hideText: 'Replier le texte',
		remarks: (n: number) => (n === 1 ? '1 remarque' : `${n} remarques`),
		sameDish: 'Même plat, regrouper',
		groupWhat: 'Regrouper garde les deux fiches entières, réunies sous un même plat, chacune avec son nom de variante.',
		otherDish: 'Recette différente',
		otherDishSet: 'Recette différente : rien à regrouper.',
		change: 'Changer',
		readyMany: (n: number) => `${n} recettes prêtes`,
		toFirstError: 'Aller à la première erreur',
		quickFix: (value: string) => `Remplacer « ${value} » par`,
		quickFixApply: 'Remplacer',
		quickFixChoose: 'Choisir…',
		quickFixed: (from: string, to: string) => `« ${from} » remplacé par « ${to} » dans le texte.`,
		quickFixedAll: (from: string, to: string, n: number) => `« ${from} » remplacé par « ${to} » ${n} fois dans le texte.`,
		/** A unit's code written in the text: what was written, what the app shows. */
		unitWritten: (code: string, word: string, n: number) =>
			`Unité écrite : ${code}${n > 1 ? `, ${n} fois` : ''}${word !== code ? ` (s’affiche « ${word} »)` : ''}.`,
		/** Fixes the box makes itself (docs/VALIDATION.md, "Quick fixes in the paste box"). */
		realign: (line: number) => `Réaligner la ligne ${line}`,
		realigned: (line: number) => `Ligne ${line} réalignée sur ses voisines.`,
		titleLabel: 'Titre :',
		titleAdd: 'Ajouter',
		titleAdded: (title: string) => `Titre ajouté : « ${title} ».`,
		titleRefused: 'Ce titre ne peut pas être écrit ici : écrivez la ligne « title: » dans le texte.',
		schemaAdd: 'Ajouter la version',
		schemaAdded: 'Version du format ajoutée en haut de la fiche.',
		split: (qty: string, word: string) => `Séparer en ${qty} + ${word}`,
		/** E210: the amount written in the name, taken out of it (« Séparer en 500 ml + lait »). */
		nameSplit: (amount: string, name: string) => `Séparer en ${amount} + ${name}`,
		/** W302: the preparation word moved out of the name. */
		prepSplit: (name: string, prep: string) => `Séparer en ${name} + ${prep}`,
		prepDone: (prep: string) => `« ${prep} » rangé dans la préparation.`,
		/** One file that passes with no steps read (W401 and its orphan lines above the save). */
		saveNoSteps: 'Enregistrer sans étapes',
		splitDone: (qty: string, code: string, word: string) => `Quantité ${qty}, unité écrite : ${code}${word !== code ? ` (s’affiche « ${word} »)` : ''}.`,
		methodFix: (n: number) => (n === 1 ? 'Ranger cette ligne dans Préparation' : `Ranger ces ${n} lignes dans Préparation`),
		methodDone: (n: number) => (n === 1 ? 'Titre « Préparation » ajouté : 1 étape.' : `Titre « Préparation » ajouté : ${n} étapes.`),
		/** W401 / W403: lines that look like steps, written another way (« Étape 1 : », « 1 - », indented). */
		stepsFix: (n: number) => (n === 1 ? 'En faire une étape' : `En faire ${n} étapes`),
		stepsDone: (n: number) => (n === 1 ? 'Ligne écrite en étape : 1 étape.' : `Lignes écrites en étapes : ${n} étapes.`),
		/** E207: an ingredient line left whole, read as « Coller une liste » reads it. */
		entryRead: (text: string) => `Lire comme : ${text}`,
		entryReadAll: (n: number) => `Lire les ${n} lignes`,
		entryDone: (text: string) => `Ligne découpée : ${text}.`,
		entryDoneAll: (n: number) => `${n} lignes découpées.`,
		toTaste: 'au goût',
		/** An imported page in English: flagged, and the AI asked to translate it. */
		englishPage: 'Page en anglais',
		translateAsk: 'Faire traduire par l’IA',
		translateCopied: 'Consignes et recette copiées : collez-les dans la conversation avec l’IA, puis collez sa réponse ici (elle remplacera la page importée).',
		translateFailed: 'Copie impossible ici : le presse-papiers n’est pas accessible.',
		translateCopy: 'Copier pour traduire',
		translateHelp: 'Un geste copie les consignes, la demande de traduction et la recette : collez-les dans la conversation avec l’IA, puis sa réponse ici.',
		translateNext: 'Copié : collez-le dans la conversation avec l’IA, puis collez sa réponse ici ; elle remplacera la page importée.',
		/** A unit the alias table knows: one tap writes its code. */
		quickFixWrite: (unit: string) => `Écrire ${unit}`,
		/** E109: the time in the format, one tap; E106: one button per source type, its code and its name. */
		durationWrite: (value: string) => `Écrire ${value}`,
		durationDone: (value: string) => `Temps écrit : ${value}.`,
		sourceTypeWrite: (code: string, label: string) => (code === label ? `Écrire ${code}` : `Écrire ${code} (${label})`),
		sourceTypeDone: (code: string) => `Type de provenance écrit : ${code}.`,
		sourceTypePick: 'Type de provenance',
		/** Under a file's problems: their codes and places, for whoever repairs the file or the app. */
		troubleDetails: 'Détails pour le dépannage',
		quickFixWriteAll: (unit: string, n: number) => `Écrire ${unit} partout (${n})`,
		quickFixAll: (n: number) => `Remplacer partout (${n})`,
		quickFixHere: 'Seulement ici',
		otherUnit: 'Autre unité…',
		/** A new tag the recipe's text writes with its accents. */
		accentFix: (tag: string) => `Écrire « ${tag} » dans la fiche`,
		useTag: (tag: string) => `Utiliser « ${tag} »`,
		/** The new tag kept as written: it will be added, marked for review. */
		keepTag: (tag: string) => `Garder « ${tag} »`,
		found: (n: number): string => (n === 1 ? 'recette trouvée' : 'recettes trouvées'),
		saveOne: (title: string) => `Enregistrer « ${title} »`,
		saveMany: (n: number) => `Enregistrer les ${n} recettes`,
		/** The same-dish question asked: the save says what it does — not answered, "Recette différente", "Même plat". */
		saveApart: 'Enregistrer sans regrouper',
		/** E103 settled by the choice above it: said in the choice, no longer an error. */
		collisionSettled: (slug: string) => `Réglé : elle sera enregistrée comme ${slug}.`,
		collisionReplacing: 'Réglé : elle remplacera la recette existante.',
		saveNew: 'Enregistrer comme nouvelle recette',
		saveGrouped: 'Enregistrer et regrouper',
		saveInFamily: (name: string) => `Enregistrer dans « ${name} »`,
		needVariant: 'Nommez la variante pour regrouper',
		blocked: (n: number) => (n === 1 ? 'Corrigez 1 erreur pour enregistrer' : `Corrigez ${n} erreurs pour enregistrer`),
		heldBack: (n: number) => (n === 1 ? '1 recette avec des erreurs reste ici' : `${n} recettes avec des erreurs restent ici`),
		valid: 'Valide',
		invalid: 'À corriger',
		errors: 'Erreurs',
		warnings: 'Avertissements',
		infos: 'Notes',
		fixBlock: 'Copier la demande de correction',
		fixCopied: 'Demande copiée. Collez-la dans la conversation avec l’IA.',
		fixBlockHelp: 'L’IA renvoie la fiche corrigée ; collez-la ici.',
		preview: 'Aperçu',
		previewPartial: 'Aperçu partiel',
		previewPartialNote: 'Ce qui a pu être lu, en attendant la correction : une ligne non découpée y est telle qu’écrite ; une ligne sans nom n’y est pas.',
		previewPartialNone: 'Aperçu impossible tant que l’erreur n’est pas corrigée.',
		edit: 'Relire et modifier',
		editHelp: 'Ouvre la recette dans un formulaire, une case par champ, sans toucher au texte.',
		saved: (n: number) => (n === 1 ? 'Recette enregistrée :' : `${n} recettes enregistrées :`),
		/** After a save: the card at the top, the way to the recipe and to the next one. */
		seeRecipe: 'Voir la recette',
		addAnother: 'Ajouter une autre fiche',
		collision: (slug: string) => `Une recette « ${slug} » existe déjà.`,
		collisionTrash: (slug: string) => `« ${slug} » est dans la corbeille ; ce nom ne sera pas réutilisé.`,
		replace: 'Remplacer la fiche existante (l’ancienne reste dans l’historique)',
		saveAs: (slug: string) => `Enregistrer comme ${slug}`,
		sameTitle: 'Même titre qu’une recette existante : deux variantes du même plat ?',
		close: 'Presque les mêmes ingrédients que',
		closeFamily: 'Une autre variante du même plat ?',
		/** Only a title that starts the same (as the form's « Ressemble à »). */
		likeFamily: 'Titre semblable : une autre variante du même plat ?',
		/** The vault recipes she may group this one with: where each is from, why it is asked. */
		fromUnknown: 'provenance non indiquée',
		whyAsked: { title: 'même titre', close: 'presque les mêmes ingrédients', like: 'titre semblable' } as Record<string, string>,
		inGroup: (name: string) => `groupe « ${name} »`,
		/** Several recipes offered, none picked yet: the group button waits. */
		pickTargetFirst: 'Regrouper avec… (choisissez la recette ci-dessus)',
		see: 'Voir',
		openTarget: (title: string) => `Voir « ${title} » (nouvel onglet)`,
		groupWith: (title: string, from: string) => `Regrouper avec ${title}${from ? ` — ${from}` : ''}`,
		variantPlaceholder: 'p. ex. de Tante Aline, sans sucre',
		family: 'Groupe de variantes',
		variant: 'Variante',
		makeFamily: 'Regrouper en variantes',
		pairVariant: (title: string) => `Ce qui distingue « ${title} »`,
		pairNote: (title: string) => `« ${title} » est regroupée avec celle-ci, dans le même enregistrement.`,
		pairRefused: (reason: string, title: string) =>
			reason === 'variant'
				? `Donnez deux noms de variante différents : celui-ci et celui de « ${title} ».`
				: reason === 'busy'
					? `« ${title} » est déjà modifiée par un autre fichier de ce collage : enregistrez-les l’un après l’autre.`
					: `« ${title} » a changé ou ne peut pas être modifiée : rien n’a été enregistré pour ce fichier. Vérifiez puis réessayez.`,
		batchFile: (n: number) => `le fichier n° ${n} de ce collage`,
		batchCloseHint: 'Deux fois la même fiche ? N’en gardez qu’une.',
		stale: 'La recette à remplacer a changé entre-temps. Vérifiez puis réessayez.',
		notSaved: (n: number) =>
			n === 1 ? '1 recette n’a pas été enregistrée : voyez ce qui la retient ci-dessous.' : `${n} recettes n’ont pas été enregistrées : voyez ce qui les retient ci-dessous.`,
		outside: 'Texte hors des blocs (ignoré — l’IA a peut-être posé une question) :',
		indexError: 'Enregistré, mais l’index n’a pas suivi ; il sera reconstruit au prochain démarrage.',
		error: 'L’enregistrement a échoué :',
		importPlaceholder: 'https://…',
		import: 'Importer',
		importing: 'Lecture de la page…',
		/** A failed import: the ways that still work, under the message. */
		importViaAi: 'Passer par l’IA (capture ou texte de la page)',
		importOffline: 'Pas de connexion à l’application : réessayez quand le réseau revient.',
		importViaAiHelp: 'Faites une capture de la page (ou copiez son texte), donnez-la à l’IA avec les consignes, puis collez sa réponse ici.',
		/** Under a failed import's message: the likely cause, one line, by kind (usability round 5). */
		importWhy: {
			refused: 'Cause probable : le site bloque les lecteurs automatiques (une protection contre les robots).',
			noRecipe: 'Cause probable : la page ne déclare pas sa recette dans son code (pas de données de recette).'
		},
		/** « Passer par l’IA » after a failed import: the three steps for the page (a capture or its text), on the web tab, its address kept. */
		wayAiPage: 'L’IA lit la page d’après une capture ou son texte ; vous relisez ici avant d’enregistrer.',
		pageAddress: 'Page :',
		backToAddress: 'Réessayer l’adresse',
		step2HelpPage: 'Collez-y les consignes (elles donnent l’adresse de la page), joignez une capture de la page ou collez son texte.',
		sharePromptHelpPage: 'Vers l’app de l’IA (Claude, ChatGPT…) ; joignez une capture de la page ou collez son texte.',
		pickPhotoPage: 'Choisir la capture de la page',
		imported: 'Recette importée dans la zone ci-dessous : relisez-la, puis enregistrez.',
		recipeN: (i: number) => `Recette ${i}`,
		importRefused: {
			url: 'Cette adresse ne se lit pas : copiez-la depuis la barre d’adresse du navigateur.',
			scheme: 'Seules les adresses http et https sont acceptées.',
			credentials: 'Une adresse avec identifiant et mot de passe est refusée.',
			private: 'Une adresse locale ou privée est refusée.',
			redirects: 'La page renvoie vers trop d’autres pages.',
			timeout: 'Le site n’a pas répondu dans le délai de 10 s.',
			refused: 'Ce site refuse la lecture automatique.',
			gone: 'Cette page est introuvable : vérifiez l’adresse.',
			status: (status: number) => `Le site n’a pas donné la page (erreur ${status}).`,
			notHtml: 'Cette adresse n’est pas une page web.',
			tooBig: 'Cette page est trop volumineuse (plus de 5 Mo).',
			read: (why: string) => `La page n’a pas pu être lue (${why}).`,
			connect: (why: string) => `Le site ne répond pas (${why}).`,
			noHost: 'Ce site est introuvable : vérifiez l’adresse.',
			noRecipe: 'Cette page ne contient pas de recette lisible.'
		}
	},
	diagnostics: {
		technical: 'Détails pour le dépannage',
		/** A problem in the paste box: select its place in the pasted text. */
		show: 'Montrer dans le texte',
		/** Under the problems of a file already in the vault (no fix-request block there). */
		vaultHint:
			'Corrigez le fichier dans le coffre (éditeur de texte ou Obsidian), ou faites-le corriger par l’IA et collez le résultat dans Ajouter en choisissant « Remplacer ». La page suit d’elle-même.'
	},
	/** Sign-in and the nav's account entries (plan 04, Phase 1). */
	auth: {
		required: 'Connexion requise.',
		title: 'Connexion',
		intro: 'Tout le monde peut lire les recettes. Pour en ajouter, en modifier ou en supprimer, connectez-vous : chaque changement est noté à votre nom.',
		login: 'Identifiant',
		password: 'Mot de passe',
		stay: 'Garder la session ouverte sur cet appareil',
		submit: 'Se connecter',
		signIn: 'Se connecter',
		signOut: 'Se déconnecter',
		bad: 'Identifiant ou mot de passe incorrect.',
		wait: (s: number) => `Trop d’essais manqués. Attendez ${s} secondes avant de réessayer.`,
		signedIn: (name: string) => `Session ouverte : ${name}.`,
		signedInAs: 'Session de',
		noAccount: 'Pas de compte ? Demandez-en un à la personne qui tient la boîte.'
	},
	/** /compte: what one account chooses for itself (lib/prefs.ts). */
	account: {
		title: 'Mon compte',
		linkTitle: 'Mon compte : langue et mesures',
		intro: 'Ces choix sont les vôtres : ils vous suivent sur tous vos appareils. Ils ne changent rien pour les autres, ni aux recettes.',
		lang: 'Langue',
		langHelp: 'La langue des menus, des boutons et des messages. Les recettes restent dans la langue où elles sont écrites.',
		langs: { fr: 'Français', en: 'English' } as Record<string, string>,
		system: 'Mesures',
		systemHelp: 'Comment les quantités s’affichent. La recette garde toujours ce qui est écrit sur la carte.',
		systems: { written: 'Comme sur la recette', metric: 'Métrique', imperial: 'Tasses et cuillères' } as Record<string, string>,
		systemHints: {
			written: 'Rien n’est converti.',
			metric: 'Millilitres et grammes : 1 tasse devient 250 ml, 1 lb devient 454 g.',
			imperial: 'Tasses, cuillères, livres et onces : 250 ml devient 1 tasse.'
		} as Record<string, string>,
		systemNote: 'Ce qui se compte (une gousse, une branche, une boîte) ne se convertit pas. Quand le poids de l’ingrédient est connu, il s’affiche à côté : 2 branches (≈ 80 g).',
		words: 'Vos mots pour les unités',
		wordsHelp: 'Un mot ne vous dit rien ? Écrivez le vôtre : il remplace le mot habituel, pour vous seulement. Laissez vide pour garder le mot habituel.',
		unit: 'Mot habituel',
		one: 'Votre mot',
		many: 'Au pluriel',
		oneFor: (word: string) => `Votre mot pour « ${word} »`,
		manyFor: (word: string) => `Votre mot au pluriel pour « ${word} »`,
		save: 'Enregistrer',
		saved: 'C’est enregistré.',
		failed: 'Les choix n’ont pas pu être enregistrés. Réessayez.'
	},
	/** Undo and the per-recipe history (plan 04, Phase 7; Q16 A). */
	history: {
		link: 'Historique',
		title: 'Historique',
		intro: 'Chaque enregistrement garde la version d’avant. Revenir à une version en ajoute une nouvelle : rien n’est jamais effacé.',
		back: 'Retour à la recette',
		by: 'par',
		current: 'Version actuelle',
		restore: 'Revenir à cette version',
		restoreWill: 'Ce retour changera :',
		restoreNothing: 'Le contenu est le même que la version actuelle.',
		/** Under a version's summary, what changed word by word (usability round 4). */
		detailIngredient: 'Ingrédient',
		detailStep: (n: number) => `Étape ${n}`,
		detailStepGone: 'Étape retirée',
		detailWas: 'avant :',
		detailNow: 'maintenant :',
		restoreConfirm: 'Oui, revenir à cette version',
		restored: 'La recette est revenue à cette version.',
		undo: 'Annuler',
		undoRestore: 'Annuler ce retour',
		redo: 'Rétablir',
		undone: 'Modification annulée.',
		trashedByUndo: 'La recette ajoutée a été mise à la corbeille. Elle peut être restaurée depuis la corbeille.',
		untrashedByUndo: 'La recette est sortie de la corbeille.',
		inTrash: 'Cette recette est dans la corbeille. Restaurez-la depuis la corbeille pour pouvoir revenir à une de ses versions.',
		invalidVersion: 'Cette version ne passe plus la validation d’aujourd’hui : l’application ne peut pas la remettre telle quelle. Le propriétaire peut la reprendre à la main.',
		otherSlug: 'Cette version porte un autre nom de fichier : elle ne peut pas être remise ici.',
		empty: 'Aucune version enregistrée pour cette recette.',
		errors: {
			unknown: 'Cette modification est introuvable dans l’historique de la recette.',
			stale: 'La recette a été modifiée entre-temps ; rien n’a été changé. Rechargez la page.',
			invalid: 'L’ancienne version ne passe plus la validation d’aujourd’hui ; rien n’a été changé. Le propriétaire peut la reprendre à la main.',
			unsupported: 'Cette modification ne peut pas être annulée d’ici.',
			gone: 'Cette recette n’est plus là (elle est peut-être dans la corbeille).',
			failed: 'Le changement n’a pas pu être enregistré ; rien n’a changé.'
		} as Record<string, string>,
		change: {
			created: 'Recette ajoutée',
			trashed: 'Mise à la corbeille',
			untrashed: 'Sortie de la corbeille',
			renamed: (from: string) => `Fichier renommé (avant : ${from})`,
			deleted: 'Fichier retiré du coffre',
			unreadable: 'Version que l’application ne sait plus lire',
			format: 'Mise en forme du fichier seulement, rien de visible',
			title: (from: string, to: string) => `Titre : « ${from} » devient « ${to} »`,
			fields: (names: string[]) => `Modifié : ${names.join(', ')}`,
			field: {
				family: 'groupe de variantes',
				variant: 'variante',
				source: 'provenance',
				times: 'temps',
				oven: 'four',
				servings: 'portions',
				yield: 'rendement',
				season: 'saisons',
				difficulty: 'difficulté',
				rating: 'appréciation',
				lang: 'langue',
				groups: 'groupes d’ingrédients',
				notes: 'notes',
				variants: 'variantes',
				alternatives: 'substitutions',
				text: 'autre texte'
			} as Record<string, string>,
			tagsAdded: (s: string) => `Étiquettes ajoutées : ${s}`,
			tagsRemoved: (s: string) => `Étiquettes retirées : ${s}`,
			ingredientsAdded: (n: number, s: string) => `${n > 1 ? 'Ingrédients ajoutés' : 'Ingrédient ajouté'} : ${s}`,
			ingredientsRemoved: (n: number, s: string) => `${n > 1 ? 'Ingrédients retirés' : 'Ingrédient retiré'} : ${s}`,
			ingredientsChanged: (n: number, s: string) => `${n > 1 ? 'Ingrédients modifiés' : 'Ingrédient modifié'} : ${s}`,
			stepsAdded: (n: number) => (n > 1 ? `${n} étapes ajoutées` : 'Une étape ajoutée'),
			stepsRemoved: (n: number) => (n > 1 ? `${n} étapes retirées` : 'Une étape retirée'),
			stepsChanged: (n: number) => (n > 1 ? `${n} étapes modifiées` : 'Une étape modifiée'),
			stepsReordered: 'Étapes remises dans un autre ordre',
			photo: { added: 'Photo ajoutée', changed: 'Photo changée', removed: 'Photo retirée' } as Record<string, string>,
			verified: 'Marquée vérifiée',
			unverified: 'N’est plus marquée vérifiée',
			markersConfirmed: (n: number) => (n > 1 ? `${n} lectures incertaines réglées` : 'Une lecture incertaine réglée'),
			markersAdded: (n: number) => (n > 1 ? `${n} lectures incertaines ajoutées` : 'Une lecture incertaine ajoutée'),
			/** Names in a line, and what sits between two changes of one line. */
			list: (names: string[]) => names.map((x) => `« ${x} »`).join(', '),
			join: ' ; '
		}
	},
	trash: {
		title: 'Corbeille',
		intro: 'Les recettes supprimées restent ici, avec leurs photos, jusqu’à ce qu’on les restaure.',
		empty: 'La corbeille est vide.',
		deleted: 'supprimée le',
		restore: 'Restaurer',
		taken: 'Nom repris par une autre recette',
		restored: 'Recette restaurée.',
		refused: {
			exists: (path: string) => `${path} existe déjà`,
			remove: (why: string) => `la suppression n’a pas pu être enregistrée (git) ; rien n’a changé : ${why}`,
			notHere: (slug: string) => `${slug} n’est pas dans la corbeille`,
			taken: (slug: string) => `le nom ${slug} est déjà repris par une autre recette`,
			restore: (why: string) => `la restauration n’a pas pu être enregistrée (git) ; rien n’a changé : ${why}`
		}
	},
	error: {
		notFound: 'Page introuvable.',
		generic: 'Une erreur est survenue.',
		home: 'Retour aux recettes',
		/** Refusals several pages share, shown in the page's message line. */
		recipeGone: 'cette recette n’existe plus.',
		fileChanged: 'le fichier a changé depuis l’ouverture de la page ; rechargez-la.',
		fileInvalid: 'le fichier ne passe pas la validation.',
		yaml: (file: string) => `${file} ne se lit pas (YAML) ; corrigez-le d’abord.`,
		unreadable: (file: string, why: string) => `${file} ne se lit pas ; corrigez-le d’abord (${why}).`,
		write: (why: string) => `le fichier n’a pas pu être écrit ; rien n’a changé : ${why}`,
		labelTooLong: (max: number) => `le nom est trop long (${max} caractères au plus).`,
		category: 'choisissez une catégorie.',
		unit: (units: string) => `unité inconnue : ${units}.`,
		noIngredient: (slug: string) => `l’ingrédient ${slug} n’existe pas.`,
		nameTaken: (name: string, slug: string) => `« ${name} » est déjà un nom de ${slug}.`
	},
	/** The recipe form (plan 04, Phases 4–5): `/nouvelle`, `/r/<slug>/modifier`. */
	form: {
		newTitle: 'Nouvelle recette',
		editTitle: 'Modifier la recette',
		nav: 'Nouvelle recette',
		edit: 'Modifier',
		required: 'obligatoire',
		cancel: 'Quitter sans enregistrer',
		cancelShort: 'Quitter',
		/** A pasted recipe opened from the paste box ("Relire et modifier"). */
		pasteTitle: 'Relire la recette',
		pasteLead: 'Tout est rempli d’après le texte collé. Corrigez ce qu’il faut, case par case, puis touchez « Enregistrer ».',
		backToPaste: 'Revenir aux recettes collées',
		save: 'Enregistrer',
		saving: 'Enregistrement…',
		toComplete: 'Pour enregistrer :',
		/** Why Save is disabled, one line per field. */
		blocks: {
			title: 'donnez un titre',
			ingredients: 'ajoutez au moins un ingrédient',
			name: 'nommez chaque ingrédient qui a une quantité',
			unit: 'choisissez l’unité de chaque quantité',
			qty: 'donnez la quantité de chaque unité choisie',
			format: 'corrigez une quantité ou un nombre',
			range: 'un maximum doit dépasser le minimum',
			duplicate: 'un ingrédient est en double dans un groupe',
			variant: 'dites ce qui distingue cette variante',
			family: 'choisissez le groupe de cette variante',
			oven: 'choisissez °F ou °C pour le four',
			url: 'l’adresse web doit commencer par https://',
			items: 'un groupe nommé n’a pas d’ingrédient',
			integer: 'les portions s’écrivent en nombre entier',
			nameQuantity: 'une quantité est écrite dans un nom',
			nameComma: 'un nom d’ingrédient contient une virgule',
			noteQuantity: 'une quantité est écrite dans une note',
			marker: 'un texte contient des crochets réservés aux lectures incertaines',
			method: 'gardez au moins une étape de préparation',
			other: 'corrigez les champs signalés',
			time: 'corrigez un temps (1 h 30, 90 min, 20 à 25 min)'
		} as Record<string, string>,
		/** Next to a field. */
		field: {
			unit: 'Choisissez l’unité.',
			qty: 'Il manque la quantité.',
			format: 'Écrivez un nombre ou une fraction : 2, 1 ½, 0,5.',
			fraction: 'La fraction doit être plus petite que 1 : 1 ½, pas 1 3/2.',
			zero: 'La quantité doit être plus grande que zéro.',
			range: 'Le maximum doit dépasser le minimum.',
			duplicate: 'Cet ingrédient est déjà dans ce groupe : gardez-en un seul.',
			required: 'Il manque le nom de l’ingrédient.',
			variant: 'Obligatoire pour une variante : ce qui la distingue.',
			url: 'L’adresse doit commencer par https://',
			incomplete: 'Donnez la quantité et l’unité.',
			items: 'Ce groupe n’a pas encore d’ingrédient.',
			integer: 'Les portions s’écrivent en nombre entier.',
			nameQuantity: 'La quantité va dans Quantité et Unité, pas dans le nom.',
			nameComma: 'Un ingrédient par ligne ; une précision va en note ou en préparation.',
			noteQuantity: 'La quantité va dans Quantité et Unité (ou dans « ou remplacer par »), pas dans la note.',
			method: 'Gardez au moins une étape de préparation.'
		} as Record<string, string>,
		/** Next to a required field of the recipe itself, once Save was tried (round 3). */
		fieldRequired: { title: 'Il manque le titre.', ingredients: 'Ajoutez au moins un ingrédient : sa quantité, son unité, son nom.' } as Record<string, string>,
		/** Next to a field holding text the file would read as a marker (E217, Q15 A). */
		fieldMarker: (value: string) =>
			`« ${value} » est réservé aux lectures incertaines d’une transcription : écrivez-le autrement (des parenthèses au lieu des crochets).`,
		/** Save refused with fields named. */
		invalid: 'Rien n’est enregistré : corrigez les champs signalés.',
		/** Save refused by the server's check (an error the browser's missed): what is wrong, named. */
		invalidNamed: (problems: string[]) => `Rien n’est enregistré. ${problems.join(' ')}`,

		title: 'Titre',
		titlePlaceholder: 'ex. Tarte au sucre',
		lang: 'Langue de la recette',
		langs: { fr: 'Français', en: 'Anglais' } as Record<string, string>,

		ingredients: 'Ingrédients',
		group: 'Groupe',
		groupName: 'Nom du groupe',
		groupPlaceholder: 'ex. Garniture',
		groupPlaceholderFirst: 'ex. Pâte',
		groupOptional: 'Groupe facultatif',
		addGroup: 'Ajouter un groupe',
		removeGroup: 'Retirer le groupe',
		addItem: 'Ajouter un ingrédient',
		qty: 'Quantité',
		unit: 'Unité',
		noUnit: 'sans unité',
		/** The unit picker in two parts (usability round 4): the vault's most used, then the rest. */
		unitsCommon: 'Les plus utilisées',
		unitsOther: 'Autres unités',
		/** The quantity box's hint: a column name, never a value. */
		qtyPlaceholder: 'qté',
		/** The column heads above the ingredient rows on a wide screen. */
		cols: { qty: 'Qté', unit: 'Unité', name: 'Ingrédient' },
		/** A phone: a filled ingredient as one line; touched, it opens. */
		editItem: 'Modifier',
		/** The label of `piece`: counted things (3 œufs). */
		piece: 'à l’unité',
		name: 'Ingrédient',
		/** The first row's name box: the one example of the list. */
		namePlaceholder: 'ex. farine',
		/** The other rows' name box: the column's word, never a value. */
		nameHint: 'ingrédient',
		/** Under a row with no detail yet: a precision typed in place (préparation, autre mesure, au goût…). */
		precisionAdd: 'précision',
		precisionTitle: 'Ajouter une précision : préparation, autre mesure, au goût…',
		/** The row's grey line, touched: its details open in place. */
		detailsEdit: 'Modifier les précisions',
		linked: 'relié',
		linkedTitle: 'Ce nom correspond à un ingrédient connu.',
		details: 'Détails',
		hideDetails: 'Moins',
		prep: 'Préparation',
		prepPlaceholder: 'ex. haché, tamisée',
		note: 'Note',
		brand: 'Marque',
		toTaste: 'Au goût',
		optional: 'Facultatif',
		upTo: 'Jusqu’à',
		upToHelp: 'Pour une quantité « de 2 à 3 ».',
		alt: 'Ou en mesure',
		altHelp: 'La même quantité dans une autre mesure (375 ml pour 1 ½ tasse).',
		altAdd: 'Ajouter une autre mesure',
		altRemove: 'Retirer l’autre mesure',
		or: 'Ou remplacer par',
		orAdd: 'Ajouter un remplacement',
		subRecipe: 'C’est une autre recette',
		subRecipePick: 'Chercher une recette',
		subRecipeRemove: 'Ce n’est plus une autre recette',
		buyInstead: 'On peut l’acheter tout fait',
		moveUp: 'Monter',
		moveDown: 'Descendre',
		remove: 'Retirer',
		removedItem: 'Ingrédient retiré.',
		removedStep: 'Étape retirée.',
		removedGroup: 'Groupe retiré.',
		undo: 'Annuler',
		fractions: 'Fractions',

		method: 'Préparation',
		step: (n: number) => `Étape ${n}`,
		heading: 'Titre de section',
		headingPlaceholder: 'ex. Glaçage',
		text: 'Texte',
		addStep: 'Ajouter une étape',
		addHeading: 'Ajouter un titre de section',
		stepHelp: 'Une étape par case. Les temps écrits (« 20 min ») deviennent des minuteurs en cuisine.',
		/** One line beside the step help, keyboards only (round 2 of the usability pass). */
		keysHelp: 'Entrée : ingrédient ou étape suivante · Maj+Entrée : retour à la ligne · Ctrl+Entrée : enregistrer',
		/** An unlinked name one letter off a registry name: « Vouliez-vous dire « oignon » ? [Oui] ». */
		nameNearYes: 'Oui',
		nameNearYesTitle: (s: string) => `Écrire « ${s} »`,
		qtySlip: (typed: string, reads: string, meant: string) => `${typed} = ${reads} — vouliez-vous ${meant} ?`,
		qtySlipYes: (meant: string) => `Oui, ${meant}`,
		/** A whole line typed in the name (« 1 pincée de sel »): one tap puts the amount in its boxes (round 3). */
		splitName: (parts: string) => `Séparer : ${parts}`,
		splitNameTitle: 'Mettre la quantité et l’unité dans leurs cases, le reste dans le nom',

		notes: 'Notes',
		variants: 'Variantes',
		alternatives: 'Remplacements',
		notesHelp: 'Ce qu’on veut se rappeler : d’où vient la recette, un truc, un souvenir.',
		notesNone: 'Aucune note',
		notesAdd: 'Ajouter',

		/** The recipe's one photo (`media.final`): in this archive often the card itself, so named for both. */
		photo: 'Photo (plat ou fiche)',
		photoHelp: 'Le plat, ou la fiche elle-même : prise avec l’appareil ou choisie dans la galerie.',
		photoPending: (name: string) => `Photo choisie : ${name}. Elle sera envoyée à l’enregistrement.`,
		photoNotInDraft: 'Le brouillon garde tout sauf la photo : choisissez-la de nouveau si vous rechargez la page.',
		photoCancel: 'Ne pas envoyer cette photo',
		photoRemoved: 'La photo sera retirée à l’enregistrement (le fichier reste dans le coffre).',
		photoKeep: 'Garder la photo',
		/** A wide screen, a recipe with a photo: the card beside the form while she types from it. */
		scanShow: 'Afficher la fiche à côté',
		scanHide: 'Masquer la fiche',
		scanAlt: 'La photo de la recette',
		scanZoom: 'Agrandir la fiche',
		scanUnzoom: 'Ajuster la fiche à la largeur',
		photoFailed: (msg: string) => `La recette est enregistrée, mais pas la photo : ${msg}`,

		family: 'Variante de',
		familyHelp: 'Regroupe les variantes d’un même plat (lasagnes bolognaise, végé…). Laissez vide si la recette n’a pas de variante.',
		familySearch: 'Chercher un groupe de variantes',
		familyCount: (n: number) => (n === 0 ? 'aucune recette' : n === 1 ? '1 recette' : `${n} recettes`),
		familyNew: (name: string) => `Nouveau groupe « ${name} »`,
		familyNewHelp: 'Aucun groupe existant n’a un nom proche.',
		/** Under the search field while she types: what Entrée (or leaving the field) picks. */
		familyWillBe: (name: string) => `Ce sera le groupe : ${name}`,
		familyWillBeNew: (name: string) => `Ce sera un nouveau groupe : « ${name} »`,
		familyEnter: 'Entrée pour confirmer, ou choisissez dans la liste.',
		familyChange: 'Changer',
		familyKeep: 'Garder ce groupe',
		familyRemove: 'Aucune variante',
		familyIs: 'Variante de :',
		/** Before the save: the group a recipe joins, with its recipes listed under it. */
		familyJoins: (name: string, n: number) => `Elle rejoindra : ${name} (${n === 1 ? '1 recette' : `${n} recettes`})`,
		familyWith: 'Les autres recettes du groupe :',
		familyNewNote: 'Nouveau groupe : son nom sera enregistré avec la recette.',
		variant: 'Ce qui distingue cette variante',
		variantPlaceholder: 'ex. zeste de citron, sans sucre',
		sameTitle: 'En faire deux variantes du même plat',
		pairVariant: (title: string) => `Ce qui distingue « ${title} »`,
		pairNote: (title: string) => `« ${title} » sera regroupée avec celle-ci, dans le même enregistrement.`,
		pairCancel: 'Non, les garder séparées',
		useSuggestion: (s: string) => `Utiliser « ${s} »`,
		near: 'Voir la recette',
		/** The one line under the title (its room kept): a same title, close ingredients, a near title. */
		titleSame: 'Ce titre existe déjà.',
		titleSameShort: 'Déjà :',
		titleClose: (title: string) => `Presque les mêmes ingrédients que « ${title} ».`,
		titleNear: (title: string) => `Titre presque pareil : « ${title} ».`,
		/** A recipe whose title this one holds whole (or the reverse): a variant, perhaps. */
		titleLike: (title: string, author: string) => `Ressemble à « ${title} »${author ? ` (${author})` : ''}.`,
		samePair: 'En faire une variante',
		/** The quick Save (rail, strip) while it is not ready. */
		saveCountMissing: (n: number) => `${n} à compléter`,
		saveCountFix: (n: number) => `${n} à corriger`,
		/** The count beside the quick Save, a button to the first field (round 3). */
		saveCountGo: (what: string) => `Aller au premier champ : ${what}`,
		/** A step's time changed while Cuisson (or Préparation) held the old one (round 3). */
		timeNudge: (field: string, from: string, to: string) => `${field} : ${from} → ${to} ?`,
		timeNudgeYes: 'Mettre à jour',
		timeNudgeNo: (field: string) => `Garder ${field.toLowerCase()} tel quel`,

		tags: 'Étiquettes',
		tagsHelp: 'Pour retrouver la recette : dessert, soupe, végétarien…',
		tagSearch: 'Ajouter une étiquette',
		tagAdd: (s: string) => `Ajouter « ${s} »`,
		tagNew: 'nouvelle, en attente',
		tagRemove: (s: string) => `Retirer l’étiquette ${s}`,
		seasons: 'Saisons',
		difficulty: 'Difficulté',
		difficultyLevels: ['Très facile', 'Facile', 'Moyenne', 'Difficile', 'Très difficile'],
		rating: 'Note',
		ratingLevels: ['1 sur 5', '2 sur 5', '3 sur 5', '4 sur 5', '5 sur 5'],

		source: 'Provenance',
		sourceType: 'D’où vient-elle ?',
		sourceNone: 'Je ne sais pas',
		author: 'De qui',
		authorPlaceholder: 'ex. Tante Irène',
		/** Provenance's labels follow « D’où vient-elle ? »: the same fields, named for the kind of source. */
		srcAuthor: { book: 'Auteur ou éditeur', magazine: 'Auteur', website: 'Auteur', tv: 'Animateur ou chef' } as Record<string, string>,
		srcTitle: { book: 'Titre du livre', magazine: 'Magazine', website: 'Site', tv: 'Émission' } as Record<string, string>,
		srcPage: { magazine: 'Numéro / page' } as Record<string, string>,
		srcUrl: { website: 'Adresse' } as Record<string, string>,
		sourceTitle: 'Livre ou magazine',
		page: 'Page',
		url: 'Adresse web',
		sourceNote: 'Précision',

		times: 'Temps',
		prepTime: 'Préparation',
		cookTime: 'Cuisson',
		prepTimePlaceholder: 'ex. 20 min',
		cookTimePlaceholder: 'ex. 45 min',
		restTime: 'Repos',
		totalTime: 'Total',
		hours: 'h',
		minutes: 'min',
		hoursLabel: 'heures',
		minutesLabel: 'minutes',
		range: 'à',
		rangeAdd: (u: string): string => (u === 'C' ? 'Plage (ex. 175 à 190 °C)' : 'Plage (ex. 350 à 375 °F)'),
		rangeRemove: 'Retirer le maximum',
		oven: 'Four',
		ovenTemp: 'Température',
		ovenUnit: 'Unité du four',
		/** « Four »'s visible caption: the number and the °F/°C beside it. */
		ovenLegend: 'Four (température)',
		ovenUnitNames: { F: 'Fahrenheit', C: 'Celsius' } as Record<string, string>,
		ovenTempPlaceholder: 'ex. 350',
		servings: 'Portions',
		servingsNote: 'Précision',
		servingsNotePlaceholder: 'ex. en accompagnement',
		yield: 'Donne',
		yieldPlaceholder: 'ex. 24 biscuits',
		yieldAmount: 'Quantité obtenue',
		/** One box per time (plan 04, Phase 5.5, round 1 of the UI pass). */
		basics: 'Portions et temps',
		timeHelp: 'Écrivez « 1 h 30 », « 90 min » ou « 20 à 25 min ».',
		timeFormat: 'Ce n’est pas un temps : écrivez 1 h 30, 90 min ou 20 à 25 min.',
		timeWords: { h: 'h', min: 'min', to: 'à' },
		classify: 'Classement',
		/** The rail (a wide screen) or the strip (a phone) that jumps to each part of the form. */
		sectionsNav: 'Parties de la recette',
		/** A phone: the parts as one picker, the part in sight shown. */
		sectionsJump: 'Aller à une partie de la recette',
		sectionNames: { title: 'Titre', source: 'Provenance', ingredients: 'Ingrédients', method: 'Préparation', notes: 'Notes', class: 'Classement' } as Record<string, string>,
		sectionStates: { done: 'rempli', empty: 'vide', fix: 'à corriger' } as Record<string, string>,
		/** The save bar: one line, each reason takes her to its field. */
		jumpTo: (what: string) => `Aller au champ : ${what}`,
		moreReasons: (n: number) => `(+${n})`,
		/** An ingredient row: its ⋯ menu and its details. */
		itemActions: (label: string) => `Actions — ${label}`,
		addDetail: 'Ajouter un détail',
		addDetailPick: 'Choisir…',
		sum: {
			upTo: (q: string) => `jusqu’à ${q}`,
			alt: (s: string) => `ou ${s}`,
			or: (s: string) => `ou ${s}`,
			toTaste: 'au goût',
			optional: 'facultatif',
			recipe: 'recette liée'
		},
		groupActions: (n: number) => `Actions — Groupe ${n}`,
		ratingNone: 'Pas de note',
		difficultyNone: 'Pas indiquée',
		/** Round 2 of the UI pass: the save bar says what is missing as a sentence. */
		missingLead: 'Il manque :',
		fixLead: 'À corriger :',
		missing: {
			title: 'un titre',
			ingredients: 'un ingrédient',
			name: 'le nom d’un ingrédient',
			unit: 'l’unité d’une quantité',
			qty: 'une quantité',
			variant: 'ce qui distingue la variante',
			family: 'le plat dont c’est une variante',
			items: 'les ingrédients d’un groupe'
		} as Record<string, string>,
		fix: {
			format: 'une quantité ou un nombre',
			range: 'un maximum plus petit que le minimum',
			duplicate: 'un ingrédient en double',
			oven: '°F ou °C pour le four',
			url: 'l’adresse web (https://)',
			integer: 'des portions en nombre entier',
			nameQuantity: 'une quantité écrite dans un nom',
			nameComma: 'un nom d’ingrédient avec une virgule',
			noteQuantity: 'une quantité écrite dans une note',
			marker: 'des crochets dans un texte',
			method: 'la préparation : gardez une étape',
			time: 'un temps (1 h 30, 90 min)',
			other: 'un champ signalé'
		} as Record<string, string>,
		/** Classement, folded to one line until it is needed. */
		classOpen: 'Compléter',
		classClose: 'Replier',
		classNoVariant: 'Pas de variante',
		classVariantOf: (name: string) => `Variante de ${name}`,
		classTags: (n: number) => (n === 0 ? 'Aucune étiquette' : n === 1 ? '1 étiquette' : `${n} étiquettes`),
		classDifficulty: (level: string) => `difficulté : ${level.toLowerCase()}`,
		classRating: (n: number) => `note : ${n} sur 5`,
		/** « Donne » : a number of portions, or something else (« 2 tourtières »). */
		/** « Donne » is one field: a number is portions (« 8 », « 6 à 8 portions »), anything else what the recipe makes (« 2 tourtières »). */
		givesPlaceholder: 'ex. 8 portions, 2 tourtières',
		givesPortions: (n: string, max: string) => `${n}${max ? ` à ${max}` : ''} ${!max && n === '1' ? 'portion' : 'portions'}`,
		givesAsPortions: 'Compté en portions : la recette s’ajuste au nombre de personnes.',
		givesAsYield: 'Ce que donne la recette, tel qu’écrit.',
		yieldAlso: 'Donne aussi',
		/** Provenance's précision and the rest and total times: a link until filled. */
		addSourceNote: 'Précision',
		addMoreTimes: 'Repos, total',
		/** « Coller une liste »: many ingredients or steps at once. */
		pasteList: 'Coller une liste',
		pasteItemsLabel: 'Une ligne par ingrédient. Une ligne « Pâte : » commence un groupe.',
		pasteItemsPlaceholder: '2 tasses de farine\n1 c. à thé de sel\n3 œufs, battus',
		pasteStepsLabel: 'Une étape par ligne, ou des étapes numérotées (1., 2.) même coupées sur plusieurs lignes.',
		pasteStepsPlaceholder: '1. Préchauffer le four à 350 °F.\n2. Mélanger la farine et le sel.',
		pasteRead: 'Ce que l’app a compris',
		pasteUnread: 'à vérifier',
		pasteUnreadHelp: 'Ligne pas comprise : elle va entière dans le nom, à corriger.',
		pasteAddItems: (n: number) => (n === 1 ? 'Ajouter 1 ingrédient' : `Ajouter ${n} ingrédients`),
		pasteAddSteps: (n: number) => (n === 1 ? 'Ajouter 1 étape' : `Ajouter ${n} étapes`),
		pasteCancel: 'Annuler',
		pastedItems: (n: number) => (n === 1 ? '1 ingrédient ajouté.' : `${n} ingrédients ajoutés.`),
		pastedSteps: (n: number) => (n === 1 ? '1 étape ajoutée.' : `${n} étapes ajoutées.`),
		stepActions: (label: string) => `Actions — ${label}`,

		uncertain: 'Lecture incertaine sur l’original.',
		uncertainOr: (s: string) => `Autre lecture : « ${s} »`,
		confirm: 'C’est bien ça',
		added: (s: string) => `Ajouté à la transcription : « ${s} »`,
		uncertainLeft: (n: number) => (n === 1 ? '1 lecture incertaine reste à confirmer.' : `${n} lectures incertaines restent à confirmer.`),

		draftFound: (when: string) => `Un brouillon non enregistré de cette recette existe (${when}).`,
		draftResume: 'Reprendre le brouillon',
		draftDiscard: 'Repartir de la recette',
		draftDiscardNew: 'Repartir de zéro',
		draftDiscardPaste: 'Repartir du texte collé',
		draftSetAside: (when: string) => `Brouillon du ${when} mis de côté : vous continuez sans lui.`,
		draftResumeOver: 'Reprendre le brouillon (remplace ce que vous venez de taper)',
		draftChooseFirst: (other: string) => `Choisissez d’abord : « Reprendre le brouillon » ou « ${other} ».`,
		draftKept: (time: string) => `Brouillon gardé à\u00a0${time}`,
		draftKeptTitle: 'Ce que vous tapez est gardé sur cet appareil jusqu’à l’enregistrement.',

		saved: 'Recette enregistrée.',
		/** After saving an edit (the recipe page, where the form took her). */
		savedEdit: 'Modifications enregistrées.',
		/** Beside Enregistrer on a computer: the keys that save from anywhere in the form. */
		saveKeys: 'Ctrl+Entrée',
		/** Body text the form has no field for (before any heading, or under a heading it does not know): shown and kept as written. */
		freeText: 'Texte libre',
		freeTextHelp: 'Ce texte n’est sous aucun titre que la fiche reconnaît : il est gardé tel quel et la recette l’affiche avant la préparation.',
		freeTextOther: (heading: string) => `Texte libre — section « ${heading} »`,
		freeTextOtherHelp: 'Une section que la fiche ne connaît pas : gardée telle quelle, affichée sur la recette.',
		freeToSteps: (n: number) => (n === 1 ? 'Ranger cette ligne dans Préparation' : `Ranger ces ${n} lignes dans Préparation`),
		unchanged: 'Rien n’a changé : il n’y avait rien à enregistrer.',
		redone: 'Modification rétablie.',
		undoFailed: (msg: string) => `Impossible d’annuler : ${msg}`,
		undoPartial: (msg: string) => `Annulé en partie seulement (la photo, pas la recette) : ${msg}`,
		offline: 'Pas de connexion : rien n’est perdu. Le brouillon est gardé sur l’appareil ; réessayez quand le réseau revient.',
		failed: 'La recette n’a pas pu être enregistrée ; rien n’a changé.',
		gone: 'Cette recette a été supprimée entre-temps. Votre version est gardée dans le brouillon.',
		pairChanged: 'L’autre recette a changé entre-temps ; réessayez « En faire deux variantes du même plat ».',
		signedOut: 'Votre session a pris fin : reconnectez-vous, le brouillon vous attend.',

		stale: 'Cette recette a été modifiée entre-temps.',
		staleHelp: 'Votre version est gardée. Comparez, puis choisissez celle qu’on garde.',
		staleGone: 'Cette recette a été supprimée ou ne se lit plus. Votre version est gardée dans le brouillon.',
		mine: 'Votre version',
		theirs: 'L’autre version',
		keepMine: 'Garder ma version',
		takeTheirs: 'Prendre l’autre version',

		broken: 'Cette recette ne peut pas s’ouvrir dans le formulaire : son fichier a une erreur. Elle est à faire corriger.',
		brokenBack: 'Retour à la recette',
		compare: {
			title: 'Titre',
			family: 'Variante de',
			tags: 'Étiquettes',
			times: 'Temps',
			oven: 'Four',
			servings: 'Portions',
			source: 'Provenance',
			ingredient: (n: number) => `Ingrédient ${n}`,
			step: (n: number) => `Étape ${n}`,
			notes: 'Notes',
			variants: 'Variantes',
			alternatives: 'Remplacements',
			photo: 'Photo'
		},
		/** The words inside a compared line. */
		compared: {
			range: (a: string, b: string) => `${a} à ${b}`,
			toTaste: 'au goût',
			optional: 'facultatif',
			time: { prep: 'prép.', cook: 'cuisson', rest: 'repos', total: 'total' },
			page: (p: string) => `p. ${p}`
		}
	}
};

export type Strings = typeof fr;

/**
 * A tag's display name: its label from vocab/tag-labels.yaml, else the tag
 * with hyphens as spaces and a capital. The labels are vault data (seeded by
 * `vault init`, docs/VOCAB.md "Tag labels"); the app holds none of its own.
 */
export function tagLabel(tag: string, label?: string | null): string {
	if (label) return label;
	const s = tag.replace(/-/g, ' ');
	return s.charAt(0).toUpperCase() + s.slice(1);
}

export function familyLabel(slug: string, label?: string | null): string {
	if (label) return label;
	const s = slug.replace(/-/g, ' ');
	return s.charAt(0).toUpperCase() + s.slice(1);
}
