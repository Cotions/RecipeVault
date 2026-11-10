<script lang="ts">
	// The paste box: the owner's main tool, built for speed. Paste, see it
	// valid, Ctrl+Enter, next. Live checks run in the browser; the server
	// re-checks with the vault (collisions, sub-recipes, same titles) and is the
	// only judge on save. "Relire et modifier" opens one pasted file in the
	// recipe form, on this page (`?recette=N`), for whoever would rather not
	// touch the text.
	import { onMount, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import templateDoc from '../../../docs/AI-TEMPLATE.md?raw';
	import { t, tagLabel } from '$lib/i18n';
	import PageHead from '$lib/components/PageHead.svelte';
	import RecipeView from '$lib/components/RecipeView.svelte';
	import RecipeForm from '$lib/components/form/RecipeForm.svelte';
	import { draftKey, toForm } from '$lib/form';
	import { familyNameFromTitles, variantPrefill, variantShown, type VariantSource } from '$lib/form/family';
	import Marked from '$lib/components/Marked.svelte';
	import DiagnosticItem from '$lib/components/DiagnosticItem.svelte';
	import { formHintText, pasteText, placeHuman } from '$lib/i18n/diagnostics';
	import { checkBatch, checkFile, hasErrors } from '$lib/vault/check';
	import { splitPaste } from '$lib/vault/fences';
	import { aiErrors, renderFixBlock } from '$lib/vault/fixblock';
	import { bodyText } from '$lib/vault/parse';
	import { extractPrompt, extractTranslation, pagePrompt } from '$lib/vault/prompt';
	import { fileSlug } from '$lib/vault/rules/batch';
	import { parseRecipe } from '$lib/vault/parse';
	import { slugify } from '$lib/vault/slug';
	import { fold, normalizeText } from '$lib/vault/normalize';
	import { locate, scalarAt, valueAt, yamlScalar, type Span } from '$lib/vault/locate';
	import {
		ambiguous,
		applyEdits,
		durationFix,
		entryFix,
		isPlainLine,
		methodFix,
		nameQtyFix,
		prepFix,
		resemblesSlugs,
		schemaFix,
		sourceTypeFixes,
		splitQtyFix,
		stepsFix,
		titleFix,
		titleGuess,
		yamlTrouble,
		type Fix,
		type StepsFix,
		type YamlTrouble
	} from '$lib/vault/quickfix';
	import { formatAmount } from '$lib/render/ingredient';
	import { unitForAlias } from '$lib/vault/vocab';
	import { tagFor } from '$lib/vault/rules/vaultvocab';
	import { preselectTag, withAccents } from '$lib/vault/tagmatch';
	import { unitWord } from '$lib/render/unitwords';
	import { stripMarkers } from '$lib/vault/markers';
	import { buildRecipe } from '$lib/vault/build';
	import { markedNumber } from '$lib/vault/quantity';
	import { createContext, isMap } from '$lib/vault/rules/context';
	import { collectMarkers } from '$lib/vault/rules/markers';
	import type { Diagnostic, Ingredient, Lang, Marker, Recipe, SourceType, Unit } from '$lib/vault/types';
	import type { PairOffer, ServerCheckFile } from '$lib/server/paste';
	import type { SaveFile, SaveResult } from '$lib/server/save';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const PROMPT = extractPrompt(templateDoc);

	let text = $state('');
	let box: HTMLTextAreaElement | undefined = $state();
	/**
	 * `names`: the registry names of the ingredients a W305 says a line resembles, by slug.
	 * `tags`: per unknown tag (W501), the known tag it is the same word as, or null (api/check).
	 */
	let server = $state<{ for: string; files: ServerCheckFile[]; names: Record<string, string>; tags: Record<string, string | null> } | null>(null);
	let saving = $state(false);
	/** `action`: one button in the message (« Annuler » after « Recommencer »). */
	let toast = $state<{
		message: string;
		links?: { slug: string; title: string }[];
		note?: string;
		error?: boolean;
		action?: { label: string; run: () => void };
	} | null>(null);
	let savedTitles = $state<string[]>([]);
	/**
	 * The recipes just saved: a card at the top of the page, « Voir la recette »
	 * and « Ajouter une autre fiche », until the next paste or « Ajouter une
	 * autre fiche » (docs/DATA-FLOW.md, "The paste box"). `savedFor`: the box as
	 * the save left it; a change to it closes the card.
	 */
	let justSaved = $state<{ slug: string; title: string }[]>([]);
	let savedFor = '';
	let importUrl = $state('');
	let importing = $state(false);
	/**
	 * Why the last import failed: under the field until the address changes,
	 * with the ways that still work (docs/DATA-FLOW.md, "Web import").
	 */
	let importError = $state<{ message: string; kind: string } | null>(null);
	/** The box holds a web page's import (not an AI answer): the steps say « Page lue » (docs/DATA-FLOW.md). */
	let fromWeb = $state(false);
	/** "Faire traduire par l'IA" was copied: the AI's answer, pasted next, takes the import's place. */
	let replaceNext = $state(false);
	/** Files the save refused because a vault recipe changed (the one to replace, or the other of its pair), by file key: what to say. */
	let staleFiles = $state<Map<string, string>>(new Map());
	/** Bumped to run the server check again on the same text (after a save). */
	let recheck = $state(0);
	/**
	 * The pasted text stays open even when every file passes: she typed in it,
	 * or asked for it ("Modifier le texte", "Montrer dans le texte"). A paste,
	 * an import or an emptied box folds it again (docs/DATA-FLOW.md).
	 */
	let textOpen = $state(false);
	/**
	 * A touch screen that can hand a photo to another app (Web Share with
	 * files): step 1 picks the photo, step 2 sends it with the prompt to the
	 * AI's app in one tap. The photo stays in this page's memory; nothing here
	 * uploads it (docs/DATA-FLOW.md, "The paste box").
	 */
	let canSharePhoto = $state(false);
	let photo = $state<File | null>(null);
	let photoUrl = $state('');
	/** The photo went to the AI's app with the prompt (this card): steps 1–2 fold on a phone. */
	let sent = $state(false);
	/**
	 * After a save, the card's photo (the one sent to the AI) offered to the
	 * recipes just saved: "Joindre cette photo à la recette", one tap, through
	 * /api/photo with the hash the save returned (docs/DATA-FLOW.md).
	 */
	let offers = $state<{ slug: string; title: string; hash: string; busy?: boolean; done?: boolean }[]>([]);
	/** "Joindre la photo de la fiche" on a pasted file's card (a computer): sent with it, right after its save. By file key. */
	let cardPhotos = $state<Record<string, { file: File; url: string }>>({});
	/** Same cap as the server (src/lib/server/photos.ts, PHOTO_MAX_BYTES). */
	const PHOTO_MAX_MB = 25;
	/** The browser can read the clipboard on a tap ("Coller"). */
	let canReadClip = $state(false);
	/** A touch screen (no keyboard focus on load, the share sheet). */
	let coarse = $state(false);

	interface Choice {
		mode?: 'replace' | 'suffix';
		/** For 'replace': the hash of the vault file the person chose to replace. */
		target?: string;
		family?: boolean;
		/** "Recette différente": she answered the same-dish question with no. */
		apart?: boolean;
		/** The group's name as she sees and edits it (never a slug): its slug is found or made on save (`familySlugOf`). */
		familyName?: string;
		variant?: string;
		/** The version name of the vault recipe put in the family with this one (the target). */
		pairVariant?: string;
		/** The vault recipe she groups this one with, among the candidates (the first when not picked). */
		pairSlug?: string;
	}
	/**
	 * Per file, by its key (slug and rank among the files with that slug), not
	 * by position: a new paste or a file inserted above must not inherit
	 * another file's choice.
	 */
	let choices = $state<Record<string, Choice>>({});

	// --- live check in the browser --------------------------------------------

	const split = $derived(splitPaste(text));
	const files = $derived(text.trim() ? (split.files.length ? split.files : [text]) : []);
	// The vault's name-word lists (W302 / W304 / W607), so this check matches the server's.
	const local = $derived(checkBatch(files.map((f, i) => ({ name: t.add.recipeN(i + 1), text: f })), { words: data.words }));

	function slugIn(f: string): string | undefined {
		const fm = parseRecipe(f).frontmatter;
		return fm ? fileSlug(fm) : undefined;
	}
	/** 'slug#rank' for each file; '#position' when it has no slug. */
	function keysOf(texts: string[]): string[] {
		const seen = new Map<string, number>();
		return texts.map((f, i) => {
			const slug = slugIn(f);
			if (!slug) return `#${i}`;
			const n = seen.get(slug) ?? 0;
			seen.set(slug, n + 1);
			return `${slug}#${n}`;
		});
	}
	const keys = $derived(keysOf(files));

	// Forget the choices of files no longer in the box.
	$effect(() => {
		const present = new Set(keys);
		const current = untrack(() => choices);
		const kept = Object.fromEntries(Object.entries(current).filter(([k]) => present.has(k)));
		if (Object.keys(kept).length !== Object.keys(current).length) choices = kept;
		const photos = untrack(() => cardPhotos);
		const gone = Object.keys(photos).filter((k) => !present.has(k));
		if (gone.length) {
			for (const k of gone) URL.revokeObjectURL(photos[k].url);
			cardPhotos = Object.fromEntries(Object.entries(photos).filter(([k]) => present.has(k)));
		}
	});

	let checkTimer: ReturnType<typeof setTimeout> | undefined;
	let checkSeq = 0;
	$effect(() => {
		const current = files;
		void recheck;
		const key = current.join('\u0000');
		const seq = ++checkSeq;
		clearTimeout(checkTimer);
		if (!current.length) {
			server = null;
			return;
		}
		checkTimer = setTimeout(async () => {
			try {
				const res = await fetch('/api/check', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ files: current })
				});
				// Only the latest check counts: an older answer may predate a save.
				if (res.ok && seq === checkSeq) {
					const body = await res.json();
					if (seq === checkSeq) server = { for: key, files: body.files, names: body.names ?? {}, tags: body.tags ?? {} };
				}
			} catch {
				// offline: the browser's own check still shows
			}
		}, 350);
	});

	const serverFresh = $derived(server && server.for === files.join('\u0000') ? server.files : null);

	interface FileView {
		index: number;
		key: string;
		text: string;
		title: string;
		diagnostics: Diagnostic[];
		ok: boolean;
		recipe: (typeof local.files)[number]['recipe'];
		server?: ServerCheckFile;
		/** The collision choice that applies now (a 'replace' only for the recipe it was chosen for). */
		mode?: 'replace' | 'suffix';
		/** First file of the paste with a slug no other recipe has: it takes the slug, no choice needed. */
		firstFree: boolean;
		/** The file as parsed, to name the places of its diagnostics. */
		parsed: ReturnType<typeof parseRecipe>;
		/** Errors that keep it from being saved now. */
		blocking: number;
		/** Per diagnostic, where it sits in the file's text, when found. */
		spans: (Span | null)[];
		/** Ingredient lines and steps, for the summary; `outside`: lines a « Préparation » heading would make steps (W401), when none is read. */
		counts: { ingredients: number; steps: number; outside: number };
		/** The file checked on its own, when it passes (Q3 A): what the form opens. */
		alone?: { recipe: NonNullable<ReturnType<typeof checkFile>['recipe']>; body: NonNullable<ReturnType<typeof checkFile>['body']> };
		/** E002: where the header stops reading, and the one line to realign when that makes it read. */
		trouble: YamlTrouble | null;
		/** Per diagnostic, the fix the box can make itself (E002, E101, E110, E204, E207, W302, W401, W403), when it holds. */
		fixes: (CodeFix | null)[];
		/** Ingredient lines left whole (E207 on a plain string): their paths, and the one fix that reads them all, when it holds. */
		plain: { paths: string[]; all: Fix | null };
		/** No step read, but lines that look like steps (W401, W403): the line named, the fix that writes them as steps. */
		oddSteps: StepsFix | null;
		/**
		 * E002 with a realignment: what the realigned text's real check finds,
		 * listed with the errors and marked « à revérifier »; `text` is that
		 * realigned file, the one their fixes are made in.
		 */
		later: { ds: Diagnostic[]; parsed: ReturnType<typeof parseRecipe>; text: string } | null;
		/** The errors as listed and counted: an E203 beside its item's E204 is one, a settled E103 none, E002's next ones in. */
		errorCount: number;
	}

	/**
	 * A fix the paste box makes in the text for a code that has no closed list
	 * (docs/VALIDATION.md, "Quick fixes in the paste box"): offered only when
	 * the file, checked again with it, loses the problem and gains no error.
	 */
	type CodeFix =
		| { kind: 'realign'; line: number; fix: Fix }
		| { kind: 'title'; guess: string }
		| { kind: 'schema'; fix: Fix }
		| { kind: 'split'; qty: string; unit: Unit; fix: Fix }
		| { kind: 'nameSplit'; qty: string; unit: Unit; name: string; fix: Fix }
		| { kind: 'method'; steps: number; fix: Fix }
		| { kind: 'steps'; steps: number; fix: Fix }
		| { kind: 'entry'; text: string; fix: Fix }
		| { kind: 'prep'; name: string; prep: string; fix: Fix }
		| { kind: 'duration'; value: string; fix: Fix }
		| { kind: 'sourceType'; options: { type: SourceType; fix: Fix }[] };
	const FIXED_CODES = new Set(['E002', 'E101', 'E106', 'E109', 'E110', 'E204', 'E207', 'E210', 'E301', 'W302', 'W401', 'W403']);

	/** « 1 ½ tasse · lait »: an entry read from a whole line, as « Lire comme » says it. */
	function entryText(it: Ingredient, lang: Lang): string {
		const amount = it.qty ? formatAmount(it, { lang, asWritten: true }) : '';
		const name = stripMarkers(it.name) + (it.prep ? `, ${it.prep}` : '') + (it.toTaste ? ` (${t.add.toTaste})` : '');
		return [amount, name].filter(Boolean).join(' · ');
	}

	function codeFixOf(f: string, d: Diagnostic, lang: Lang, trouble: YamlTrouble | null): CodeFix | null {
		switch (d.code) {
			case 'E002':
				return trouble?.realign ? { kind: 'realign', line: trouble.realign.line, fix: trouble.realign.fix } : null;
			case 'E101': {
				// Only a missing title (not one that is a list): what the field writes.
				const guess = titleGuess(f);
				return titleFix(f, guess || 'Recette') ? { kind: 'title', guess } : null;
			}
			case 'E110': {
				const fix = schemaFix(f);
				return fix ? { kind: 'schema', fix } : null;
			}
			case 'E204': {
				const r = splitQtyFix(f, d.path, lang);
				return r ? { kind: 'split', ...r } : null;
			}
			case 'E210': {
				// « 500 ml de lait » in the name alone: the amount out of the name, the name kept.
				const r = nameQtyFix(f, d.path, lang);
				return r ? { kind: 'nameSplit', ...r } : null;
			}
			case 'E207': {
				// « - 1 1/2 tasse de lait »: the line is there, only not split; read as « Coller une liste » reads it.
				const r = entryFix(f, [d.path], lang);
				return r ? { kind: 'entry', text: entryText(r.items[0], lang), fix: r.fix } : null;
			}
			case 'E301':
			case 'W401':
			case 'W403': {
				const r = d.code === 'W403' ? null : methodFix(f, lang);
				if (r) return { kind: 'method', ...r };
				// Lines that look like steps, written another way (« Étape 1 : », « 1 - », indented 4 spaces).
				const o = stepsFix(f, lang);
				return o ? { kind: 'steps', steps: o.steps, fix: o.fix } : null;
			}
			case 'W302': {
				const r = prepFix(f, d.path, data.words);
				return r ? { kind: 'prep', ...r } : null;
			}
			case 'E109': {
				// « 40 min » → 40m, only when it reads with no doubt.
				const r = durationFix(f, d.path);
				return r ? { kind: 'duration', ...r } : null;
			}
			case 'E106': {
				// `type: card`: one button per type of the list, she picks.
				const options = sourceTypeFixes(f, d.path);
				return options.length ? { kind: 'sourceType', options } : null;
			}
		}
		return null;
	}

	/**
	 * An E203 (a quantity with no unit) on the item whose E204 reads
	 * « 1 1/2 tasse » in `qty`: one problem, the E204's split settles both. Said
	 * and counted once, as that E204 (display only; both codes stay).
	 */
	function mergedE203(ds: Diagnostic[], d: Diagnostic): boolean {
		return d.code === 'E203' && !!d.path && ds.some((x) => x.code === 'E204' && x.path === `${d.path}.qty`);
	}

	/** E002's realigned text, checked for real: its errors, an E203 beside its E204 said once. */
	function laterFor(f: string, trouble: YamlTrouble | null): FileView['later'] {
		const result = trouble?.realign?.fix.result;
		if (!result) return null;
		const ds = checkFile(result, { words: data.words }).diagnostics.filter((d) => d.severity === 'error');
		return { ds: ds.filter((d) => !mergedE203(ds, d)), parsed: parseRecipe(result), text: result };
	}

	/**
	 * Ingredient lines and steps, from the file as written (a file with errors
	 * has no recipe, still its lines; after an E002, the realigned text's).
	 * No step read: the lines W401 would put under « Préparation », so the
	 * summary says « 3 lignes hors Préparation », not « 0 étape ».
	 */
	function countsOf(parsed: ReturnType<typeof parseRecipe>, f: string, lang: Lang): FileView['counts'] {
		const fm = parsed.frontmatter;
		const ingredients = Array.isArray(fm?.ingredients)
			? fm.ingredients.reduce((n: number, g: unknown) => n + (Array.isArray((g as { items?: unknown })?.items) ? (g as { items: unknown[] }).items.length : 0), 0)
			: 0;
		const steps = parsed.body?.steps.length ?? 0;
		return { ingredients, steps, outside: steps ? 0 : (methodFix(f, lang)?.steps ?? stepsFix(f, lang)?.steps ?? 0) };
	}

	/** The choice for a file, when it still fits its collision. */
	function modeOf(c: Choice | undefined, col: ServerCheckFile['collision']): FileView['mode'] {
		if (!c?.mode || !col) return undefined;
		if (c.mode === 'replace') return col.existing && !col.inTrash && c.target === col.existing.hash ? 'replace' : undefined;
		return 'suffix';
	}

	const views = $derived<FileView[]>(
		files.map((f, i) => {
			const s = serverFresh?.[i];
			const key = keys[i];
			const col = s?.collision;
			const chosen = modeOf(choices[key], col);
			// Two new files with one slug (docs/DATA-FLOW.md): the first saves under
			// it, only the later ones wait for a choice. Without the server's
			// answer yet, a local E103 can only be such a clash inside the paste.
			const firstFree = key.endsWith('#0') && !chosen && (s ? !!col && !col.existing && !col.inTrash : true);
			// A clash she has not answered: the suffixed slug, which keeps both (usability round 4);
			// « Remplacer » only when she picks it.
			const mode = chosen ?? (col && !firstFree ? 'suffix' : undefined);
			let diagnostics = s ? s.diagnostics : local.files[i].diagnostics;
			if (firstFree) diagnostics = diagnostics.filter((d) => d.code !== 'E103');
			const parsed = parseRecipe(f);
			const fm = parsed.frontmatter;
			const trouble = diagnostics.some((d) => d.code === 'E002') ? yamlTrouble(f) : null;
			// A batch error (E103 between two pasted files) withholds the batch's
			// recipe; the file's own is enough here, as every error left still blocks.
			const own = checkFile(f);
			const recipe = local.files[i].recipe ?? own.recipe;
			const title = recipe?.title ?? (typeof fm?.title === 'string' ? fm.title : t.add.recipeN(i + 1));
			// E103 is settled by a choice here, not by the AI.
			const blocking = diagnostics.filter((d) => d.severity === 'error' && !(d.code === 'E103' && mode));
			const later = trouble ? laterFor(f, trouble) : null;
			const lang: Lang = fm?.lang === 'en' ? 'en' : 'fr';
			const plainPaths = diagnostics.flatMap((d) => (d.code === 'E207' && d.path && isPlainLine(f, d.path) ? [d.path] : []));
			const oddSteps = diagnostics.some((d) => d.code === 'W401' || d.code === 'W403') && !methodFix(f, lang) ? stepsFix(f, lang) : null;
			const fileSpans = diagnostics.map((d) => (d.code === 'E002' ? (trouble?.span ?? null) : locate(f, d.path, parsed.body)));
			if (oddSteps) {
				// « Montrer dans le texte » on the W401 / W403: the first line that looks like a step.
				const lines = normalizeText(f).split('\n');
				const start = lines.slice(0, oddSteps.first.line).reduce((n, l) => n + l.length + 1, 0);
				diagnostics.forEach((d, k) => {
					if (d.code === 'W401' || d.code === 'W403') fileSpans[k] = { start, end: start + oddSteps.first.text.length };
				});
			}
			return {
				index: i,
				key,
				text: f,
				title,
				diagnostics,
				ok: blocking.length === 0 && !!recipe,
				blocking: blocking.length,
				later,
				errorCount: blocking.filter((d) => !mergedE203(diagnostics, d)).length + (later?.ds.length ?? 0),
				spans: fileSpans,
				trouble,
				fixes: diagnostics.map((d) => (FIXED_CODES.has(d.code) ? codeFixOf(f, d, lang, trouble) : null)),
				plain: { paths: plainPaths, all: plainPaths.length > 1 ? (entryFix(f, plainPaths, lang)?.fix ?? null) : null },
				oddSteps,
				recipe,
				server: s,
				mode,
				firstFree,
				parsed,
				counts: countsOf(later?.parsed ?? parsed, later?.text ?? f, fm?.lang === 'en' ? 'en' : 'fr'),
				alone: own.recipe && own.body && !hasErrors(own.diagnostics) ? { recipe: own.recipe, body: own.body } : undefined
			};
		})
	);

	// --- a file with errors, previewed anyway ------------------------------------------

	/**
	 * A file with errors still shows its preview, partial and greyed, under its
	 * errors: she sees that the other ingredients and the steps came through.
	 * Built from the frontmatter as written: lines that cannot be read as an
	 * ingredient are left out, a unit outside the list shows as written
	 * (« tasse »), an unreadable oven is dropped. Nothing when the frontmatter
	 * does not parse or has no title. A preview only: never saved, never checked.
	 */
	function partialRecipe(parsed: ReturnType<typeof parseRecipe>): Recipe | undefined {
		const fm = parsed.frontmatter;
		if (!fm || typeof fm.title !== 'string' || !fm.title.trim()) return undefined;
		const named = (it: unknown): it is Record<string, unknown> => isMap(it) && typeof it.name === 'string' && !!it.name.trim();
		// A line left whole (« - 1 1/2 tasse de lait », E207) shows as written, in its place.
		const asEntry = (it: unknown) => (typeof it === 'string' && it.trim() ? { name: it.trim() } : it);
		const groups = (Array.isArray(fm.ingredients) ? fm.ingredients : []).filter(isMap).map((g) => ({
			...g,
			items: (Array.isArray(g.items) ? g.items : []).map(asEntry).filter(named).map((it) => {
				const { or, alt, ...rest } = it;
				const ors = Array.isArray(or) ? or.filter((o) => (typeof o === 'string' && o.trim()) || named(o)) : [];
				return { ...rest, ...(ors.length ? { or: ors } : {}), ...(isMap(alt) ? { alt } : {}) };
			})
		}));
		const clean: Record<string, unknown> = { ...fm, ingredients: groups };
		if (isMap(fm.oven) && (markedNumber(fm.oven.temp) === undefined || (fm.oven.unit !== 'F' && fm.oven.unit !== 'C'))) delete clean.oven;
		try {
			let markers: Marker[] = [];
			try {
				if (parsed.body && parsed.bodyChunks) markers = collectMarkers(createContext(clean, parsed.body, parsed.bodyChunks, []));
			} catch {
				// no markers: the preview shows them as written
			}
			const recipe = buildRecipe(clean, markers);
			recipe.ingredients.forEach((g, i) =>
				g.items.forEach((it, j) => {
					const u = (groups[i]?.items[j] as Record<string, unknown> | undefined)?.unit;
					if (!it.unit && typeof u === 'string' && u.trim()) it.unit = u.trim() as Unit;
				})
			);
			return recipe;
		} catch {
			return undefined;
		}
	}

	// --- one pasted file in the form ("Relire et modifier") ----------------------

	/**
	 * The file open in the form: `?recette=N` (from 1), when that file opens.
	 * A clash with the vault or inside the paste needs no choice there: the
	 * form gives a new recipe the first free slug of its title.
	 */
	const editing = $derived.by(() => {
		const n = Number(page.url.searchParams.get('recette'));
		const v = Number.isInteger(n) && n > 0 ? views[n - 1] : undefined;
		return v?.alone ? { view: v, form: toForm(v.alone.recipe, v.alone.body) } : null;
	});
	/** Whether the form was opened from the list in this visit, so "back" can be the browser's own. */
	let pushed = false;

	function openInForm(v: FileView) {
		pushed = true;
		goto(`/ajouter?recette=${v.index + 1}`);
	}

	function backToList() {
		if (pushed) history.back();
		else goto('/ajouter', { replaceState: true });
	}

	/** Saved from the form: the file leaves the paste; back to the others (true), or to the recipe when it was the last. */
	async function savedFromForm(v: FileView, slug: string): Promise<boolean> {
		const rest = files.map((_, i) => i).filter((i) => i !== v.index);
		savedTitles = [...savedTitles, v.title];
		pushed = false;
		if (!rest.length) {
			keep('');
			await goto(`/r/${slug}`, { invalidateAll: true });
			return false;
		}
		await goto('/ajouter', { replaceState: true, invalidateAll: true });
		keepOnly(rest, staleFiles);
		recheck++;
		return true;
	}

	// --- the paste kept in this tab -------------------------------------------------

	// Until it is saved or emptied, the paste stays in this tab (sessionStorage):
	// a tablet that reloads a tab left in the background, or a trip to the form
	// and back, loses nothing. Never sent anywhere.
	const KEPT = 'recipevault:collage';
	function keep(value: string) {
		try {
			if (value.trim()) sessionStorage.setItem(KEPT, value);
			else sessionStorage.removeItem(KEPT);
		} catch {
			// disabled storage: the box works, only without the safety net
		}
	}
	let restored = false;
	$effect(() => {
		const value = text;
		if (restored) keep(value);
	});
	/** The box was filled from this tab's kept paste on load: the progress line says so, with « Recommencer ». */
	let restoredDraft = $state(false);
	$effect(() => {
		if (!text.trim()) restoredDraft = false;
	});

	/**
	 * « Recommencer »: the box emptied, so the ways in (the tabs, the prompt)
	 * come back; the paste and its answers kept a moment, « Annuler » in the
	 * message puts them back (docs/DATA-FLOW.md, "The paste box").
	 */
	function restart() {
		const was = { text, choices, keptTags, fromWeb, staleFiles };
		text = '';
		choices = {};
		keptTags = [];
		staleFiles = new Map();
		restoredDraft = false;
		reviewSteps = true;
		flash(t.add.restarted, {
			action: {
				label: t.add.undo,
				run: () => {
					text = was.text;
					choices = was.choices;
					keptTags = was.keptTags;
					staleFiles = was.staleFiles;
					tick().then(() => (fromWeb = was.fromWeb));
				}
			}
		});
		tick().then(() => document.getElementById(`tab-${way}`)?.focus());
	}

	/** « Ajouter une autre fiche »: the card closes, the way in ready (the box, or the address on the web tab). */
	function addAnother() {
		justSaved = [];
		tick().then(() => {
			if (views.length || way !== 'web') {
				if (canFocusBox() || views.length) box?.focus();
				else document.getElementById(`tab-${way}`)?.focus();
			} else document.getElementById('import-url')?.focus();
		});
	}
	// The box changed since the save (the next paste, an import): the card has said its piece.
	$effect(() => {
		const now = text;
		if (untrack(() => justSaved.length) && now !== savedFor) justSaved = [];
	});

	const needAi = $derived(views.filter((v) => aiErrors(v.diagnostics).length > 0));
	/** Files ready but for a version name she started to give: the save waits for it. */
	const naming = $derived(views.filter((v) => v.ok && groupPending(v)));
	const canSave = $derived(views.length > 0 && views.some((v) => v.ok) && !naming.length && !saving);

	// --- actions ----------------------------------------------------------------

	/**
	 * To the clipboard: the Clipboard API, else the older copy command (a page
	 * reached over plain http on the home network has no Clipboard API). False
	 * when neither works: the caller shows the text to copy by hand.
	 */
	async function copy(textToCopy: string): Promise<boolean> {
		try {
			if (navigator.clipboard?.writeText) {
				// A permission prompt nobody answers must not leave the tap without an answer: 1 s, then the older way.
				const done = await Promise.race([navigator.clipboard.writeText(textToCopy).then(() => true), new Promise<false>((r) => setTimeout(() => r(false), 1000))]);
				if (done) return true;
			}
		} catch {
			// refused (not focused, not allowed): the older way below
		}
		const area = document.createElement('textarea');
		area.value = textToCopy;
		area.setAttribute('readonly', '');
		Object.assign(area.style, { position: 'fixed', top: '0', left: '-9999px', opacity: '0' });
		const had = document.activeElement as HTMLElement | null;
		document.body.appendChild(area);
		area.select();
		let ok = false;
		try {
			ok = document.execCommand('copy');
		} catch {
			ok = false;
		}
		area.remove();
		had?.focus({ preventScroll: true });
		return ok;
	}

	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	/** The message's one button (« Annuler »): the message closes, then its action runs. */
	function runToastAction() {
		const act = toast?.action;
		clearTimeout(toastTimer);
		toast = null;
		act?.run();
	}
	function flash(message: string, extra: Partial<NonNullable<typeof toast>> = {}) {
		toast = { message, ...extra };
		// An earlier message's timer must not close this one.
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), extra.links || extra.action ? 8000 : 4000);
	}

	/** The prompt went to the clipboard in this visit: step 1 shows it done. */
	let promptDone = $state(false);
	/** The prompt was copied on this device before (a computer, a phone without photo sharing): the steps start folded on a phone. */
	let promptGiven = $state(false);
	/** "Revoir": the steps open again, folded or not. */
	let reviewSteps = $state(false);
	/** Step 2 done: Claude opened in a tab, or the prompt shared to the AI's app. */
	let aiOpened = $state(false);
	const GIVEN = 'recipevault:prompt-donne';
	/**
	 * Steps 1–2 folded to one line on a phone, the paste box on the first
	 * screen: once the prompt is given. With photo sharing the steps are per
	 * card (a new photo each time), so only this card's share folds them.
	 */
	const stepsFolded = $derived(!reviewSteps && (canSharePhoto ? sent : aiOpened || (promptGiven && !promptDone)));
	/** The prompt is given (copied or shared): step 1 ticked, remembered on this device. */
	function given() {
		promptDone = true;
		reviewSteps = false;
		try {
			localStorage.setItem(GIVEN, '1');
		} catch {
			// no storage: folded for this visit only
		}
	}
	/** "✓ Copié" on the button for 2 s, then "Copier à nouveau" (step 1 stays ticked). */
	let copiedNow = $state(false);
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;
	/** "Voir le prompt": the prompt itself, readonly, under step 1; opened and selected when the copy cannot be made. */
	let peekOpen = $state(false);
	let copyFailed = $state(false);
	let peekBoxes: HTMLTextAreaElement[] = [];
	/** The prompt copied: true. Not copied (no clipboard here): the prompt shown, selected, for Ctrl+C or a long press. */
	async function copyPrompt(): Promise<boolean> {
		if (await copy(prompt)) {
			copyFailed = false;
			copiedNow = true;
			clearTimeout(copiedTimer);
			copiedTimer = setTimeout(() => (copiedNow = false), 2000);
			given();
			if (photo) sent = true;
			return true;
		}
		copyFailed = true;
		peekOpen = true;
		reviewSteps = true;
		await tick();
		const area = peekBoxes.find((a) => a?.isConnected && a.offsetParent !== null);
		if (area) {
			area.focus({ preventScroll: true });
			area.setSelectionRange(0, area.value.length);
			area.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
		}
		return false;
	}
	/** She copied the prompt by hand from "Voir le prompt": step 1 is done all the same. */
	function copiedByHand(e: ClipboardEvent & { currentTarget: HTMLTextAreaElement }) {
		const a = e.currentTarget;
		if (a.selectionEnd - a.selectionStart > prompt.length / 2) given();
	}

	// --- step 2: the AI, opened or reached through the share sheet ----------------------

	/** Where step 2 sends her on a computer: a new conversation with Claude, in a new tab. */
	const AI_URL = 'https://claude.ai/new';
	/** A touch screen with a share sheet for text (no photo sharing): step 2 shares the prompt. */
	let canShareText = $state(false);
	/** "Ouvrir Claude": the link opens the tab itself; the prompt goes to the clipboard on the same tap, so she only pastes it there. */
	function openedAi() {
		aiOpened = true;
		if (!promptDone) copyPrompt();
	}
	/** "Partager le prompt…": the prompt to the AI's app through the system's share sheet; closing the sheet is not a failure. */
	async function sharePrompt() {
		try {
			await navigator.share({ text: prompt });
			given();
			aiOpened = true;
		} catch (e) {
			if ((e as DOMException)?.name === 'AbortError') return;
			// No clipboard either: the prompt is shown to copy by hand.
			if (await copyPrompt()) flash(t.add.shareFailed, { error: true });
		}
	}
	/**
	 * The box takes the focus by itself only with a mouse and at 700 px or
	 * more: on a narrow screen a keyboard would rise over steps 1–2 (usability
	 * round 4). « Coller » and a tap in the box still focus it.
	 */
	const canFocusBox = () => matchMedia('(pointer: fine) and (min-width: 700px)').matches;

	/** Back from the AI's tab on a computer, nothing pasted yet: the box is ready for Ctrl+V. */
	function onWindowFocus() {
		if (aiOpened && !views.length && !editing && canFocusBox()) box?.focus();
	}

	/** The way in shown on an empty page: a card in a photo (the AI, the box), or a web page's address. */
	let way = $state<'card' | 'web'>('card');
	/**
	 * « Passer par l’IA » after a failed import: the web tab shows the AI's
	 * three steps for the page (a capture or its text), its address kept and
	 * given in the prompt for `source.url` (usability round 5).
	 */
	let aiForPage = $state(false);
	const pageAi = $derived(aiForPage && way === 'web');
	const showWeb = $derived(way === 'web' && !views.length && !aiForPage);
	/** The prompt as given: for a page, with its address (docs/AI-TEMPLATE.md, « A web page through the AI »). */
	const prompt = $derived(pageAi ? pagePrompt(PROMPT, importUrl) : PROMPT);
	/** A tab chosen: the other way, from its start (the web tab's address form). */
	function choose(w: 'card' | 'web') {
		if (w !== way) aiForPage = false;
		way = w;
	}
	/** The tabs' arrow keys (the ARIA tabs pattern): the other tab, selected and focused. */
	function tabKey(e: KeyboardEvent) {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
		e.preventDefault();
		choose(e.key === 'Home' ? 'card' : e.key === 'End' ? 'web' : way === 'card' ? 'web' : 'card');
		tick().then(() => document.getElementById(`tab-${way}`)?.focus());
	}

	function pickPhoto(e: Event & { currentTarget: HTMLInputElement }) {
		const f = e.currentTarget.files?.[0];
		e.currentTarget.value = '';
		if (!f) return;
		if (photoUrl) URL.revokeObjectURL(photoUrl);
		photo = f;
		photoUrl = URL.createObjectURL(f);
		sent = false;
	}

	/** The card's photo is done with (attached, or declined): the next card starts at step 1. */
	function dropPhoto() {
		if (photoUrl) URL.revokeObjectURL(photoUrl);
		photo = null;
		photoUrl = '';
		sent = false;
		offers = [];
	}

	/** "Coller": the clipboard into the box, for the way back from the AI's app (when the browser lets the page read it). */
	async function pasteFromClipboard() {
		let got = '';
		try {
			got = await navigator.clipboard.readText();
		} catch {
			// Refused, or not allowed here: the box itself takes a paste.
			flash(t.add.clipboardRefused, { error: true });
			box?.focus();
			return;
		}
		if (!got.trim()) {
			flash(t.add.clipboardEmpty);
			return;
		}
		text = text.trim() && !replaceNext ? text.trimEnd() + '\n\n' + got : got;
		pastedIn();
	}

	/** An AI answer came into the box: no longer a web import; it folds, free to be checked; the next empty page is the card's tab. */
	function pastedIn() {
		restoredDraft = false;
		textOpen = false;
		typing = false;
		fromWeb = false;
		replaceNext = false;
		way = 'card';
	}

	/**
	 * An imported web page in English: the app's prompt, the translation
	 * request (docs/AI-TEMPLATE.md, "The translation request") and the imported
	 * file, copied in one tap for the AI (the prompt's own path); its answer,
	 * pasted here, replaces the import. No data format change: the answer is an
	 * ordinary French file.
	 */
	const TRANSLATE_ASK = extractTranslation(templateDoc);
	/** « ✓ Copié » on « Copier pour traduire » for 2 s, by file key. */
	let translateCopied = $state('');
	let translateTimer: ReturnType<typeof setTimeout> | undefined;
	async function askTranslation(v: FileView) {
		if (!(await copy(`${PROMPT}\n${TRANSLATE_ASK}\n\n\`\`\`markdown\n${v.text.trimEnd()}\n\`\`\`\n`))) {
			flash(t.add.translateFailed, { error: true });
			return;
		}
		replaceNext = true;
		given();
		translateCopied = v.key;
		clearTimeout(translateTimer);
		translateTimer = setTimeout(() => (translateCopied = ''), 2000);
		flash(t.add.translateCopied);
	}
	/** « Ouvrir Claude ↗ » beside it: the copy made on the same click when it was not yet. */
	function translateOpened(v: FileView) {
		aiOpened = true;
		if (!replaceNext) askTranslation(v);
	}

	// --- the card's photo on the saved recipe -----------------------------------------

	/** One photo to one just-saved recipe: /api/photo, guarded by the hash the save returned. A message when it fails. */
	async function sendPhoto(file: File, slug: string, hash: string): Promise<boolean> {
		if (file.size > PHOTO_MAX_MB * 1024 * 1024) {
			flash(t.photo.tooBig(PHOTO_MAX_MB), { error: true });
			return false;
		}
		const body = new FormData();
		body.set('slug', slug);
		body.set('hash', hash);
		body.set('photo', file);
		try {
			const res = await fetch('/api/photo', { method: 'POST', body });
			if (res.ok) return true;
			const msg = (await res.json().catch(() => null))?.message;
			flash(msg ? `${t.photo.failed} (${msg})` : t.photo.failed, { error: true });
		} catch {
			flash(t.photo.offline, { error: true });
		}
		return false;
	}

	async function attachOffered(i: number) {
		const o = offers[i];
		if (!photo || !o || o.busy || o.done) return;
		offers[i] = { ...o, busy: true };
		const ok = await sendPhoto(photo, o.slug, o.hash);
		offers[i] = { ...o, busy: false, done: ok };
		if (ok) flash(t.add.photoAttached, { links: [{ slug: o.slug, title: o.title }] });
	}

	function pickCardPhoto(v: FileView, e: Event & { currentTarget: HTMLInputElement }) {
		const f = e.currentTarget.files?.[0];
		e.currentTarget.value = '';
		if (!f) return;
		const old = cardPhotos[v.key];
		if (old) URL.revokeObjectURL(old.url);
		cardPhotos = { ...cardPhotos, [v.key]: { file: f, url: URL.createObjectURL(f) } };
	}

	function dropCardPhoto(v: FileView) {
		const old = cardPhotos[v.key];
		if (old) URL.revokeObjectURL(old.url);
		const { [v.key]: _, ...rest } = cardPhotos;
		cardPhotos = rest;
	}

	/**
	 * The photo and the prompt to the AI's app, through the system's share
	 * sheet: the page's own photo object, never uploaded. Called straight from
	 * the tap (a share needs it). When the sheet cannot take them, the prompt
	 * goes to the clipboard and she attaches the photo herself; closing the
	 * sheet is not a failure.
	 */
	async function sendToAi() {
		if (!photo) return;
		const data: ShareData = { files: [photo], text: prompt };
		try {
			if (!navigator.canShare?.(data)) throw new Error('share');
			await navigator.share(data);
			// Step 2 ticked; step 3, the box, is right below: no message over the page.
			promptDone = true;
			sent = true;
			reviewSteps = false;
		} catch (e) {
			if ((e as DOMException)?.name === 'AbortError') return;
			// No clipboard either: the prompt is shown to copy by hand.
			if (await copyPrompt()) flash(t.add.shareFailed, { error: true });
		}
	}

	// --- the same-dish question, and what the save button says ----------------------

	/** The vault recipes this one may be grouped with (same title, close ingredients, a title that starts the same), best first; none when she replaces one. */
	function candidatesOf(v: FileView): PairOffer[] {
		if (v.mode === 'replace' || !v.server) return [];
		return v.server.candidates ?? (v.server.pairWith ? [v.server.pairWith] : []);
	}

	/**
	 * Whether a file asks the same-dish question: a same title, nearly the same
	 * ingredients, or a title that starts the same (`like`, as the form's
	 * « Ressemble à » note offers it). `soft`: only a `like` title, so the save
	 * keeps its own name until she answers (the form never asks it either).
	 */
	function questionOf(v: FileView) {
		const col = v.server?.collision;
		const sameTitle =
			v.diagnostics.some((d) => d.code === 'W608') || (!!col?.existing && fold(stripMarkers(col.existing.title)) === fold(stripMarkers(v.title)));
		const cands = candidatesOf(v);
		// Close ingredients alone ask only when the server offers that recipe as a variant (paste.ts,
		// VARIANT_CLOSE); W505 names the others in the remarks (usability round 5: muffins for a pouding).
		const close = cands.filter((c) => c.why === 'close');
		const soft = !sameTitle && !close.length && cands.length > 0 && cands.every((c) => c.why === 'like');
		return { sameTitle, close, cands, soft, asks: (sameTitle || cands.length > 0) && v.mode !== 'replace' };
	}

	/** "Regrouper avec …" chosen, a group name or its version name still missing: saving now would not group. */
	function groupPending(v: FileView): boolean {
		const c = choices[v.key];
		return !!c?.family && !(familySlugOf(v, c) && c.variant?.trim());
	}

	/** Where this pasted recipe is from, as its variant's label may say it (lib/form/family.ts). */
	function originOf(v: FileView): VariantSource {
		const fm = v.parsed.frontmatter;
		const src = fm && isMap(fm.source) ? fm.source : {};
		const str = (x: unknown) => (typeof x === 'string' ? x : null);
		return { author: str(src.author), source_type: str(src.type), source_title: str(src.title), title: stripMarkers(v.title) };
	}

	/**
	 * Her answer « Regrouper avec … », for a target: the group's name (the
	 * target's group, else the words of the titles), and each side's « Ce qui
	 * distingue » from where it is from, when that tells them apart.
	 */
	function groupWith(v: FileView, target: PairOffer | undefined): Choice {
		const mine = originOf(v);
		const name = (target && groupNameOf(target)) || commonName(v, target);
		return {
			family: true,
			apart: false,
			pairSlug: target?.slug,
			familyName: name,
			variant: choices[v.key]?.variant || variantPrefill(mine, target ? [target.origin] : []),
			pairVariant: target ? (target.variant ? variantShown(target.variant, target.origin) : variantPrefill(target.origin, [mine])) : ''
		};
	}

	/** The name of the group a vault recipe is in, as shown: its label, else as its recipes write it; '' when in none. */
	function groupNameOf(target: PairOffer): string {
		if (!target.family) return '';
		const known = data.families.find((f) => f.slug === target.family);
		return (
			target.familyLabel ??
			known?.label ??
			known?.name ??
			familyNameFromTitles(target.family, [target.title]) ??
			target.family.charAt(0).toUpperCase() + target.family.slice(1).replace(/-/g, ' ')
		);
	}

	/** A group's name for two recipes with no group yet: the shorter title (« Pouding chômeur » for « Pouding chômeur de Tante Aline »), else this one's. */
	function commonName(v: FileView, target: PairOffer | undefined): string {
		const mine = stripMarkers(v.title).trim();
		const theirs = target ? stripMarkers(target.title).trim() : '';
		if (theirs && fold(mine).startsWith(fold(theirs))) return theirs;
		if (theirs && fold(theirs).startsWith(fold(mine))) return mine;
		return theirs && theirs.length < mine.length ? theirs : mine;
	}

	/**
	 * The group's slug from the name she sees: a known group by its name or
	 * slug (accents and case aside), the target's group by its name, else a new
	 * group, the name's slug. She never types a slug.
	 */
	function familySlugOf(v: FileView, c: Choice): string {
		const name = (c.familyName ?? '').trim();
		if (!name) return '';
		const key = fold(name);
		const target = pairOf(v);
		if (target?.family && fold(groupNameOf(target)) === key) return target.family;
		const known = data.families.find((f) => f.slug === slugify(name) || (f.label && fold(f.label) === key) || (f.name && fold(f.name) === key));
		return known?.slug ?? slugify(name);
	}

		// --- the preview's tags, named as the vault names them -----------------------------

	const tagLabels = $derived(new Map(data.tagVocab.canonical.map((c) => [c.tag, c.label])));
	/** Per tag of the pasted recipe: the vault's canonical tag and label (accents and case aside), else the tag as written. */
	function tagViewsOf(tags: readonly string[]): { key: string; label: string }[] {
		return tags.map((tag) => {
			const canonical = tagFor(tagMap, tag);
			if (canonical) return { key: canonical, label: tagLabels.get(canonical) ?? tagLabel(canonical) };
			return { key: tag, label: tagLabel(stripMarkers(tag).replace(/\s+/g, ' ').trim()) };
		});
	}

	// --- what the save button says ------------------------------------------------

	const ready = $derived(views.filter((v) => v.ok));
	const short = (s: string) => {
		const plain = stripMarkers(s).replace(/\s+/g, ' ').trim();
		return plain.length > 34 ? plain.slice(0, 33).trimEnd() + '…' : plain;
	};
	/** The group a file goes into, by its name as she sees it. */
	function familyName(v: FileView, c: Choice): string {
		return familySlugOf(v, c) ? (c.familyName ?? '').trim() : '';
	}
	/**
	 * One file asking the same-dish question: the button says what the save
	 * will do — not answered yet, "Enregistrer sans regrouper"; "Même plat",
	 * "Enregistrer dans « famille »"; "Recette différente", a new recipe.
	 */
	const choiceLabel = $derived.by(() => {
		const q = ready.length === 1 ? questionOf(ready[0]) : null;
		if (!q?.asks) return '';
		const c = choices[ready[0].key];
		if (c?.family) {
			const name = familyName(ready[0], c);
			return name ? t.add.saveInFamily(short(name)) : t.add.saveGrouped;
		}
		// A title that only starts the same: a hint, as in the form; the save keeps its name until she answers.
		if (q.soft && !c?.apart) return '';
		return c?.apart ? t.add.saveNew : t.add.saveApart;
	});
	/** One file, ready, with no step read: the save says so (W401's lines wait above it). */
	const noSteps = $derived(views.length === 1 && ready.length === 1 && ready[0].counts.steps === 0);
	const saveLabel = $derived(
		saving
			? t.add.saving
			: choiceLabel ||
					(noSteps
						? t.add.saveNoSteps
						: ready.length === 1
							? t.add.saveOne(short(ready[0].title))
							: ready.length > 1
								? t.add.saveMany(ready.length)
								: t.add.save)
	);
	/** A phone: short, but still the answer to the question when there is one. */
	const briefLabel = $derived(
		saving ? t.add.saving : choiceLabel || (noSteps ? t.add.saveNoSteps : ready.length > 1 ? `${t.add.save} (${ready.length})` : t.add.save)
	);
	/** Why the button is off, or what it leaves behind: said beside it. */
	const saveNote = $derived.by(() => {
		if (naming.length) return t.add.needVariant;
		const held = views.length - ready.length;
		if (!held) return '';
		if (!ready.length) {
			// As many as the cards list (an E203 beside its E204 once, E002's next ones in).
			const n = views.reduce((sum, v) => sum + v.errorCount, 0);
			return n ? t.add.blocked(n) : '';
		}
		return t.add.heldBack(held);
	});
	/** All pasted files pass: the box can give its room to the result. */
	const allOk = $derived(views.length > 0 && ready.length === views.length);
	/** The pasted text folded to a one-line summary: everything passes and she did not ask for it. */
	const folded = $derived(allOk && !textOpen);
	$effect(() => {
		if (text.trim()) return;
		textOpen = false;
		fromWeb = false;
		replaceNext = false;
	});
	/**
	 * The steps of the main path, ticked as they are done: the prompt only once
	 * it was copied, shared or Claude opened in this visit. An imported web
	 * page has its own two: the page read, then checked.
	 */
	const progress = $derived(
		fromWeb
			? [
					{ label: t.add.progressWeb[0], done: true },
					{ label: t.add.progressWeb[1], done: allOk }
				]
			: [
					{ label: promptDone || aiOpened ? t.add.progressPromptDone : t.add.progress[0], done: promptDone || aiOpened },
					{ label: t.add.progress[1], done: views.length > 0 },
					{ label: t.add.progress[2], done: allOk }
				]
	);
	/** A web page in English in the box: its card's « Copier pour traduire » leads, the save is not the main button. */
	const englishImport = $derived(fromWeb && views.some((v) => v.parsed.frontmatter?.lang === 'en'));
	/** « 2 étapes », or, none read, « 3 lignes hors Préparation » (what W401's fix would make steps). */
	const countLine = (v: FileView) => (v.counts.steps === 0 && v.counts.outside ? t.add.outsideSteps(v.counts.outside) : t.add.stepsN(v.counts.steps));
	/** Some file has an error to settle: the text is the place to work in, it gets the room. */
	const anyErrors = $derived(views.some((v) => v.blocking > 0));

	// --- the save bar ---------------------------------------------------------------
	//
	// At the foot of the file's card (one file) or of the files (several), held at
	// the bottom of the screen while the card is in view (CSS sticky): always in
	// reach, never in a jump. In its own place at the card's end it takes room of
	// its own, so it never sits over the card's last line; focus and "Montrer"
	// scroll clear of it (scroll-padding).

	// --- a problem, shown in the pasted text ---------------------------------------

	/**
	 * Where each file starts in the box. Offsets hold only when the box's text
	 * is already what the checker read (NFC, LF): otherwise nothing is shown.
	 */
	const fileStarts = $derived.by(() => {
		if (normalizeText(text) !== text) return files.map(() => -1);
		let from = 0;
		return files.map((f) => {
			const body = f.trimEnd();
			const at = text.indexOf(body, from);
			if (at !== -1) from = at + body.length;
			return at;
		});
	});

	function showFor(v: FileView, k: number): (() => void) | undefined {
		const span = v.spans[k];
		const base = fileStarts[v.index];
		if (!span || base === undefined || base < 0) return undefined;
		return () => showInText(base + span.start, base + span.end);
	}

	/** Select a span of the box and scroll it into view, the box too (unfolded first). */
	async function showInText(start: number, end: number) {
		if (!textOpen) {
			textOpen = true;
			await tick();
		}
		if (!box) return;
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
		box.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
		box.focus({ preventScroll: true });
		box.setSelectionRange(start, end);
		scrollBoxTo(box, start);
	}

	/**
	 * The box scrolled to a character: its line about a third down, the top
	 * line whole (the scroll is a whole number of lines, so no line shows cut
	 * in half). The lines wrap: the mirror counts the wrapped ones.
	 */
	function scrollBoxTo(area: HTMLTextAreaElement, offset: number) {
		const at = placeIn(area, offset);
		const line = parseFloat(getComputedStyle(area).lineHeight) || 20;
		const pad = parseFloat(getComputedStyle(area).paddingTop) || 0;
		const above = Math.max(0, Math.floor((at.top - pad - area.clientHeight / 3) / line));
		// The box's top padding scrolls with its text: past it, the top line sits flush with the edge (no sliver of the one before).
		const most = Math.floor(Math.max(0, area.scrollHeight - area.clientHeight - pad) / line);
		const k = Math.min(above, most);
		area.scrollTop = k > 0 ? pad + k * line : 0;
	}

	function topOf(area: HTMLTextAreaElement, offset: number): number {
		return placeIn(area, offset).top;
	}

	/** Where a character sits in a textarea's content, wrapped lines counted when it wraps: a hidden copy of the box measures it. */
	function placeIn(area: HTMLTextAreaElement, offset: number): { top: number; left: number } {
		const cs = getComputedStyle(area);
		const mirror = document.createElement('div');
		for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordSpacing', 'tabSize', 'paddingTop', 'paddingLeft', 'paddingRight'] as const)
			mirror.style[p] = cs[p];
		Object.assign(mirror.style, {
			position: 'absolute',
			visibility: 'hidden',
			top: '0',
			left: '-9999px',
			boxSizing: 'content-box',
			width: `${area.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)}px`,
			// The box's own wrapping (soft: a long line wraps at the box's width).
			whiteSpace: cs.whiteSpace,
			overflowWrap: cs.overflowWrap,
			wordBreak: cs.wordBreak
		});
		mirror.textContent = area.value.slice(0, offset);
		const mark = document.createElement('span');
		mark.textContent = '\u200b';
		mirror.appendChild(mark);
		document.body.appendChild(mirror);
		const at = { top: mark.offsetTop, left: mark.offsetLeft };
		mirror.remove();
		return at;
	}

	// --- the errors marked in the box's margin -------------------------------------

	/** Where each error sits in the box (offsets in the whole text), in the order they are listed. */
	const errorSpans = $derived(
		views.flatMap((v) => {
			const base = fileStarts[v.index];
			if (base === undefined || base < 0) return [];
			return v.diagnostics.flatMap((d, k) => (d.severity === 'error' && v.spans[k] ? [{ start: base + v.spans[k]!.start, end: base + v.spans[k]!.end }] : []));
		})
	);
	/** The first error, by what it is: a new one is scrolled to once. */
	const firstErrorKey = $derived.by(() => {
		for (const v of views) {
			const d = v.diagnostics.find((x, k) => x.severity === 'error' && v.spans[k]);
			if (d) return `${v.key}|${d.code}|${d.path}`;
		}
		return '';
	});
	/** The marks, in the box's content coordinates (padding included); drawn less its scroll. */
	let marks = $state<{ top: number; height: number }[]>([]);
	let boxScroll = $state(0);
	/** Bumped when the box changes width (its lines wrap again). */
	let boxWidth = $state(0);
	const MAX_MARKS = 20;

	$effect(() => {
		const spans = errorSpans.slice(0, MAX_MARKS);
		void boxWidth;
		void folded;
		if (!box || !spans.length || folded) {
			marks = [];
			return;
		}
		const area = box;
		const line = parseFloat(getComputedStyle(area).lineHeight) || 20;
		marks = spans.map((sp) => {
			const top = topOf(area, sp.start);
			return { top, height: Math.max(line, topOf(area, sp.end) - top + line) };
		});
	});

	/**
	 * On a first validation with errors (a paste, an import), the box scrolls to
	 * the first one's line, marked in its margin; not while she types in it
	 * (a paste into the box is no typing).
	 * "Montrer dans le texte" stays for the others.
	 */
	let scrolledFor = '';
	$effect(() => {
		const key = firstErrorKey;
		if (key === scrolledFor) return;
		scrolledFor = key;
		const first = untrack(() => errorSpans[0]);
		if (!key || !first || !box || (typing && document.activeElement === box)) return;
		const area = box;
		tick().then(() => scrollBoxTo(area, first.start));
	});

	async function copyFixBlock() {
		const failed = needAi.map((v) => ({ text: v.text, diagnostics: v.diagnostics }));
		const passed = [...savedTitles, ...views.filter((v) => !needAi.includes(v)).map((v) => v.title)];
		if (!(await copy(renderFixBlock(failed, passed, { spec: PROMPT })))) {
			flash(t.add.translateFailed, { error: true });
			return;
		}
		flash(t.add.fixCopied);
		// Codes only, never content: which prompt rules the AI breaks.
		fetch('/api/pastelog', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				files: needAi.map((v) => {
					const fm = parseRecipe(v.text).frontmatter;
					return { codes: v.diagnostics.map((d) => d.code), slug: fm ? fileSlug(fm) : undefined };
				})
			})
		}).catch(() => {});
	}

	/** Rebuild the box from the files left to deal with; choices and stale flags follow their files. */
	function keepOnly(indices: number[], stale: Map<string, string>) {
		const left = indices.map((i) => files[i]);
		const oldKeys = indices.map((i) => keys[i]);
		const newKeys = keysOf(left);
		text = left.length === 0 ? '' : left.length === 1 && !split.files.length ? left[0] : left.map((f) => '```markdown\n' + f.trimEnd() + '\n```').join('\n\n') + '\n';
		const next: typeof choices = {};
		const nextStale = new Map<string, string>();
		const nextPhotos: typeof cardPhotos = {};
		oldKeys.forEach((old, i) => {
			if (choices[old]) next[newKeys[i]] = choices[old];
			const why = stale.get(old);
			if (why) nextStale.set(newKeys[i], why);
			if (cardPhotos[old]) nextPhotos[newKeys[i]] = cardPhotos[old];
		});
		for (const [k, p] of Object.entries(cardPhotos)) if (!oldKeys.includes(k)) URL.revokeObjectURL(p.url);
		choices = next;
		staleFiles = nextStale;
		cardPhotos = nextPhotos;
	}

	async function saveAll() {
		if (!canSave) return;
		saving = true;
		const sending = views.filter((v) => v.ok);
		const payload = sending.map((v) => {
			const c = choices[v.key] ?? {};
			const f: SaveFile = { text: v.text };
			const col = v.server?.collision;
			if (v.mode === 'replace' && col?.existing) f.overwrite = col.existing.hash;
			if (v.mode === 'suffix' && col) f.slug = col.suggested;
			const familySlug = c.family ? familySlugOf(v, c) : '';
			if (familySlug && c.variant?.trim()) {
				f.family = { family: familySlug, variant: c.variant.trim() };
				// Both in the family, one commit (as the form and /doublons): the other recipe as she saw it.
				const other = pairOf(v);
				const pv = (c.pairVariant ?? other?.variant ?? '').trim();
				if (other && pv) f.family.pair = { slug: other.slug, hash: other.hash, variant: pv };
			}
			return f;
		});
		// The files still to fix are part of this save attempt too: their codes go
		// to the paste log (never their content).
		const unsent = views.filter((v) => !v.ok).map((v) => ({ codes: v.diagnostics.map((d) => d.code), slug: slugIn(v.text) }));
		try {
			const res = await fetch('/api/save', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ files: payload, unsent })
			});
			if (!res.ok) {
				const msg = (await res.json().catch(() => null))?.message ?? res.statusText;
				flash(`${t.add.error} ${msg}`, { error: true });
				return;
			}
			const result: SaveResult = await res.json();
			const saved = result.files.flatMap((r) => (r.status === 'saved' ? [{ slug: r.slug, title: r.title }] : []));
			const refused = result.files.filter((r) => r.status !== 'saved').length;
			const stale = new Map<string, string>();
			result.files.forEach((r, k) => {
				if (r.status !== 'stale') return;
				const other = pairOf(sending[k]);
				stale.set(sending[k].key, r.pair ? t.add.pairRefused(r.pair.reason, other?.slug === r.pair.slug ? other.title : r.pair.slug) : t.add.stale);
			});
			savedTitles = [...savedTitles, ...saved.map((s) => s.title)];
			// The card's photo, picked on its card: on the recipe right after its save.
			let attached = 0;
			const fresh: typeof offers = [];
			for (const [k, r] of result.files.entries()) {
				if (r.status !== 'saved' || !r.hash) continue;
				const mine = cardPhotos[sending[k].key];
				if (mine) {
					if (await sendPhoto(mine.file, r.slug, r.hash)) attached++;
				} else if (photo) fresh.push({ slug: r.slug, title: r.title, hash: r.hash });
			}
			// The photo sent to the AI: offered to what was just saved, one tap.
			if (fresh.length) offers = fresh;
			const savedIdx = new Set(result.files.flatMap((r, k) => (r.status === 'saved' ? [sending[k].index] : [])));
			keepOnly(
				files.map((_, i) => i).filter((i) => !savedIdx.has(i)),
				stale
			);
			// What was saved: the card at the top, with the way to it (no message at the bottom).
			if (saved.length) {
				justSaved = saved;
				savedFor = text;
				fixLog = [];
			}
			const note = [attached ? t.add.photosAttached(attached) : '', refused ? t.add.notSaved(refused) : ''].filter(Boolean).join(' ') || undefined;
			if (result.indexError) flash(t.add.indexError, { note, error: true });
			else if (note) flash(note, { error: !saved.length || refused > 0 });
			// The server judged again: check again, so a collision or an error it
			// found shows here with its choice.
			recheck++;
			await tick();
			// The box keeps the keyboard (Ctrl+V, the next one); the card says what was saved, in view.
			if (canFocusBox()) box?.focus({ preventScroll: true });
			if (saved.length) document.querySelector('.saved-card')?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
		} catch (e) {
			flash(`${t.add.error} ${(e as Error).message}`, { error: true });
		} finally {
			saving = false;
		}
	}

	/** An address as she typed it: `www.site.ca/…` or `site.ca/…` gets its `https://`. */
	function withScheme(raw: string): string {
		const v = raw.trim();
		return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) || !/^[\w-]+(\.[\w-]+)+(?:[/:?#]|$)/.test(v) ? v : `https://${v}`;
	}

	async function doImport(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
		e.preventDefault();
		if (importing) return;
		// The field as it is now (an autofill may not have told the page).
		const raw = String(new FormData(e.currentTarget).get('url') ?? importUrl);
		const url = withScheme(raw);
		if (!url) {
			document.getElementById('import-url')?.focus();
			return;
		}
		importUrl = url;
		importError = null;
		importing = true;
		try {
			const res = await fetch('/api/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				importError = { message: body.error ?? body.message ?? res.statusText, kind: body.kind ?? 'other' };
				return;
			}
			text = '```markdown\n' + body.markdown + '```\n';
			restoredDraft = false;
			textOpen = false;
			typing = false;
			choices = {};
			staleFiles = new Map();
			importUrl = '';
			// The web tab stays chosen: once this one is saved, the next address.
			fromWeb = true;
			replaceNext = false;
			flash(t.add.imported);
		} catch {
			importError = { message: t.add.importOffline, kind: 'other' };
		} finally {
			importing = false;
		}
	}

	/** « Voir le prompt » beside « Passer par l'IA »: the page's AI steps, the prompt open and in view. */
	function seePrompt() {
		importViaAi();
		peekOpen = true;
		tick().then(() => {
			const peek = [...document.querySelectorAll<HTMLElement>('details.peek')].find((x) => x.offsetParent !== null);
			peek?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
			peek?.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
		});
	}

	/** "Passer par l'IA": on the web tab, the AI's three steps for this page (a capture or its text), its address kept. */
	function importViaAi() {
		importError = null;
		aiForPage = true;
		reviewSteps = true;
		tick().then(() => document.getElementById('tab-web')?.focus());
	}

	/** Ctrl+Enter saves from anywhere on the page, the text folded or not. */
	function onKey(e: KeyboardEvent) {
		if (editing || e.defaultPrevented) return;
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			saveAll();
		}
	}

	/**
	 * Typing in the box keeps it open: an edit that follows a key press there
	 * (a phone's keyboard too). A paste (a shortcut, the menu), a drop, or a
	 * text put in by anything else (an autofill, a script) leaves it free to
	 * fold, as an import does.
	 */
	let keyed = false;
	/** The last change to the box was her typing (not a paste, a drop, an import): the box is not scrolled under her caret. */
	let typing = false;
	function onBoxKey(e: KeyboardEvent) {
		keyed = !(e.ctrlKey || e.metaKey);
	}
	function onBoxInput(e: Event) {
		const kind = (e as InputEvent).inputType ?? '';
		typing = keyed && !/^insertFrom(Paste|Drop)/.test(kind);
		if (typing) textOpen = true;
		keyed = false;
	}

	/**
	 * A paste anywhere on the page goes in the box (added after what is there),
	 * except into another field. A paste into the box itself folds it too.
	 */
	function onPaste(e: ClipboardEvent) {
		if (editing) return;
		const target = e.target instanceof Element ? e.target : null;
		if (target === box && !replaceNext) {
			textOpen = false;
			fromWeb = false;
			return;
		}
		if (target !== box && target?.closest('input, textarea, select, [contenteditable]')) return;
		const pasted = e.clipboardData?.getData('text/plain');
		if (!pasted?.trim()) return;
		e.preventDefault();
		text = text.trim() && !replaceNext ? text.trimEnd() + '\n\n' + pasted : pasted;
		pastedIn();
	}

	/** « Modifier le texte »: the box opens, in view, focused at its start (a phone's keyboard too: she asked for it). */
	async function openText() {
		textOpen = true;
		await tick();
		if (!box) return;
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
		box.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
		box.focus({ preventScroll: true });
		box.setSelectionRange(0, 0);
		box.scrollTop = 0;
	}

	/** "Corrigez N erreurs pour enregistrer": to the first error, its line in view and focused. */
	function toFirstError() {
		const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (naming.length) {
			// The version name she started to give, to finish it.
			const field = document.querySelector<HTMLInputElement>('.family-fields input[data-variant]');
			field?.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
			field?.focus({ preventScroll: true });
			return;
		}
		const item = document.querySelector<HTMLElement>('.file.bad .diag.error .diag-item');
		if (!item) return;
		// The fix first (the save bar never covers it: scroll-margin), else "Montrer dans le texte".
		// Its one primary answer (« Écrire cup ») before anything else in the fix; never a hidden field.
		const target =
			item.querySelector<HTMLElement>('.quickfix button.primary') ??
			item.querySelector<HTMLElement>('.quickfix input:not([type="hidden"]), .quickfix button, .quickfix select, button.show, summary') ??
			item;
		(item.querySelector<HTMLElement>('.actions') ?? item).scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
		target.focus({ preventScroll: true });
	}

	// --- a quick fix for a value from a closed list ---------------------------------

	interface QuickFix {
		/** The value as written. */
		value: string;
		/** Where it sits in the file: this problem's place first, then the same value's other places (E201). */
		spans: Span[];
		options: { value: string; label: string }[];
		/** The one answer the vocabulary gives, preselected; '' when she must choose. */
		selected: string;
		/**
		 * 'alias': a unit the alias table knows (`tasse` → cup), one tap, the list
		 * behind "Autre unité…"; 'tag': an unknown tag, « Utiliser » the same word
		 * when there is one (`selected`), « Garder » always; 'pick': the closed list.
		 */
		kind: 'alias' | 'tag' | 'pick';
		/** E201: a unit's code is written; the flash says so, with the word the app shows. */
		unit?: Lang;
	}

	/** The vault's tags, folded alias → canonical (W501's own lookup). */
	const tagMap = $derived(new Map(data.tagVocab.tags));

	const unitOption = (u: Unit, lang: Lang) => {
		const word = unitWord(u, 1, lang);
		return word === u ? u : `${word} (${u})`;
	};

	/**
	 * E201 (an unknown unit) and W501 (an unknown tag): the value is replaced in
	 * the pasted text, in place, by one she picks from the closed list — or in
	 * one tap when there is one answer (a unit alias, a tag's accents). Only
	 * when the path names one scalar exactly and the box's offsets hold
	 * (docs/VALIDATION.md, "Quick fixes in the paste box"). `same`: the other
	 * diagnostics with the same value, for "Remplacer partout".
	 */
	function quickFixFor(v: FileView, d: Diagnostic, same: number[] = []): QuickFix | null {
		if (d.code !== 'E201' && d.code !== 'W501') return null;
		if ((fileStarts[v.index] ?? -1) < 0) return null;
		const span = scalarAt(v.text, d.path);
		const value = valueAt(v.parsed.frontmatter, d.path);
		if (!span || !value) return null;
		if (d.code === 'E201') {
			const lang: Lang = v.parsed.frontmatter?.lang === 'en' ? 'en' : 'fr';
			const others = same.flatMap((k) => {
				const sp = scalarAt(v.text, v.diagnostics[k].path);
				return sp ? [sp] : [];
			});
			const alias = unitForAlias(value, lang) ?? '';
			return {
				value,
				spans: [span, ...others],
				selected: alias,
				kind: alias ? 'alias' : 'pick',
				unit: lang,
				options: data.units.map((u) => ({ value: u, label: unitOption(u, lang) }))
			};
		}
		// W501, one pattern (docs/VALIDATION.md): « Utiliser » only for the same word (its accents in the
		// recipe's own text, or a known tag but for its ending or a typo, never a course for a food);
		// « Garder » always.
		const near = tagSuggestion(v, value);
		return {
			value,
			spans: [span],
			selected: near ?? '',
			kind: 'tag',
			options: near ? [{ value: near, label: tagLabels.get(near) ?? tagLabel(near) }] : []
		};
	}

	/**
	 * The tag to offer for an unknown one, or undefined: its accents as the
	 * recipe's own text writes it (`erable` → `érable`), else the known tag
	 * the server found to be the same word (lib/vault/tagmatch.ts, a food
	 * matched on its ending only), else, before the server answers, the same
	 * rule without the food test. Nothing once she kept it.
	 */
	function tagSuggestion(v: FileView, value: string): string | undefined {
		if (keptTags.includes(`${v.key}|${value}`)) return undefined;
		const accented = withAccents(value, v.text);
		if (accented) return accented;
		const fromServer = server?.tags[value];
		if (fromServer !== undefined) return fromServer ?? undefined;
		return preselectTag(tagMap, value, { food: true });
	}

	/** The sentence a W501 says in the paste box: the same word offered, else a new tag kept, waiting in Étiquettes. */
	function sayFor(v: FileView, d: Diagnostic): string | undefined {
		if (d.code === 'W305' || d.code === 'W303') return resemblesSay(v, d);
		if (d.code !== 'W501') return undefined;
		const value = valueAt(v.parsed.frontmatter, d.path);
		if (!value) return undefined;
		const label = tagLabel(stripMarkers(value).replace(/\s+/g, ' ').trim());
		if (keptTags.includes(`${v.key}|${value}`)) return pasteText.tagKept(label);
		const near = tagSuggestion(v, value);
		if (!near) return pasteText.newTag(label);
		return pasteText.tagAccent(label, tagLabels.get(near) ?? tagLabel(near));
	}

	/** New tags she keeps as written ("Garder « Erable »"), by file key and value: the accented one is no longer offered. */
	let keptTags = $state<string[]>([]);
	function keepTag(v: FileView, value: string) {
		keptTags = [...keptTags, `${v.key}|${value}`];
	}

	/** Replace the value at its place (`all`: at each of its places), last first so the offsets hold. */
	function applyFix(v: FileView, fix: QuickFix, to: string, all = false) {
		const base = fileStarts[v.index];
		if (!to || base === undefined || base < 0) return;
		const spans = [...(all ? fix.spans : fix.spans.slice(0, 1))].sort((a, b) => b.start - a.start);
		const before = text;
		let next = text;
		for (const sp of spans) next = next.slice(0, base + sp.start) + yamlScalar(to) + next.slice(base + sp.end);
		text = next;
		// A unit: what was written, and what the app shows for it.
		const label = fix.options.find((o) => o.value === to)?.label ?? to;
		fixed(
			v,
			before,
			fix.unit
				? t.add.unitWritten(to, unitWord(to as Unit, 1, fix.unit), spans.length)
				: spans.length > 1
					? t.add.quickFixedAll(fix.value, label, spans.length)
					: t.add.quickFixed(fix.value, label)
		);
	}

	// --- the fixes for codes without a closed list (E002, E101, E110, E204, W302, W401) --

	/** The box's offsets hold for this file (its text NFC and LF): a fix can be written in place. */
	const canEdit = (v: FileView) => (fileStarts[v.index] ?? -1) >= 0;

	function codeFixLabel(v: FileView, cf: CodeFix): string {
		switch (cf.kind) {
			case 'realign':
				return t.add.realign(boxLine(v, cf.fix.edits[0].start));
			case 'schema':
				return t.add.schemaAdd;
			case 'split':
				return t.add.split(cf.qty.replace(/"/g, ''), unitWord(cf.unit, 1, v.parsed.frontmatter?.lang === 'en' ? 'en' : 'fr'));
			case 'nameSplit':
				return t.add.nameSplit(`${cf.qty.replace(/"/g, '')} ${unitWord(cf.unit, Number(cf.qty) || 1, v.parsed.frontmatter?.lang === 'en' ? 'en' : 'fr')}`, stripMarkers(cf.name));
			case 'method':
				return t.add.methodFix(cf.steps);
			case 'steps':
				return t.add.stepsFix(cf.steps);
			case 'entry':
				return t.add.entryRead(cf.text);
			case 'prep':
				return t.add.prepSplit(cf.name, cf.prep);
			case 'duration':
				return t.add.durationWrite(cf.value);
			default:
				return '';
		}
	}

	/** A file's line, counted in the whole box (what she sees), from its offset in the file. */
	function boxLine(v: FileView, offset: number): number {
		const base = fileStarts[v.index] ?? -1;
		// Offsets that do not hold (the box not yet NFC/LF): the line in the file.
		return base < 0 ? normalizeText(v.text).slice(0, offset).split('\n').length : text.slice(0, base + offset).split('\n').length;
	}

	/**
	 * The quick fixes made in this paste, in order: one line above the files,
	 * « ✓ 2 corrections faites · Annuler la dernière » — never a row left in
	 * the list nor a message over the save bar. « Annuler la dernière » puts
	 * the text back as it was before the last one, as long as nothing else
	 * changed it since (docs/VALIDATION.md, "Quick fixes in the paste box").
	 */
	let fixLog = $state<{ message: string; before: string; after: string }[]>([]);
	const lastFix = $derived(fixLog.at(-1));
	const canUndoFix = $derived(!!lastFix && lastFix.after === text);
	function fixed(_v: FileView, before: string, message: string) {
		fixLog = [...fixLog, { message, before, after: text }];
	}
	function undoLastFix() {
		const last = fixLog.at(-1);
		if (!last || text !== last.after) return;
		text = last.before;
		fixLog = fixLog.slice(0, -1);
	}
	// An emptied box (a save, « Recommencer », a new import): the count starts again.
	$effect(() => {
		if (!text.trim()) untrack(() => fixLog.length) && (fixLog = []);
	});

	/** Write a fix's edits into the box; the text is checked again like any edit. */
	function applyCodeFix(v: FileView, fix: Fix, message: string) {
		const base = fileStarts[v.index];
		if (base === undefined || base < 0) return;
		const before = text;
		text = applyEdits(text, fix.edits, base);
		fixed(v, before, message);
	}

	/**
	 * A row « à revérifier » (found in E002's realigned text), fixed: the line
	 * realigned first, then the fix, made in that realigned text, in one tap.
	 */
	function applyLaterFix(v: FileView, fix: Fix, message: string) {
		const base = fileStarts[v.index];
		const realign = v.trouble?.realign?.fix;
		if (base === undefined || base < 0 || !realign) return;
		const before = text;
		text = applyEdits(applyEdits(text, realign.edits, base), fix.edits, base);
		fixed(v, before, message);
	}

	/**
	 * The fix for a row « à revérifier », made in the realigned text: a unit
	 * the alias table knows (« Écrire cup », at each of its places), or one of
	 * the code fixes (a quantity split, the version, the steps' heading).
	 */
	function laterFixOf(v: FileView, d: Diagnostic): { label: string; fix: Fix; message: string } | null {
		const later = v.later;
		if (!later || !canEdit(v)) return null;
		const lang: Lang = later.parsed.frontmatter?.lang === 'en' ? 'en' : 'fr';
		if (d.code === 'E201') {
			const value = valueAt(later.parsed.frontmatter, d.path);
			const unit = value ? unitForAlias(value, lang) : undefined;
			if (!value || !unit) return null;
			const spans = later.ds
				.filter((x) => x.code === 'E201' && valueAt(later.parsed.frontmatter, x.path) === value)
				.flatMap((x) => {
					const sp = scalarAt(later.text, x.path);
					return sp ? [sp] : [];
				});
			if (!spans.length) return null;
			const edits = spans.map((sp) => ({ start: sp.start, end: sp.end, text: yamlScalar(unit) }));
			return { label: t.add.quickFixWrite(unit), fix: { edits, result: applyEdits(later.text, edits) }, message: t.add.unitWritten(unit, unitWord(unit, 1, lang), spans.length) };
		}
		if (!FIXED_CODES.has(d.code) || d.code === 'E002') return null;
		const cf = codeFixOf(later.text, d, lang, null);
		if (!cf || !('fix' in cf)) return null;
		return { label: codeFixLabel(v, cf), fix: cf.fix, message: codeFixMessage(v, cf) };
	}

	function codeFixMessage(v: FileView, cf: CodeFix): string {
		switch (cf.kind) {
			case 'realign':
				return t.add.realigned(boxLine(v, cf.fix.edits[0].start));
			case 'schema':
				return t.add.schemaAdded;
			case 'split':
			case 'nameSplit':
				return t.add.splitDone(cf.qty.replace(/"/g, ''), cf.unit, unitWord(cf.unit, 1, v.parsed.frontmatter?.lang === 'en' ? 'en' : 'fr'));
			case 'method':
				return t.add.methodDone(cf.steps);
			case 'steps':
				return t.add.stepsDone(cf.steps);
			case 'entry':
				return t.add.entryDone(cf.text);
			case 'prep':
				return t.add.prepDone(cf.prep);
			case 'duration':
				return t.add.durationDone(cf.value);
			default:
				return '';
		}
	}

	function addTitle(v: FileView, e: SubmitEvent & { currentTarget: HTMLFormElement }) {
		e.preventDefault();
		const value = String(new FormData(e.currentTarget).get('title') ?? '').trim();
		const fix = value ? titleFix(v.text, value) : null;
		if (!fix) {
			flash(t.add.titleRefused, { error: true });
			return;
		}
		applyCodeFix(v, fix, t.add.titleAdded(value));
	}

	/** E002: once the line is realigned, what the checker will say — listed now, so one round is enough. */
	const laterOf = (v: FileView) => v.later;

	/** W305 with the known ingredient it resembles, named (the registry's names, from the server check). */
	function resemblesSay(v: FileView, d: Diagnostic): string | undefined {
		const value = valueAt(v.parsed.frontmatter, d.path);
		const many = ambiguous(d);
		// The resolve queue's own suggestions, in its order (lib/ingredients/resolve.ts candidates,
		// shownCandidates): what /resoudre offers for this name, never a list of its own.
		const slugs = resemblesSlugs(d);
		if (!value) return undefined;
		if (d.code === 'W303' || !slugs.length) return pasteText.notLinked(value);
		const [open, close] = t.app.quotes;
		const names = slugs.map((s) => `${open}${server?.names[s] ?? s}${close}`);
		return many ? pasteText.resemblesMany(value, names.join(', ')) : pasteText.resembles(value, names);
	}

	/**
	 * The errors of a file, one entry per problem: an unknown unit written on
	 * several lines is one problem, said once with its other places
	 * ("Remplacer partout"). The count in "Erreurs (N)" stays per line
	 * (`errorCount`).
	 */
	function errorItems(v: FileView): { d: Diagnostic; k: number; same: number[] }[] {
		const out: { d: Diagnostic; k: number; same: number[] }[] = [];
		const byUnit = new Map<string, { d: Diagnostic; k: number; same: number[] }>();
		v.diagnostics.forEach((d, k) => {
			if (d.severity !== 'error') return;
			// Settled here: a collision answered above, an E203 its E204 says.
			if ((d.code === 'E103' && v.mode) || mergedE203(v.diagnostics, d)) return;
			const value = d.code === 'E201' ? valueAt(v.parsed.frontmatter, d.path) : undefined;
			const first = value ? byUnit.get(value) : undefined;
			if (first) {
				first.same.push(k);
				return;
			}
			const item = { d, k, same: [] as number[] };
			if (value) byUnit.set(value, item);
			out.push(item);
		});
		return out;
	}

	function setChoice(key: string, patch: Choice) {
		choices = { ...choices, [key]: { ...choices[key], ...patch } };
	}

	/** Why a recipe is asked about, with its ingredients in common when known (« presque les mêmes ingrédients · 82 % en commun », as /doublons says it). */
	function whyOf(c: PairOffer): string {
		const why = t.add.whyAsked[c.why];
		return c.score !== undefined ? `${why} · ${t.duplicates.score(Math.round(c.score * 100))}` : why;
	}

	/**
	 * The vault recipe « Regrouper avec … » puts in the group too: the one she
	 * picked, else the only candidate; none when she replaces a recipe, nor
	 * among several until she picks one — never one picked for her (usability
	 * round 5: the first radio came checked).
	 */
	function pairOf(v: FileView): PairOffer | undefined {
		const list = candidatesOf(v);
		const slug = choices[v.key]?.pairSlug;
		return list.find((c) => c.slug === slug) ?? (list.length === 1 ? list[0] : undefined);
	}

	$effect(() => {
		const area = box;
		if (!area || typeof ResizeObserver === 'undefined') return;
		const ro = new ResizeObserver(() => (boxWidth = area.clientWidth));
		ro.observe(area);
		return () => ro.disconnect();
	});

	onMount(() => {
		try {
			promptGiven = localStorage.getItem(GIVEN) === '1';
		} catch {
			// no storage: the steps start open
		}
		canReadClip = typeof navigator.clipboard?.readText === 'function';
		coarse = matchMedia('(pointer: coarse)').matches;
		try {
			const kept = sessionStorage.getItem(KEPT);
			if (kept && !text) {
				text = kept;
				restoredDraft = true;
			}
		} catch {
			// nothing kept
		}
		restored = true;
		try {
			const probe = new File([new Uint8Array(1)], 'fiche.jpg', { type: 'image/jpeg' });
			canSharePhoto = matchMedia('(pointer: coarse)').matches && !!navigator.canShare?.({ files: [probe], text: 'prompt' });
		} catch {
			// no Web Share: the prompt is copied, the photo given by hand
		}
		canShareText = coarse && typeof navigator.share === 'function';
		// No keyboard popping up on a phone or a tablet: focus only with a mouse, on a wide screen.
		if (canFocusBox()) box?.focus();
		// `?recette=N` with nothing to open (a new tab, a file since fixed away): the list,
		// and no address that would open the form under a later paste.
		tick().then(() => {
			if (page.url.searchParams.has('recette') && !editing) goto('/ajouter', { replaceState: true });
		});
		return () => {
			if (photoUrl) URL.revokeObjectURL(photoUrl);
			for (const p of Object.values(cardPhotos)) URL.revokeObjectURL(p.url);
		};
	});
</script>

<svelte:head><title>{t.add.title}</title></svelte:head>
<svelte:window onkeydown={onKey} onpaste={onPaste} onfocus={onWindowFocus} />

{#if editing}
	{@const v = editing.view}
	{#key v.key}
		<RecipeForm
			data={{ ...data, form: editing.form, slug: null, hash: null, photo: null }}
			paste={{ draftKey: draftKey(`:collage:${v.key}`), onback: backToList, onsaved: (slug) => savedFromForm(v, slug) }}
		/>
	{/key}
{:else}
<PageHead title={t.add.title} actions={views.length ? undefined : handWay} />
<!-- The third way in, beside the title: her form. -->
{#snippet handWay()}
	<a class="hand" href="/nouvelle">{t.add.wayHand}<span aria-hidden="true">→</span></a>
{/snippet}

{#snippet promptButton(primary: boolean)}
	<!-- « Copier le prompt »; « ✓ Copié » for 2 s; then « Copier à nouveau », step 1 ticked. -->
	<button class="btn copy" class:primary={primary && !promptDone} class:done={copiedNow} type="button" onclick={copyPrompt}>
		{#if copiedNow}<span class="tick" aria-hidden="true">✓</span>{t.add.copied}{:else if promptDone}{t.add.copyAgain}{:else}{t.add.copyPrompt}{/if}
	</button>
	<span class="visually-hidden" role="status">{copiedNow ? t.add.promptCopied : ''}</span>
{/snippet}

<!-- « Voir le prompt »: the prompt itself, readonly; opened and selected when the copy cannot be made (plain http, no clipboard). -->
{#snippet promptPeek(i: number)}
	<details class="peek" bind:open={peekOpen}>
		<summary>{t.add.showPrompt}</summary>
		{#if copyFailed}<p class="manual" role="alert">{t.add.copyManual}</p>{/if}
		<textarea
			class="peek-box"
			bind:this={peekBoxes[i]}
			readonly
			rows="8"
			spellcheck="false"
			aria-label={t.add.promptText}
			value={prompt}
			oncopy={copiedByHand}
			onfocus={(e) => copyFailed && e.currentTarget.setSelectionRange(0, e.currentTarget.value.length)}
		></textarea>
	</details>
{/snippet}

<div class="add" class:empty={!views.length} class:errs={anyErrors}>
	{#if justSaved.length}
		<!-- What was just saved: the way to it, and to the next card. -->
		<section class="saved-card" data-testid="saved-card" role="status" aria-labelledby="saved-head">
			{#if justSaved.length === 1}
				<p class="saved-head" id="saved-head">
					<span class="tick-ok" aria-hidden="true">✓</span>
					{t.add.saved(1)} <strong><Marked text={justSaved[0].title} /></strong>
				</p>
			{:else}
				<p class="saved-head" id="saved-head"><span class="tick-ok" aria-hidden="true">✓</span> {t.add.saved(justSaved.length)}</p>
				<ul class="saved-list">
					{#each justSaved as l (l.slug)}<li><a href="/r/{l.slug}"><Marked text={l.title} /></a></li>{/each}
				</ul>
			{/if}
			<div class="saved-actions">
				{#if justSaved.length === 1}<a class="btn primary" id="saved-see" href="/r/{justSaved[0].slug}">{t.add.seeRecipe}</a>{/if}
				<button class="btn" type="button" onclick={addAnother}>{t.add.addAnother}</button>
			</div>
		</section>
	{/if}
	{#if offers.length && photo}
		<!-- After a save: the photo sent to the AI, offered to the recipe it was read from. -->
		<section class="attach" aria-labelledby="attach-ask">
			<img class="attach-thumb" src={photoUrl} alt={t.add.attachThumb} />
			<div class="attach-body">
				<p class="attach-ask" id="attach-ask">{t.add.attachAsk}</p>
				<div class="attach-actions">
					{#each offers as o, i (o.slug)}
						{#if o.done}
							<p class="attached"><span aria-hidden="true">✓ </span>{t.add.attachedTo} <a href="/r/{o.slug}"><Marked text={o.title} /></a></p>
						{:else}
							<button class="btn primary" type="button" onclick={() => attachOffered(i)} disabled={o.busy}
								>{o.busy ? t.photo.sending : offers.length > 1 ? t.add.attachTo(short(o.title)) : t.add.attach}</button
							>
						{/if}
					{/each}
					<button class="linkish" type="button" onclick={dropPhoto}>{offers.every((o) => o.done) ? t.add.attachClose : t.add.attachNo}</button>
				</div>
			</div>
		</section>
	{/if}
	<!--
		Empty, the ways in are one card: two tabs — a card in a photo (its three steps, the
		paste box the third, shown on load), a web page's address. Typing by hand is the
		page head's link. The box is never moved: a paste or a keystroke must not lose it.
	-->
	<div class="lead" class:card={!views.length} class:folded={stepsFolded}>
		{#if !views.length}
			<div class="tabs" role="tablist" aria-label={t.add.waysLabel}>
				<button
					class="tab"
					id="tab-card"
					type="button"
					role="tab"
					aria-selected={way === 'card'}
					aria-controls="way-card"
					tabindex={way === 'card' ? 0 : -1}
					onclick={() => choose('card')}
					onkeydown={tabKey}>{t.add.tabCard}</button
				>
				<button
					class="tab"
					id="tab-web"
					type="button"
					role="tab"
					aria-selected={way === 'web'}
					aria-controls={pageAi ? 'way-card' : 'way-web'}
					tabindex={way === 'web' ? 0 : -1}
					onclick={() => choose('web')}
					onkeydown={tabKey}>{t.add.tabWeb}</button
				>
			</div>
		{/if}
		<div class="way-card" id="way-card" role={views.length ? undefined : 'tabpanel'} aria-labelledby={views.length ? undefined : pageAi ? 'tab-web' : 'tab-card'} hidden={showWeb}>
		{#if !views.length}
			{#if pageAi}
				<!-- The page the app could not read: its address, kept, and the way back to it. -->
				<p class="page-line" data-testid="ai-page">
					<span class="page-label">{t.add.pageAddress}</span>
					<span class="page-url">{importUrl}</span>
					<button class="linkish" type="button" onclick={() => (aiForPage = false)}>{t.add.backToAddress}</button>
				</p>
			{/if}
			<p class="lead-text">{pageAi ? t.add.wayAiPage : t.add.wayAiText}</p>
			<!-- A phone, once the AI has the prompt: steps 1–2 on one line, the box on the first screen. -->
			<p class="steps-line">
				<span class="tick-ok" aria-hidden="true">✓</span>
				{#if photo && sent}<img class="thumb small" src={photoUrl} alt="" />{/if}
				<span>{photo && sent ? t.add.sentLine : promptDone ? t.add.promptCopied : t.add.promptGivenBefore}</span>
				<span class="dot" aria-hidden="true">·</span>
				<button class="linkish" type="button" onclick={() => (reviewSteps = true)} aria-controls="add-steps">{t.add.review}</button>
			</p>
			<ol class="steps" id="add-steps" aria-label={t.add.stepsLabel}>
				{#if canSharePhoto}
					<!-- A phone that can share: the photo first, then photo and prompt to the AI's app in one tap. -->
					<li class:done={!!photo}>
						<span class="n" aria-hidden="true">{photo ? '✓' : '1'}</span>
						<div class="step">
							{#if photo}
								<div class="photo-row">
									<img class="thumb" src={photoUrl} alt="" />
									<span class="photo-name">{photo.name}</span>
									<label class="btn change">
										<input class="visually-hidden" type="file" accept="image/*" onchange={pickPhoto} />{t.add.changePhoto}
									</label>
								</div>
							{:else}
								<label class="btn primary pick">
									<input class="visually-hidden" type="file" accept="image/*" onchange={pickPhoto} aria-describedby="pick-help" />{pageAi ? t.add.pickPhotoPage : t.add.pickPhoto}
								</label>
								<p class="hint" id="pick-help">{t.add.pickPhotoHelp}</p>
							{/if}
						</div>
					</li>
					<li class:done={promptDone}>
						<span class="n" aria-hidden="true">{promptDone ? '✓' : '2'}</span>
						<div class="step">
							<button class="btn send" class:primary={!!photo && !promptDone} type="button" onclick={sendToAi} disabled={!photo} aria-describedby="send-help"
								>{t.add.sendToAi}</button
							>
							<p class="hint" id="send-help">
								{t.add.sendToAiHelp}
								<span class="also">{t.add.sendToAiOnlyPhoto} <button class="linkish" type="button" onclick={copyPrompt}>{t.add.copyPrompt}</button></span>
							</p>
							{@render promptPeek(0)}
						</div>
					</li>
				{:else}
					<li class:done={promptDone}>
						<span class="n" aria-hidden="true">{promptDone ? '✓' : '1'}</span>
						<div class="step">
							{@render promptButton(true)}
							<p class="hint">{t.add.step1Help}</p>
							{@render promptPeek(1)}
						</div>
					</li>
					<li class:done={aiOpened}>
						<span class="n" aria-hidden="true">{aiOpened ? '✓' : '2'}</span>
						<div class="step">
							{#if canShareText}
								<!-- A phone: the prompt to the AI's app through the share sheet. -->
								<button class="btn ai" class:primary={promptDone && !aiOpened} type="button" onclick={sharePrompt} aria-describedby="ai-help">{t.add.sharePrompt}</button>
								<p class="hint" id="ai-help">{pageAi ? t.add.sharePromptHelpPage : t.add.sharePromptHelp}</p>
							{:else}
								<!-- A computer: Claude in a new tab; the prompt copied on the same click. -->
								<a
									class="btn ai"
									class:primary={promptDone && !aiOpened}
									href={AI_URL}
									target="_blank"
									rel="noopener noreferrer"
									onclick={openedAi}
									aria-label={t.add.openAiLabel}
									aria-describedby="ai-help">{t.add.openAi}<span class="ext" aria-hidden="true">↗</span></a
								>
								<p class="hint" id="ai-help">{pageAi ? t.add.step2HelpPage : t.add.step2Help}</p>
							{/if}
						</div>
					</li>
				{/if}
			</ol>
		{:else}
			<!-- The main path's steps, ticked as they are done; « Recommencer » at its end (the ways in come back), said « Texte repris » after a reload. -->
			<div class="progress-row">
				<ol class="progress" aria-label={t.add.stepsLabel}>
					{#each progress as p, i (p.label)}
						<li class:done={p.done}>
							<span class="n" aria-hidden="true">{p.done ? '✓' : i + 1}</span>{p.label}{#if p.done}<span class="visually-hidden"> ({t.add.progressDone})</span>{/if}
						</li>
					{/each}
				</ol>
				<p class="restart" data-testid="restart">
					{#if restoredDraft}<span class="restored">{t.add.restored}</span><span class="dot" aria-hidden="true">·</span>{/if}
					<button class="linkish" type="button" onclick={restart}>{t.add.restart}</button>
				</p>
			</div>
		{/if}

		<div class="work" class:split={views.length > 0 && !folded} class:errs={anyErrors}>
			<div class="input" class:folded class:third={!views.length}>
				{#if !views.length}<span class="n" aria-hidden="true">3</span>{/if}
				<div class="step">
					{#if !views.length}
						<div class="paste-head">
							<p class="step-title" id="paste-step">{t.add.step3}</p>
							{#if canReadClip}<button class="btn paste-btn" class:primary={aiOpened || stepsFolded || (canSharePhoto && promptDone)} type="button" onclick={pasteFromClipboard}>{t.add.pasteButton}</button>{/if}
						</div>
					{/if}
					<label for="paste" class="visually-hidden">{fromWeb ? t.add.pasteWeb : t.add.paste}</label>
					{#if !views.length}<p class="hint" id="paste-help">{t.add.intro}</p>{/if}
					<div class="boxwrap">
					<textarea
						id="paste"
						class:short={allOk}
						bind:this={box}
						bind:value={text}
						oninput={onBoxInput}
						onkeydown={onBoxKey}
						placeholder={t.add.placeholder}
						spellcheck="false"
						aria-describedby={views.length ? undefined : 'paste-step paste-help'}
						rows="14"
						onscroll={(e) => (boxScroll = e.currentTarget.scrollTop)}
					></textarea>
					<!-- The errors' lines, marked in the box's margin (decoration: each error has its own "Montrer dans le texte"). -->
					{#each marks as m, i (i)}
						{@const top = m.top - boxScroll}
						{#if box && top + m.height > 0 && top < box.clientHeight}
							<span class="mark" aria-hidden="true" style:top="{box.offsetTop + box.clientTop + Math.max(0, top)}px" style:height="{Math.min(m.height + Math.min(0, top), box.clientHeight - Math.max(0, top))}px"></span>
						{/if}
					{/each}
					</div>
					<p class="status" role="status">
						{#if views.length}
							<span><strong>{views.length}</strong> {t.add.found(views.length)}</span>
							{#if views.length === 1}<span>{t.add.ingredientsN(views[0].counts.ingredients)}</span><span>{countLine(views[0])}</span>{/if}
							{#if folded}
								<button class="linkish" type="button" onclick={openText} aria-controls="paste">{t.add.editText}</button>
							{:else if allOk}
								<button class="linkish" type="button" onclick={() => (textOpen = false)} aria-controls="paste">{t.add.hideText}</button>
							{/if}
						{/if}
					</p>
				</div>
			</div>

			{#if views.length}
				<div class="result">
					{#if fixLog.length}
						<!-- The quick fixes made: one line; the list under it does not keep the fixed rows. -->
						<p class="fixes-line" data-testid="fixes-line">
							<span class="tick-ok" aria-hidden="true">✓</span>
							<strong>{t.add.fixesDone(fixLog.length)}</strong>
							{#if lastFix}<span class="last" aria-hidden="true">— {lastFix.message}</span>{/if}
							{#if canUndoFix}
								<span class="dot" aria-hidden="true">·</span>
								<button class="linkish" type="button" onclick={undoLastFix}>{t.add.undoLast}</button>
							{/if}
						</p>
					{/if}
					<p class="visually-hidden" role="status">{lastFix?.message ?? ''}</p>
					{#if split.outside && split.files.length}
						<details class="outside">
							<summary>{t.add.outside}</summary>
							<pre>{split.outside}</pre>
						</details>
					{/if}

					{#each views as v (v.index)}
						{@const col = v.server?.collision}
						{@const q = questionOf(v)}
						{@const sameTitle = q.sameTitle}
						{@const other = pairOf(v)}
						{@const inBatch = v.server?.closeInBatch ?? []}
						{@const asks = q.asks}
						{@const choice = choices[v.key]}
						{@const items = errorItems(v)}
						{@const laterRows = v.later?.ds ?? []}
						<!-- No step read, the lines W401 would put in Préparation waiting: above the save, open, not in the remarks.
						     Lines that look like steps written another way: said there even while errors wait, so the fix is not lost among the remarks. -->
						{@const stepless = (v.ok || v.oddSteps) && v.counts.steps === 0 ? v.diagnostics.find((d) => d.code === 'W401' || d.code === 'W403') : undefined}
						<!-- The same-dish question says what W505 / W608 would: they leave the remarks. -->
						{@const allRemarks = v.diagnostics.filter((d) => d.severity !== 'error' && d !== stepless && !(asks && (d.code === 'W505' || d.code === 'W608')))}
						<!-- « Pas encore relié » (W303, W305): nothing to do in the box; one row for all, the lines inside. -->
						{@const toLink = allRemarks.filter((d) => d.code === 'W303' || d.code === 'W305')}
						{@const remarks = toLink.length > 1 ? allRemarks.filter((d) => !toLink.includes(d)) : allRemarks}
						{@const linkRow = toLink.length > 1 ? toLink : []}
						{@const remarkCount = remarks.length + (linkRow.length ? 1 : 0)}
						<section class="file" class:bad={!v.ok} aria-label={v.title}>
							<header>
								<div class="title">
									<h2><Marked text={v.title} /></h2>
									{#if views.length > 1}<p class="counts">{t.add.ingredientsN(v.counts.ingredients)} · {countLine(v)}</p>{/if}
								</div>
								{#if views.length > 1 || !v.ok}<span class="state" class:okay={v.ok}>{v.ok ? t.add.valid : t.add.invalid}</span>{/if}
								<!-- "Replace" stays a paste box choice: the form opens a pasted file as a new recipe. -->
								{#if v.alone && v.mode !== 'replace'}
									<button
										class="btn edit"
										type="button"
										onclick={() => openInForm(v)}
										data-testid="edit-in-form"
										title={t.add.editHelp}
										aria-describedby="edit-help-{v.index}">✎ {t.add.edit}</button
									>
									<span class="visually-hidden" id="edit-help-{v.index}">{t.add.editHelp}</span>
								{/if}
							</header>

							{#if fromWeb && v.parsed.frontmatter?.lang === 'en'}
								<!--
									An English page: the first thing on its card, the way to a French file — « Copier
									pour traduire » (the prompt, the translation request and the file, copied in one
									tap), Claude beside it; the AI's answer, pasted here, replaces the import.
								-->
								<div class="lang-note" data-testid="english-page" role="group" aria-labelledby="lang-{v.index}">
									<p class="lang-head" id="lang-{v.index}"><span class="lang-tag">{t.add.englishPage}</span> <strong>{t.add.translateAsk}</strong></p>
									<p class="lang-help">{replaceNext ? t.add.translateNext : t.add.translateHelp}</p>
									<div class="lang-actions">
										<button class="btn primary" class:done={translateCopied === v.key} type="button" onclick={() => askTranslation(v)}
											>{#if translateCopied === v.key}<span aria-hidden="true">✓ </span>{t.add.copied}{:else}{t.add.translateCopy}{/if}</button
										>
										<a class="btn" href={AI_URL} target="_blank" rel="noopener noreferrer" onclick={() => translateOpened(v)} aria-label={t.add.openAiLabel}
											>{t.add.openAi}<span class="ext" aria-hidden="true">↗</span></a
										>
									</div>
								</div>
							{/if}

							{#if staleFiles.has(v.key)}
								<p class="warn" data-testid="stale">{staleFiles.get(v.key)}</p>
							{/if}

							<!-- Decisions first: what she alone can answer. -->
							{#if col && !v.firstFree}
								<div class="decision">
									{#if col.inTrash}
										<p>{t.add.collisionTrash(v.server?.slug ?? '')}</p>
									{:else}
										<p>{t.add.collision(v.server?.slug ?? '')}{#if col.existing}{' — '}<a href="/r/{v.server?.slug}" target="_blank"><Marked text={col.existing.title} /></a>{/if}</p>
									{/if}
									<!-- Keeping both is the default and comes first; replacing is chosen, and says the old one stays in its history. -->
									<div class="options" role="radiogroup" aria-label={t.add.collision(v.server?.slug ?? '')}>
										<label class="chip"
											><input type="radio" name="choice-{v.index}" checked={v.mode === 'suffix'} onchange={() => setChoice(v.key, { mode: 'suffix', target: undefined })} />
											{t.add.saveAs(col.suggested)}</label
										>
										{#if col.existing && !col.inTrash}
											<label class="chip"
												><input
													type="radio"
													name="choice-{v.index}"
													checked={v.mode === 'replace'}
													onchange={() => setChoice(v.key, { mode: 'replace', target: col.existing?.hash })}
												/> {t.add.replace}</label
											>
										{/if}
									</div>
									{#if v.mode}
										<!-- E103 settled by this choice: said here, gone from the errors. -->
										<p class="settled-note" data-testid="collision-settled">
											<span aria-hidden="true">✓ </span>{v.mode === 'replace' ? t.add.collisionReplacing : t.add.collisionSettled(col.suggested)}
										</p>
									{/if}
								</div>
							{/if}

							{#if asks}
								<!--
									The question, then each vault recipe it may be grouped with — its title, where it is
									from (« de Tante Aline », « carte, 1998 »), why it is asked — picked when there are
									several; the answer names the target (« Regrouper avec … — de … »). Once chosen, the
									group's name (a name, never a slug) and each side's « Ce qui distingue ».
								-->
								{@const target = other}
								<div class="decision dup" class:settled={choice?.apart} data-testid="same-dish">
									{#if choice?.apart}
										<p class="answered">
											{t.add.otherDishSet}
											<button class="linkish" type="button" onclick={() => setChoice(v.key, { apart: false })}>{t.add.change}</button>
										</p>
									{:else}
										<!-- W505 (plan 05, Phase 6) and W608 say it through the list: why each one is asked. -->
										<p class="dup-line">
											<strong class="ask" id="ask-{v.index}">{sameTitle ? t.add.sameTitle : q.soft ? t.add.likeFamily : t.add.closeFamily}</strong>
										</p>
										{#if q.cands.length}
											<ul class="targets" role={q.cands.length > 1 ? 'radiogroup' : undefined} aria-labelledby="ask-{v.index}" data-testid="group-targets">
												{#each q.cands as c (c.slug)}
													<li class:picked={q.cands.length > 1 && target?.slug === c.slug}>
														{#if q.cands.length > 1}
															<label class="target">
																<input
																	type="radio"
																	name="target-{v.index}"
																	checked={target?.slug === c.slug}
																	onchange={() => setChoice(v.key, choice?.family ? groupWith(v, c) : { pairSlug: c.slug })}
																/>
																<span class="t-title"><Marked text={c.title} /></span>
																<span class="t-from">{c.from || t.add.fromUnknown}</span>
																<span class="t-why">{whyOf(c)}{#if c.familyLabel}{' · '}{t.add.inGroup(c.familyLabel)}{/if}</span>
															</label>
														{:else}
															<span class="target">
																<span class="t-title"><Marked text={c.title} /></span>
																<span class="t-from">{c.from || t.add.fromUnknown}</span>
																<span class="t-why">{whyOf(c)}{#if c.familyLabel}{' · '}{t.add.inGroup(c.familyLabel)}{/if}</span>
															</span>
														{/if}
														<a class="t-open" href="/r/{c.slug}" target="_blank" rel="noopener" aria-label={t.add.openTarget(stripMarkers(c.title))}>{t.add.see}<span aria-hidden="true"> ↗</span></a>
													</li>
												{/each}
											</ul>
										{/if}
										<div class="answers" role="group" aria-labelledby="ask-{v.index}">
											<!-- Several to choose from and none picked: « Regrouper » waits for her pick, never takes the first. -->
											<button
												class="btn same"
												class:chosen={!!choice?.family}
												type="button"
												aria-pressed={!!choice?.family}
												disabled={!target && q.cands.length > 1}
												title={!target && q.cands.length > 1 ? t.add.pickTargetFirst : t.add.groupWhat}
												onclick={() => setChoice(v.key, choice?.family ? { family: false } : groupWith(v, target))}
												>{#if choice?.family}<span aria-hidden="true">✓ </span>{/if}{target
													? t.add.groupWith(short(target.title), target.from)
													: q.cands.length > 1
														? t.add.pickTargetFirst
														: t.add.sameDish}</button
											>
											<button class="btn other" type="button" aria-pressed="false" onclick={() => setChoice(v.key, { family: false, apart: true })}>{t.add.otherDish}</button>
										</div>
									{/if}
									{#if choice?.family}
										<p class="group-what">{t.add.groupWhat}</p>
										<div class="family-fields">
											<label
												>{t.add.family}
												<input type="text" value={choice?.familyName ?? ''} oninput={(e) => setChoice(v.key, { familyName: e.currentTarget.value })} autocomplete="off" /></label
											>
											<label
												>{t.add.variant}
												<input
													type="text"
													data-variant
													value={choice?.variant ?? ''}
													placeholder={t.add.variantPlaceholder}
													oninput={(e) => setChoice(v.key, { variant: e.currentTarget.value })}
												/></label
											>
											{#if target}
												<label
													>{t.add.pairVariant(target.title)}
													<input
														type="text"
														value={choice?.pairVariant ?? ''}
														placeholder={t.add.variantPlaceholder}
														oninput={(e) => setChoice(v.key, { pairVariant: e.currentTarget.value })}
													/></label
												>
												<p class="pair-note">{t.add.pairNote(target.title)}</p>
											{/if}
										</div>
									{/if}
								</div>
							{/if}

							{#if inBatch.length}
								<!-- W505 inside the paste: an earlier file of this paste, not saved yet, named by its place. -->
								<p class="notice" data-testid="close-batch">
									{t.add.close}
									{#each inBatch as c, i (c.index)}{i ? ', ' : ' '}{t.add.batchFile(c.index + 1)} ({t.app.quotes[0]}<Marked text={c.title} />{t.app.quotes[1]}){/each}.
									{t.add.batchCloseHint}
								</p>
							{/if}

							{#if items.length}
								<details class="diag error" open>
									<summary>{t.add.errors} ({v.errorCount})</summary>
									<ul data-list="errors">
										{#each items as item, i (item.d)}
											{@const d = item.d}
											{@const fix = quickFixFor(v, d, item.same)}
											{@const cf = canEdit(v) ? v.fixes[item.k] : null}
											{@const tr = d.code === 'E002' ? v.trouble : null}
											{@const plainAll = cf?.kind === 'entry' && v.plain.all && d.path === v.plain.paths[0] ? v.plain.all : null}
											{#snippet quick()}
												{#if fix}{@render quickForm(v, fix)}{:else if cf}{@render codeFixForm(v, cf)}{/if}
												{#if plainAll}
													<!-- Several lines left whole: all of them read in one tap. -->
													<button class="btn quick-btn" type="button" onclick={() => applyCodeFix(v, plainAll, t.add.entryDoneAll(v.plain.paths.length))}
														>{t.add.entryReadAll(v.plain.paths.length)}</button
													>
												{/if}
											{/snippet}
											{#snippet excerpt()}
												{#if tr}{@render troubleView(v, tr)}{/if}
											{/snippet}
											{#snippet next()}
												{#if tr}{@render laterView(v)}{/if}
											{/snippet}
											<DiagnosticItem
												{d}
												part="row"
												file={v.parsed}
												onshow={showFor(v, item.k)}
												quickfix={fix || cf ? quick : undefined}
												more={item.same.map((k) => placeHuman(v.diagnostics[k].path, v.parsed) ?? '').filter(Boolean)}
												at={tr ? pasteText.lineOf(boxLine(v, tr.span.start)) : undefined}
												say={tr
													? tr.realign
														? pasteText.offBy(Math.abs(tr.realign.to - tr.realign.from), tr.realign.from > tr.realign.to)
														: pasteText.badLine
													: d.code === 'E207' && d.path && v.plain.paths.includes(d.path)
														? pasteText.notSplit(valueAt(v.parsed.frontmatter, d.path) ?? '')
														: cf?.kind === 'sourceType'
															? pasteText.sourceType(valueAt(v.parsed.frontmatter, d.path) ?? '')
															: undefined}
												extra={tr ? excerpt : undefined}
												after={tr ? next : undefined}
											/>
										{/each}
										<!-- E002's next ones: found in the realigned text, listed now (one round), each marked « à revérifier »; a fix realigns first. -->
										{#each laterRows as ld (ld)}
											{@const lf = laterFixOf(v, ld)}
											{#snippet laterQuick()}
												{#if lf}<button class="btn primary quick-btn" type="button" onclick={() => lf && applyLaterFix(v, lf.fix, lf.message)}>{lf.label}</button>{/if}
											{/snippet}
											<DiagnosticItem d={ld} part="row" file={v.later?.parsed} badge={t.add.recheck} quickfix={lf ? laterQuick : undefined} />
										{/each}
									</ul>
								{#if needAi[0] === v}
										<!-- The one fix request, right under the errors (for every file of the paste that needs the AI). -->
										<div class="ai-fix">
											<button class="btn fix" type="button" onclick={copyFixBlock}
												>{t.add.fixBlock}{needAi.length > 1 ? ` (${needAi.length})` : ''}</button
											>
											<span class="hint">{t.add.fixBlockHelp}</span>
										</div>
									{/if}
								</details>
							{/if}

							{#if stepless}
								{@const cf = canEdit(v) ? v.fixes[v.diagnostics.indexOf(stepless)] : null}
								{#snippet quick()}
									{#if cf}{@render codeFixForm(v, cf)}{/if}
								{/snippet}
								{@const odd = v.oddSteps}
								<!-- No step read: said first; when lines look like steps written another way, the first one named, and one tap writes them as steps. -->
								<div class="diag warning stepless" class:odd={!!odd} data-testid="stepless">
									<ul>
										<DiagnosticItem
											d={stepless}
											part="row"
											file={v.parsed}
											onshow={showFor(v, v.diagnostics.indexOf(stepless))}
											quickfix={cf ? quick : undefined}
											say={odd ? pasteText.stepsOdd(odd.steps, odd.first.text.trim()) : undefined}
											at={odd ? pasteText.lineOf(boxLine(v, normalizeText(v.text).split('\n').slice(0, odd.first.line).reduce((n, l) => n + l.length + 1, 0))) : undefined}
										/>
									</ul>
								</div>
							{/if}

							<!-- Warnings and notes: one line when there is one, else behind their count (open on a web import: the page's own words to check). -->
							{#snippet remarkRow(d: Diagnostic)}
								{@const fix = quickFixFor(v, d)}
								{@const cf = canEdit(v) ? v.fixes[v.diagnostics.indexOf(d)] : null}
								{@const kept = d.code === 'W501' && keptTags.includes(`${v.key}|${valueAt(v.parsed.frontmatter, d.path)}`)}
								{#snippet quick()}
									{#if fix}{@render quickForm(v, fix)}{:else if cf}{@render codeFixForm(v, cf)}{/if}
								{/snippet}
								<DiagnosticItem
									{d}
									part="row"
									file={v.parsed}
									compact
									say={sayFor(v, d)}
									onshow={showFor(v, v.diagnostics.indexOf(d))}
									quickfix={(fix || cf) && !kept ? quick : undefined}
								/>
							{/snippet}
							{#snippet linkGroup()}
								<!-- The ingredients not linked yet: one row, nothing to do here; « À relier » once saved. -->
								<li class="link-later" data-testid="link-later">
									<details>
										<summary>{t.add.linkLater(linkRow.length)}</summary>
										<ul>
											{#each linkRow as d (d)}{@render remarkRow(d)}{/each}
										</ul>
									</details>
								</li>
							{/snippet}
							{#if remarkCount === 1}
								<div class="diag warning">
									<p class="diag-head">{t.add.remarks(1)}</p>
									<ul data-list="remarks">
										{#if remarks.length}{@render remarkRow(remarks[0])}{:else}{@render linkGroup()}{/if}
									</ul>
								</div>
							{:else if remarkCount}
								<details class="diag warning" open={fromWeb}>
									<summary>{t.add.remarks(remarkCount)}</summary>
									<ul data-list="remarks">
										{#each remarks as d, i (d)}
											{@render remarkRow(d)}
										{/each}
										{#if linkRow.length}{@render linkGroup()}{/if}
									</ul>
								</details>
							{/if}

							{#if v.diagnostics.length || laterRows.length}
								<!-- The codes, the places and how to correct each, for whoever repairs the file: one disclosure per file, closed. -->
								<details class="trouble" data-testid="trouble">
									<summary>{t.add.troubleDetails}</summary>
									<ul>
										{#each v.diagnostics as d (d)}<DiagnosticItem {d} part="detail" compact={d.severity !== 'error'} file={v.parsed} />{/each}
										{#each laterRows as ld (ld)}<DiagnosticItem d={ld} part="detail" file={v.later?.parsed} />{/each}
									</ul>
								</details>
							{/if}

							<!-- The card's photo kept with the recipe (a computer, or a phone without sharing): sent right after the save. -->
							{#if !photo && v.mode !== 'replace'}
								{@const mine = cardPhotos[v.key]}
								<div class="card-photo" data-testid="card-photo">
									{#if mine}
										<img class="thumb" src={mine.url} alt="" />
										<span class="photo-note">{t.add.cardPhotoSet}</span>
										<button class="linkish" type="button" onclick={() => dropCardPhoto(v)}>{t.add.cardPhotoDrop}</button>
									{:else}
										<label class="linkish pick-card">
											<input class="visually-hidden" type="file" accept="image/*" onchange={(e) => pickCardPhoto(v, e)} />{t.add.cardPhoto}
										</label>
										<span class="hint">{t.add.cardPhotoHelp}</span>
									{/if}
								</div>
							{/if}


							{#if v.recipe && !hasErrors(local.files[v.index].diagnostics)}
								<details class="preview" open={views.length === 1}>
									<summary>{t.add.preview}</summary>
									<RecipeView
										recipe={v.recipe}
										body={bodyText(v.text)}
										titles={v.server?.titles ?? {}}
										tagViews={tagViewsOf(v.recipe.tags)}
										links={false}
									/>
								</details>
							{:else}
								{@const partial = partialRecipe(v.parsed)}
								{#if partial}
									<!-- Errors to settle: the rest of the file, read as far as it goes, greyed. -->
									<details class="preview partial" open={views.length === 1}>
										<summary>{t.add.previewPartial}</summary>
										<p class="partial-note">{t.add.previewPartialNote}</p>
										<svelte:boundary>
											<div class="partial-view">
												<RecipeView recipe={partial} body={bodyText(v.text)} titles={v.server?.titles ?? {}} tagViews={tagViewsOf(partial.tags)} links={false} />
											</div>
											{#snippet failed()}<p class="partial-note">{t.add.previewPartialNone}</p>{/snippet}
										</svelte:boundary>
									</details>
								{/if}
							{/if}

							<!-- One file: its save at the foot of its card, held at the bottom of the screen while the card is in view. -->
							{#if views.length === 1}{@render saveBar()}{/if}
						</section>
					{/each}

					<!-- Several files: one save for all, at the foot of the result (held at the bottom the same way). -->
					{#if views.length > 1}{@render saveBar()}{/if}
				</div>
			{/if}
		</div>
		</div>
		{#if showWeb}
			<!-- The second way in: a web page's address, imported into the box. -->
			<div class="way-web" id="way-web" role="tabpanel" aria-labelledby="tab-web">
				<!-- Enter submits (no browser check of the address: `site.ca/…` gets its https:// here). -->
				<form class="web" onsubmit={doImport} novalidate aria-busy={importing}>
					<label for="import-url">{t.add.wayWeb}</label>
					<div class="row">
						<input
							id="import-url"
							name="url"
							type="url"
							inputmode="url"
							autocomplete="url"
							enterkeyhint="go"
							placeholder={t.add.importPlaceholder}
							bind:value={importUrl}
							oninput={() => (importError = null)}
							aria-invalid={importError ? 'true' : undefined}
							aria-describedby={importError ? 'import-error web-help' : 'web-help'}
						/>
						<button class="btn primary" type="submit" disabled={importing}>{importing ? t.add.importing : t.add.import}</button>
					</div>
					<p class="visually-hidden" role="status">{importing ? t.add.importing : ''}</p>
					{#if importError}
						<!-- Under the field until the address changes; the ways that still work. -->
						<div class="import-error" id="import-error" role="alert" data-testid="import-error">
							<p class="import-why">{importError.message}</p>
							{#if importError.kind === 'refused' || importError.kind === 'noRecipe'}<p class="import-cause">{t.add.importWhy[importError.kind]}</p>{/if}
							{#if importError.kind !== 'address'}
								<div class="import-next">
									<button class="btn" type="button" onclick={importViaAi}>{t.add.importViaAi}</button>
									<button class="linkish" type="button" onclick={seePrompt}>{t.add.showPrompt}</button>
									<a class="hand" href="/nouvelle">{t.add.wayHand}<span aria-hidden="true">→</span></a>
								</div>
								<p class="hint">{t.add.importViaAiHelp}</p>
							{/if}
						</div>
					{:else}
						<p class="hint" id="web-help">{t.add.webHelp}</p>
					{/if}
				</form>
			</div>
		{/if}
	</div>
</div>
{/if}

<!--
	Save: what holds it back (a button to the first error), or that all is well; the
	button says what it will do. In its place in the page; held at the bottom of the
	screen while that place is out of sight, unless what she acts on is in view.
-->
{#snippet saveBar()}
	<div class="save-slot">
		<div class="savebar paste-save" data-testid="paste-save">
			<div class="why" aria-live="polite">
				{#if allOk && !naming.length}
					<span class="ok"><span aria-hidden="true">✓</span>{views.length === 1 ? t.add.valid : t.add.readyMany(views.length)}</span>
				{:else if saveNote}
					<button class="jump" class:blocked={!ready.length || naming.length > 0} type="button" onclick={toFirstError} title={naming.length ? undefined : t.add.toFirstError}
						>{saveNote}</button
					>
				{/if}
			</div>
			<!-- An English page imported: « Copier pour traduire » is the main way; saving it in English stays possible, quieter. -->
			<button class="btn save" class:primary={!englishImport} type="button" onclick={saveAll} disabled={!canSave}>
				<span class="long">{saveLabel}</span><span class="brief">{briefLabel}</span>
				<kbd>{t.add.saveHint}</kbd>
			</button>
		</div>
	</div>
{/snippet}

<!-- A fix the box makes itself: a title typed in, or one tap (realign a line, add the version, split a quantity, a method heading). -->
{#snippet codeFixForm(v: FileView, cf: CodeFix)}
	{#if cf.kind === 'title'}
		<form class="quick title-fix" onsubmit={(e) => addTitle(v, e)}>
			<label>
				<span>{t.add.titleLabel}</span>
				<input
					name="title"
					type="text"
					value={cf.guess}
					required
					autocomplete="off"
					enterkeyhint="done"
					onkeydown={(e) => {
						// Enter adds the title; Ctrl+Entrée stays the page's save.
						if (e.key === 'Enter' && !e.isComposing && !e.ctrlKey && !e.metaKey) {
							e.preventDefault();
							e.currentTarget.form?.requestSubmit();
						}
					}}
				/>
			</label>
			<button class="btn primary" type="submit">{t.add.titleAdd}</button>
		</form>
	{:else if cf.kind === 'sourceType'}
		<!-- E106: one button per type of the list, its code (what the file holds) and its name (what the app shows); none chosen for her. -->
		<div class="type-fix" role="group" aria-label={t.add.sourceTypePick}>
			{#each cf.options as o (o.type)}
				<button class="btn quick-btn" type="button" onclick={() => applyCodeFix(v, o.fix, t.add.sourceTypeDone(o.type))}
					>{t.add.sourceTypeWrite(o.type, (t.source[o.type] ?? o.type).toLocaleLowerCase('fr-CA'))}</button
				>
			{/each}
		</div>
	{:else if 'fix' in cf}
		<button class="btn primary quick-btn" type="button" onclick={() => applyCodeFix(v, cf.fix, codeFixMessage(v, cf))}>{codeFixLabel(v, cf)}</button>
	{/if}
{/snippet}

<!-- E002: the line where the header stops reading, as in the box (its number, the line above, a caret); then what comes next. -->
{#snippet troubleView(v: FileView, tr: YamlTrouble)}
	{@const n = boxLine(v, tr.span.start)}
	<div class="excerpt" data-testid="excerpt">
		<div class="excerpt-grid">
			{#if tr.before !== undefined}<span class="ln" aria-hidden="true">{n - 1}</span><code class="src">{tr.before || ' '}</code>{/if}
			<span class="ln bad" aria-hidden="true">{n}</span><code class="src bad">{tr.text || ' '}</code>
			<span class="ln" aria-hidden="true"></span><code class="caret" aria-hidden="true">{' '.repeat(tr.col)}^</code>
		</div>
	</div>
{/snippet}

<!-- E002, under its actions: how many of the rows under it the realigned text gives (« à revérifier »), else that more may come. -->
{#snippet laterView(v: FileView)}
	{@const later = laterOf(v)}
	{#if later}
		{#if later.ds.length}
			<p class="later-head" data-testid="later">{pasteText.laterHead(later.ds.length)}</p>
		{:else}
			<p class="later-head">{pasteText.laterNone}</p>
		{/if}
	{:else}
		<p class="later-head">{pasteText.laterMaybe}</p>
	{/if}
{/snippet}

{#snippet quickForm(v: FileView, fix: QuickFix)}
	{@const n = fix.spans.length}
	{#if fix.kind === 'tag'}
		<!-- An unknown tag: « Utiliser » the same word when there is one; « Garder » always (it waits in Étiquettes). -->
		<div class="tag-fix">
			{#if fix.selected}
				<button class="btn quick-one" type="button" title={t.add.accentFix(fix.options[0]?.label ?? fix.selected)} onclick={() => applyFix(v, fix, fix.selected)}
					>{t.add.useTag(fix.options[0]?.label ?? tagLabel(fix.selected))}</button
				>
			{/if}
			<button class="keep" class:btn={!fix.selected} class:quick-one={!fix.selected} class:linkish={!!fix.selected} type="button" onclick={() => keepTag(v, fix.value)}
				>{t.add.keepTag(tagLabel(fix.value))}</button
			>
		</div>
	{:else if fix.kind === 'alias'}
		<!-- A unit the alias table knows: written as its code in one tap (beside "Montrer dans le texte"); the list behind "Autre unité…", under them. -->
		<!-- One primary button (« Écrire cup », at each of its places when there are several); any other choice behind « Autre unité… ». -->
		<button class="btn primary quick-btn" type="button" onclick={() => applyFix(v, fix, fix.selected, n > 1)}
			>{n > 1 ? t.add.quickFixWriteAll(fix.selected, n) : t.add.quickFixWrite(fix.selected)}</button
		>
		<!-- Under the one button, small: another unit, nothing chosen for her in its list. -->
		<details class="other-unit">
			<summary>{t.add.otherUnit}</summary>
			{@render pickForm(v, fix, n, false)}
		</details>
	{:else}
		{@render pickForm(v, fix, n, true)}
	{/if}
{/snippet}

{#snippet pickForm(v: FileView, fix: QuickFix, n: number, preselect: boolean)}
	<form
		class="quick"
		onsubmit={(e) => {
			e.preventDefault();
			const all = (e.submitter as HTMLButtonElement | null)?.value === 'all';
			applyFix(v, fix, String(new FormData(e.currentTarget).get('to') ?? ''), all);
		}}
	>
		<label>
			<span>{t.add.quickFix(fix.value)}</span>
			<select
				name="to"
				required
				onkeydown={(e) => {
					// Enter applies the unit chosen, as a field's Enter would.
					if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
						e.preventDefault();
						e.currentTarget.form?.requestSubmit();
					}
				}}
			>
				<option value="" disabled selected={!preselect || !fix.selected}>{t.add.quickFixChoose}</option>
				{#each fix.options as o (o.value)}<option value={o.value} selected={preselect && o.value === fix.selected}>{o.label}</option>{/each}
			</select>
		</label>
		{#if n > 1}<button class="btn primary" type="submit" value="all">{t.add.quickFixAll(n)}</button>{/if}
		<button class="btn" class:primary={preselect && n === 1 && !!fix.selected} type="submit" value="one">{n > 1 ? t.add.quickFixHere : t.add.quickFixApply}</button>
	</form>
{/snippet}

{#if toast}
	<div class="toast lifted" class:error={toast.error} role="status">
		{toast.message}
		{#if toast.links}
			{#each toast.links as l, i (l.slug)}{i ? ', ' : ' '}<a href="/r/{l.slug}"><Marked text={l.title} /></a>{/each}
		{/if}
		{#if toast.note}<br />{toast.note}{/if}
		{#if toast.action}
			<button class="linkish toast-action" type="button" onclick={runToastAction}>{toast.action.label}</button>
		{/if}
	</div>
{/if}

<style>
	/*
	 * An empty page: the ways in are one card. Two tabs on its top edge (a card in a
	 * photo, a web page), the ink line under the chosen one as under the site's tabs;
	 * under "a card in a photo", its three steps, compact, the paste box the third.
	 */
	.lead.card {
		background: var(--card);
		border: 1px solid var(--edge);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: 0 1.5rem 1.4rem;
	}
	.tabs {
		display: flex;
		gap: 0 1.75rem;
		margin: 0 -1.5rem 1rem;
		padding: 0 1.5rem;
		border-bottom: 1px solid var(--line);
	}
	.tab {
		font: inherit;
		font-family: var(--serif);
		font-size: var(--step-1);
		font-weight: 700;
		color: var(--ink-soft);
		background: none;
		border: 0;
		border-bottom: 3px solid transparent;
		margin-bottom: -1px;
		padding: 0.85rem 0.1rem 0.6rem;
		min-height: 2.75rem;
		cursor: pointer;
	}
	.tab[aria-selected='true'] {
		color: var(--ink);
		border-bottom-color: var(--ink);
	}
	@media (hover: hover) {
		.tab:hover {
			color: var(--ink);
		}
	}
	.tab:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: -2px;
	}
	.lead-text {
		margin: 0 0 1rem;
		color: var(--ink-soft);
	}
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem 2.5rem;
	}
	.steps li,
	.input.third {
		display: grid;
		grid-template-columns: 1.75rem minmax(0, 1fr);
		gap: 0 0.75rem;
		align-items: baseline;
	}
	.input.third {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--line);
	}
	.steps .n,
	.third .n {
		display: block;
		width: auto;
		height: auto;
		border: 0;
		border-radius: 0;
		background: none;
		font-family: var(--serif);
		font-size: 1.75rem;
		font-weight: 700;
		line-height: 1;
		text-align: center;
		color: var(--ink);
	}
	.steps .done > .n {
		background: none;
		color: var(--ok);
		font-family: var(--sans);
		font-size: 1.4rem;
	}
	.steps .step,
	.third .step {
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.3rem;
	}
	.third .step {
		align-items: stretch;
	}
	.step-title {
		margin: 0;
		font-weight: 700;
	}
	.hint {
		margin: 0;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.hint .also {
		display: block;
		margin-top: 0.15rem;
	}
	.hint .linkish {
		padding: 0.2rem 0;
	}
	.copy,
	.pick,
	.send,
	.ai,
	.change {
		min-height: 2.75rem;
	}
	.pick,
	.change,
	a.ai {
		display: inline-flex;
		align-items: center;
		cursor: pointer;
	}
	a.ai {
		text-decoration: none;
		gap: 0.35em;
	}
	.ai .ext {
		font-size: 0.9em;
	}
	.pick:focus-within,
	.change:focus-within {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	.photo-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		max-width: 100%;
	}
	.thumb {
		flex: none;
		width: 3rem;
		height: 3rem;
		object-fit: cover;
		border: 1px solid var(--edge);
		border-radius: var(--radius);
	}
	.photo-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.copy.done {
		border-color: var(--ok);
		color: var(--ok);
	}
	.tick {
		font-weight: 700;
		margin-right: 0.3em;
	}
	.add.empty textarea {
		height: 10rem;
	}
	.paste-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
	}
	.paste-btn {
		min-height: 2.75rem;
		flex: none;
	}
	/* The steps folded to one line: a phone only (below). */
	.steps-line {
		display: none;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.2rem 0.5rem;
		margin: 0;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.steps-line .tick-ok {
		color: var(--ok);
		font-weight: 700;
	}
	.steps-line .dot {
		color: var(--pencil);
	}
	.thumb.small {
		width: 2rem;
		height: 2rem;
	}
	.add.empty .status:empty {
		display: none;
	}

	/* « Voir le prompt »: the prompt itself, readonly, to read or copy by hand. */
	.peek {
		width: 100%;
		font-size: var(--step--1);
	}
	.peek summary {
		cursor: pointer;
		width: fit-content;
		color: var(--link);
		font-weight: 600;
		padding: 0.3rem 0;
	}
	@media (pointer: coarse), (max-width: 40rem) {
		.peek summary {
			box-sizing: border-box;
			min-height: 2.75rem;
			padding: 0.75rem 0;
		}
	}
	.peek .manual {
		margin: 0.3rem 0;
		font-weight: 600;
		color: var(--danger);
	}
	.peek-box {
		height: 12rem;
		min-height: 6rem;
		margin-top: 0.3rem;
		font-size: 0.8125rem;
	}

	/* A failed import: why, plainly, under the field; the ways that still work. */
	.import-error {
		max-width: 42rem;
		margin-top: 0.6rem;
		padding: 0.6rem 0.8rem;
		background: var(--danger-bg);
		border-left: 3px solid var(--danger);
		border-radius: 0 var(--radius) var(--radius) 0;
	}
	.import-why {
		margin: 0 0 0.5rem;
		font-weight: 700;
		color: var(--danger);
	}
	/* The likely cause, plain ink, one line under the message. */
	.import-cause {
		margin: -0.3rem 0 0.6rem;
		color: var(--ink);
		font-size: var(--step--1);
	}
	/* The page the AI is to read, over its steps: the address kept, the way back to it. */
	.page-line {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.2rem 0.5rem;
		margin: 0 0 0.5rem;
		font-size: var(--step--1);
	}
	.page-label {
		color: var(--ink-soft);
	}
	.page-url {
		min-width: 0;
		overflow-wrap: anywhere;
		font-weight: 600;
	}
	.import-next {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 1.25rem;
		margin-bottom: 0.4rem;
	}
	.import-next .btn {
		min-height: 2.75rem;
		background: var(--card);
		white-space: normal;
		text-align: left;
	}

	/* The web page tab: the address and Importer on one row, what happens under it. */
	.way-web {
		padding-bottom: 0.25rem;
	}
	.web label {
		display: block;
		font-weight: 700;
		margin-bottom: 0.3rem;
	}
	.web .hint {
		margin-top: 0.4rem;
		max-width: 42rem;
	}
	.row {
		display: flex;
		gap: 0.5rem;
		max-width: 42rem;
	}
	.row input {
		flex: 1;
		min-width: 0;
		min-height: 2.75rem;
	}
	.row .btn {
		min-height: 2.75rem;
	}
	/* Typing by hand: a quiet link beside the page title. */
	.hand {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		font-weight: 600;
		white-space: nowrap;
	}
	.hand span {
		display: inline-block;
		margin-left: 0.3em;
		text-decoration: none;
	}
	@media (max-width: 47.99rem) {
		.lead.card {
			padding: 0 1rem 1.1rem;
		}
		.tabs {
			margin: 0 -1rem 0.85rem;
			padding: 0 0.5rem;
			gap: 0;
		}
		.tab {
			flex: 1 1 0;
			font-size: var(--step-0);
			padding-inline: 0.25rem;
		}
		.lead-text {
			font-size: var(--step--1);
			margin-bottom: 0.85rem;
		}
		.steps {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.85rem;
		}
		.steps li,
		.input.third {
			grid-template-columns: 1.5rem minmax(0, 1fr);
			gap: 0 0.65rem;
		}
		.input.third {
			margin-top: 0.85rem;
			padding-top: 0.85rem;
		}
		.steps .n,
		.third .n {
			font-size: 1.5rem;
		}
		.add.empty textarea {
			height: 9rem;
		}
		/* The box's placeholder says it; no fence jargon on a phone. */
		#paste-help {
			display: none;
		}
		/* Once the AI has the prompt: steps 1–2 on one line, the box on the first screen. */
		.lead.folded .lead-text,
		.lead.folded .steps {
			display: none;
		}
		.lead.folded .steps-line {
			display: flex;
		}
		.lead.folded .input.third {
			margin-top: 0.5rem;
			padding-top: 0.6rem;
		}
	}

	/* The progress line's small ticks. */
	.n {
		flex: none;
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 50%;
		border: 1.5px solid var(--ink);
		font-family: var(--serif);
		font-weight: 700;
		font-size: var(--step--1);
		line-height: 1;
	}
	.done > .n {
		border-color: var(--ok);
		background: var(--ok);
		color: #fff;
		font-family: var(--sans);
	}

	/* Once something is pasted: the same steps on one quiet line, each ticked when done. */
	.progress {
		list-style: none;
		margin: 0 0 1rem;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 1.5rem;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.progress li {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}
	.progress .n {
		width: 1.4rem;
		height: 1.4rem;
		font-size: 0.75rem;
		border-color: var(--pencil);
	}
	.progress li.done {
		color: var(--ink);
	}
	/* The steps, then « Recommencer » at the row's end (« Texte repris … · » before it after a reload). */
	.progress-row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.25rem 1.5rem;
		margin: 0 0 1rem;
	}
	.progress-row .progress {
		margin: 0;
	}
	.restart {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 0.5rem;
		margin: 0;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.restart .dot {
		color: var(--pencil);
	}

	/* The box and its margin marks: each error's line, a red bar and a light band (decoration). */
	.boxwrap {
		position: relative;
	}
	.mark {
		position: absolute;
		left: 1.5px;
		right: 1.5px;
		pointer-events: none;
		background: var(--danger-bg);
		mix-blend-mode: multiply;
		border-left: 4px solid var(--danger);
	}

	/* The box, then what it holds; side by side on a wide screen while the text is open. */
	textarea {
		display: block;
		width: 100%;
		height: 14rem;
		min-height: 6rem;
		resize: vertical;
		font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
		font-size: 0.875rem;
		line-height: 1.45;
		background: var(--card);
		border: 1.5px solid #b9b2a3;
		/*
		 * Long lines wrap at the box's width: nothing is clipped at the right edge,
		 * nothing scrolls sideways. The margin marks follow the wrapped lines (a
		 * hidden copy of the box, same width and font, measures them).
		 */
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		word-break: normal;
		overflow-x: hidden;
	}
	textarea::selection {
		background: var(--highlight);
		color: var(--highlight-ink);
	}
	@media (max-width: 68.74rem) {
		textarea.short {
			height: 9rem;
		}
	}
	/* Every file passes: the text folds to its one-line summary, the result takes the width. */
	.input.folded textarea {
		display: none;
	}
	.input.folded .status {
		margin: 0 0 1rem;
		padding: 0.55rem 0.9rem;
		background: var(--card);
		border: 1px solid var(--edge);
		border-radius: var(--radius);
	}
	.status {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.2rem 0;
		margin: 0.4rem 0 0;
		color: var(--ink-soft);
	}
	.status > :not(:first-child):not(.linkish)::before {
		content: '·';
		margin: 0 0.55em;
		color: var(--pencil);
	}
	.status .linkish {
		margin-left: 1rem;
	}
	/* A phone: the counts on one line, "Modifier le texte" under them. */
	@media (max-width: 40rem) {
		.input.folded .status {
			font-size: var(--step--1);
		}
		.input.folded .status .linkish {
			flex-basis: 100%;
			margin-left: 0;
			text-align: left;
		}
	}
	.status strong {
		color: var(--ink);
	}
	.linkish {
		font: inherit;
		font-weight: 600;
		color: var(--link);
		background: none;
		border: 0;
		padding: 0.35rem 0;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	@media (pointer: coarse), (max-width: 40rem) {
		.linkish {
			min-height: 2.75rem;
		}
	}
	.result {
		margin-top: 1.25rem;
	}
	.input.folded + .result {
		margin-top: 0;
	}
	@media (min-width: 68.75rem) {
		.work.split {
			display: grid;
			grid-template-columns: minmax(20rem, 2fr) minmax(0, 3fr);
			gap: 2rem;
			align-items: start;
		}
		.split .input {
			position: sticky;
			top: 1rem;
		}
		.split textarea {
			height: clamp(16rem, calc(100vh - 20rem), 40rem);
		}
		/* Errors to settle: the text is where she works, half the width. */
		.work.split.errs {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}
		.split .result {
			margin-top: 0;
		}
	}

	.outside {
		margin-bottom: 1rem;
		background: #fff8d6;
		padding: 0.5rem 0.9rem;
		border-left: 4px solid var(--highlight);
	}
	.outside summary {
		cursor: pointer;
		font-weight: 600;
	}
	.outside pre {
		white-space: pre-wrap;
		font-size: 0.9rem;
	}

	/* One pasted file: a plain card, its state on the left edge. */
	.file {
		background: var(--card);
		border: 1px solid var(--edge);
		border-left: 4px solid var(--ok);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: 0.9rem 1rem 1rem;
	}
	.file + .file {
		margin-top: 1.25rem;
	}
	.file.bad {
		border-left-color: var(--danger);
	}
	.file header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.9rem;
	}
	.title {
		flex: 1 1 14rem;
		min-width: 0;
	}
	.file h2 {
		font-size: var(--step-2);
		margin: 0;
	}
	.counts {
		margin: 0.1rem 0 0;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.edit {
		min-height: 2.75rem;
	}
	.state {
		font-weight: 700;
		font-size: var(--step--1);
		color: var(--danger);
		white-space: nowrap;
	}
	.state.okay {
		color: var(--ok);
	}
	.state.okay::before {
		content: '✓ ';
	}
	.warn {
		background: var(--danger-bg);
		padding: 0.5rem 0.75rem;
		border-left: 4px solid var(--danger);
	}

	/* A decision only she can make: first in the card, a question and its answers. */
	.decision {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
		margin: 0.85rem 0 0;
		padding: 0.75rem 0.9rem;
		background: var(--info-bg);
		border: 1px solid var(--edge);
		border-left: 4px solid var(--info-edge);
		border-radius: var(--radius);
	}
	.decision > p {
		flex: 1 1 100%;
		margin: 0;
	}
	.decision .ask {
		font-weight: 700;
	}
	.decision.settled {
		background: none;
		border-color: var(--edge);
		border-left-color: var(--pencil);
	}
	.answered {
		color: var(--ink-soft);
	}
	.answered .linkish {
		margin-left: 0.4rem;
	}
	/* The same-dish question: one line, its answers inline at its end. */
	.decision.dup {
		padding: 0.5rem 0.8rem;
	}
	.dup-line {
		line-height: 1.5;
	}
	.answers {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.6rem;
	}
	/* The vault recipes it may join: title, where it is from, why asked; picked when several. */
	.targets {
		flex: 1 1 100%;
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.25rem;
	}
	.targets li {
		display: flex;
		align-items: center;
		gap: 0.5rem 0.75rem;
		padding: 0.2rem 0.5rem;
		border-radius: var(--radius);
	}
	.targets li.picked {
		background: var(--card);
		box-shadow: inset 0 0 0 1px var(--edge);
	}
	.target {
		flex: 1 1 auto;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 0.6rem;
		min-height: 2.25rem;
		align-content: center;
		cursor: default;
	}
	label.target {
		cursor: pointer;
	}
	.target input {
		align-self: center;
		margin: 0;
	}
	.t-title {
		font-weight: 700;
	}
	.t-from {
		color: var(--ink);
	}
	.t-why {
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.t-open {
		flex: 0 0 auto;
		font-size: var(--step--1);
		font-weight: 600;
		color: var(--link);
		padding: 0.35rem 0;
	}
	@media (pointer: coarse), (max-width: 40rem) {
		.target,
		.t-open {
			min-height: 2.75rem;
		}
		.t-open {
			display: inline-flex;
			align-items: center;
		}
	}
	.answers .btn {
		min-height: 2.25rem;
		padding-block: 0.2rem;
	}
	/* « Regrouper avec … — de … » names the target: it wraps on a phone, never wider than the card. */
	.answers .same {
		white-space: normal;
		text-align: left;
		max-width: 100%;
		height: auto;
	}
	/* Two answers, both secondary (outlined): the screen's one filled button is the save. */
	.answers .same.chosen {
		border-color: var(--ink);
		box-shadow: inset 0 0 0 1px var(--ink);
	}
	@media (pointer: coarse), (max-width: 40rem) {
		.answers .btn {
			min-height: 2.75rem;
		}
	}
	@media (max-width: 40rem) {
		.answers {
			display: flex;
			margin: 0.4rem 0 0;
		}
	}
	.group-what {
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.notice {
		margin: 0.75rem 0 0;
		padding: 0.5rem 0.75rem;
		background: #f2f5f9;
		border-left: 3px solid var(--link);
		border-radius: 0 var(--radius) var(--radius) 0;
	}
	.options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.chip {
		display: inline-flex;
		gap: 0.45rem;
		align-items: center;
		min-height: 2.5rem;
		padding: 0.25rem 0.75rem;
		background: var(--card);
		border: 1.5px solid #b7c0cc;
		border-radius: 999px;
		cursor: pointer;
		font-weight: 600;
		font-size: var(--step--1);
	}
	.chip:has(input:checked) {
		border-color: var(--ink);
		box-shadow: inset 0 0 0 1px var(--ink);
	}
	/* The radio itself: 22 px, inside a 44 px label on a phone. */
	.chip input {
		width: 1.375rem;
		height: 1.375rem;
		margin: 0;
		flex: none;
		accent-color: var(--ink);
	}
	.chip:has(input:focus-visible) {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	@media (max-width: 40rem) {
		.options {
			flex-direction: column;
			align-items: stretch;
			flex: 1 1 100%;
		}
		.chip {
			border-radius: var(--radius);
			font-size: var(--step-0);
		}
	}
	/* E103 settled by the choice: one quiet line under it. */
	.settled-note {
		color: var(--ok);
		font-weight: 600;
		font-size: var(--step--1);
	}
	@media (pointer: coarse), (max-width: 40rem) {
		.chip {
			min-height: 2.75rem;
		}
	}
	.family-fields {
		flex-basis: 100%;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
	}
	.pair-note {
		flex-basis: 100%;
		margin: 0;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.family-fields label {
		display: flex;
		flex-direction: column;
		font-size: var(--step--1);
		font-weight: 600;
	}
	.diag {
		margin-top: 0.85rem;
	}
	.diag summary,
	.diag-head {
		cursor: pointer;
		font-weight: 700;
		margin: 0;
		width: fit-content;
	}
	.diag-head {
		cursor: default;
	}
	.diag.error {
		padding: 0.5rem 0.75rem;
		background: var(--danger-bg);
		border-left: 3px solid var(--danger);
		border-radius: 0 var(--radius) var(--radius) 0;
	}
	.diag.error summary {
		color: var(--danger);
	}
	.diag.warning summary,
	.diag-head {
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	@media (pointer: coarse), (max-width: 40rem) {
		.diag.error summary,
		.diag.warning summary {
			/* Padding, not flex: a flex summary loses its disclosure triangle. */
			padding: 0.7rem 0;
		}
	}
	.diag ul {
		list-style: none;
		padding: 0;
		margin: 0.25rem 0 0;
	}
	/* No step read: W401 and its fix, open, right where she decides to save. */
	.diag.stepless {
		padding: 0.25rem 0.75rem;
		background: var(--info-bg);
		border-left: 3px solid var(--info-edge);
		border-radius: 0 var(--radius) var(--radius) 0;
	}

	/* The card's photo, kept with the recipe after its save. */
	.card-photo {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.75rem;
		margin-top: 0.85rem;
		font-size: var(--step--1);
	}
	.card-photo .hint {
		flex: 1 1 14rem;
	}
	.pick-card {
		display: inline-flex;
		align-items: center;
		min-height: 2.5rem;
	}
	.pick-card:focus-within {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	.photo-note {
		color: var(--ink-soft);
	}

	/* After a save: the photo sent to the AI, offered to the recipe. */
	.attach {
		display: flex;
		gap: 0.9rem;
		align-items: flex-start;
		margin: 0 0 1rem;
		padding: 0.75rem 0.9rem;
		background: var(--card);
		border: 1px solid var(--edge);
		border-left: 4px solid var(--ok);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}
	.attach-thumb {
		flex: none;
		width: 4.5rem;
		height: 4.5rem;
		object-fit: cover;
		border: 1px solid var(--edge);
		border-radius: var(--radius);
	}
	.attach-body {
		min-width: 0;
		flex: 1;
	}
	.attach-ask {
		margin: 0 0 0.5rem;
		font-weight: 600;
	}
	.attach-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
	}
	.attach-actions .btn {
		min-height: 2.75rem;
		max-width: 100%;
		white-space: normal;
		text-align: left;
	}
	@media (max-width: 40rem) {
		.attach {
			gap: 0.7rem;
		}
		.attach-thumb {
			width: 3.25rem;
			height: 3.25rem;
		}
	}
	.attached {
		margin: 0;
		color: var(--ok);
		font-weight: 600;
	}

	/* A quick fix: one tap when there is one answer, else the value, the closed list, Remplacer. */
	.quick-one {
		min-height: 2.5rem;
		font-weight: 700;
	}
	/* A new tag: « Utiliser « Érable » », then « Garder « Erable » », quieter. */
	.tag-fix {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 1rem;
	}
	.tag-fix .keep {
		font-size: var(--step--1);
		font-weight: 500;
		color: var(--ink-soft);
	}
	/* The one-tap unit fix: a flex item of the error's action row (beside "Montrer dans le texte"). */
	.quick-btn {
		min-height: 2.5rem;
	}
	/* E106: one button per source type, wrapping, apart. */
	.type-fix {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.type-fix .quick-btn {
		min-height: 2.75rem;
	}
	/* "Autre unité…": under the action row. */
	.other-unit {
		order: 2;
		flex-basis: 100%;
		font-size: var(--step--1);
	}
	/* Small and quiet under the one button: a link-like disclosure. */
	.diag .other-unit summary {
		cursor: pointer;
		width: fit-content;
		color: var(--link);
		font-weight: 500;
		text-decoration: underline;
		text-underline-offset: 0.2em;
		padding: 0.3rem 0;
	}
	@media (pointer: coarse), (max-width: 40rem) {
		.diag .other-unit summary {
			min-height: 2.75rem;
			display: flex;
			align-items: center;
		}
	}
	.other-unit .quick {
		margin-top: 0.35rem;
	}
	@media (pointer: coarse), (max-width: 40rem) {
		.quick-one,
		.quick-btn {
			min-height: 2.75rem;
		}
		.diag .other-unit summary {
			box-sizing: border-box;
			min-height: 2.75rem;
			padding: 0.75rem 0;
		}
	}
	.quick {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.6rem;
	}
	.quick label {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.6rem;
		font-weight: 600;
		font-size: var(--step--1);
	}
	.quick select {
		min-height: 2.5rem;
		max-width: 100%;
	}
	.quick .btn {
		min-height: 2.5rem;
	}
	@media (pointer: coarse), (max-width: 40rem) {
		.quick select,
		.quick .btn {
			min-height: 2.75rem;
		}
	}
	/* E101: « Titre : [____] Ajouter », the field taking the room it can. */
	.title-fix {
		flex: 1 1 18rem;
		min-width: 0;
	}
	.title-fix label {
		flex: 1 1 12rem;
		min-width: 0;
		flex-wrap: nowrap;
	}
	.title-fix input {
		flex: 1 1 auto;
		min-width: 0;
		min-height: 2.5rem;
		font: inherit;
		font-weight: 400;
		font-size: var(--step-0);
	}
	@media (pointer: coarse), (max-width: 40rem) {
		.title-fix input {
			min-height: 2.75rem;
		}
	}

	/* E002: the line as it is in the box, numbered, the line above for context, a caret under the place. One scroll for all three. */
	.excerpt {
		margin: 0.5rem 0 0.25rem;
		overflow-x: auto;
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 0.4rem 0;
	}
	.excerpt-grid {
		display: grid;
		grid-template-columns: auto 1fr;
		width: max-content;
		min-width: 100%;
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.8125rem;
		line-height: 1.5;
	}
	.excerpt .ln {
		padding: 0 0.6rem 0 0.75rem;
		text-align: right;
		color: var(--ink-soft);
		user-select: none;
		font-variant-numeric: tabular-nums;
	}
	.excerpt code {
		font: inherit;
		white-space: pre;
		padding-right: 0.75rem;
	}
	.excerpt .bad {
		background: var(--danger-bg);
	}
	.excerpt .ln.bad {
		color: var(--danger);
		font-weight: 700;
		box-shadow: inset 3px 0 0 var(--danger);
	}
	.excerpt .caret {
		color: var(--danger);
		font-weight: 700;
		line-height: 1;
	}
	.later-head {
		margin: 0.35rem 0 0;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	/* « Détails pour le dépannage »: one per file, small, last. */
	.trouble {
		margin-top: 0.6rem;
		font-size: 0.875rem;
		color: var(--ink-soft);
	}
	.trouble summary {
		cursor: pointer;
		width: fit-content;
		padding: 0.35rem 0;
	}
	@media (pointer: coarse), (max-width: 40rem) {
		.trouble summary {
			min-height: 2.75rem;
			box-sizing: border-box;
			padding-block: 0.8rem;
		}
	}
	.trouble ul {
		margin: 0.25rem 0 0;
		padding: 0;
	}
	/* Just saved: a card at the top, the way to the recipe and to the next one. */
	.saved-card {
		margin: 0 0 1rem;
		padding: 0.9rem 1.1rem;
		background: var(--ok-bg);
		border: 1px solid var(--edge);
		border-left: 4px solid var(--ok);
		border-radius: var(--radius);
	}
	.saved-head {
		margin: 0;
		font-size: 1.0625rem;
		line-height: 1.4;
	}
	.saved-head .tick-ok {
		color: var(--ok);
		font-weight: 700;
		margin-right: 0.3rem;
	}
	.saved-list {
		margin: 0.35rem 0 0;
		padding-left: 1.6rem;
	}
	.saved-list li {
		padding: 0.15rem 0;
	}
	.saved-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.7rem;
	}
	@media (max-width: 40rem) {
		.saved-actions .btn {
			flex: 1 1 auto;
			min-height: 2.75rem;
		}
	}
	/* The quick fixes made: one line above the files, the last one undone from it. */
	.fixes-line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 0.5rem;
		margin: 0 0 0.6rem;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.fixes-line strong {
		color: var(--ink);
		font-weight: 600;
	}
	.fixes-line .tick-ok {
		color: var(--ok, var(--ink));
	}
	.fixes-line .linkish {
		min-height: 2.75rem;
	}
	@media (max-width: 40rem) {
		.fixes-line .last {
			display: none;
		}
	}
	/* « N ingrédients à relier plus tard »: one row, the lines inside. */
	.link-later {
		list-style: none;
	}
	.link-later summary {
		cursor: pointer;
		padding: 0.3rem 0;
		width: fit-content;
	}
	.link-later ul {
		margin: 0.2rem 0 0;
		padding: 0 0 0 0.75rem;
		border-left: 2px solid var(--line);
	}
	@media (pointer: coarse), (max-width: 40rem) {
		.link-later summary {
			min-height: 2.75rem;
			display: flex;
			align-items: center;
		}
	}

	/* An English page imported: first on its card, the translation by the AI its main action. */
	.lang-note {
		margin: 0.85rem 0 0;
		padding: 0.75rem 0.9rem;
		background: var(--info-bg);
		border: 1px solid var(--edge);
		border-left: 4px solid var(--info-edge);
		border-radius: var(--radius);
	}
	.lang-note p {
		margin: 0;
	}
	.lang-tag {
		font-size: var(--step--1);
		font-weight: 700;
		color: var(--ink-soft);
		margin-right: 0.4rem;
	}
	.lang-help {
		font-size: var(--step--1);
		color: var(--ink-soft);
		margin-top: 0.2rem !important;
	}
	.lang-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
		margin-top: 0.6rem;
	}
	.lang-actions .btn {
		min-height: 2.75rem;
	}
	.lang-actions .ext {
		margin-left: 0.3em;
	}

	.preview {
		margin-top: 1rem;
	}
	.preview summary {
		cursor: pointer;
		font-weight: 700;
		color: var(--link);
		margin-bottom: 0.5rem;
		width: fit-content;
	}
	@media (pointer: coarse), (max-width: 40rem) {
		.preview summary {
			/* Padding, not flex: a flex summary loses its disclosure triangle. */
			padding: 0.65rem 0;
		}
	}
	/* A file with errors: its preview greyed (still readable), under a dashed rule. */
	.preview.partial {
		margin-top: 1.25rem;
		padding-top: 0.75rem;
		border-top: 1px dashed var(--edge);
	}
	.preview.partial summary {
		color: var(--ink-soft);
	}
	.partial-note {
		margin: 0 0 0.75rem;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.partial-view {
		opacity: 0.72;
		filter: grayscale(0.6);
	}

	/*
	 * Save: at the foot of the file's card (one file) or of the files (several),
	 * sticky at the bottom of the screen while the card is in view — always in
	 * reach, never jumping. At the card's end it is in its own place, so the
	 * card's last line is never under it. Focus and "Montrer" scroll clear of it
	 * (scroll-padding); the layout's bottom padding leaves room under it.
	 */
	.save-slot {
		position: sticky;
		bottom: 0;
		z-index: 10;
		margin: 1rem 0 0;
	}
	.file .save-slot {
		margin: 1rem -1rem -1rem;
	}
	.savebar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.5rem 0.9rem;
		min-height: 3.5rem;
		padding: 0.5rem 0.9rem calc(0.5rem + env(safe-area-inset-bottom));
		background: var(--card);
		border: 1px solid var(--edge);
		border-radius: var(--radius);
		box-shadow: 0 -6px 14px -10px rgba(28, 42, 66, 0.35);
	}
	/* In the file's card: its foot, edge to edge, a rule above. */
	.file .savebar {
		padding-inline: 1rem;
		border: 0;
		border-top: 1px solid var(--line);
		border-radius: 0 0 var(--radius) var(--radius);
	}
	:global(html:has(.paste-save)) {
		scroll-padding-bottom: 5.5rem;
	}
	.why {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.9rem;
		font-size: var(--step--1);
	}
	.why .ok > span {
		margin-right: 0.3em;
	}
	.why .ok {
		color: var(--ok);
		font-weight: 700;
		font-size: var(--step-0);
	}
	.jump {
		font: inherit;
		font-weight: 600;
		color: var(--ink-soft);
		background: none;
		border: 0;
		padding: 0.4rem 0;
		min-height: 2.75rem;
		cursor: pointer;
		text-align: left;
		text-decoration: underline dotted;
		text-underline-offset: 0.2em;
	}
	/* Why the save is off, said plainly at body size: a link to the first error. */
	.jump.blocked {
		color: var(--danger);
		font-size: var(--step-0);
		text-decoration-style: solid;
	}
	.jump:hover {
		text-decoration-style: solid;
	}
	.save {
		flex: none;
		min-height: 2.75rem;
		max-width: 100%;
		white-space: normal;
		text-align: left;
	}
	.fix {
		min-height: 2.75rem;
	}
	.save .brief {
		display: none;
	}
	/* The one fix request, under the errors. */
	.ai-fix {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.9rem;
		margin-top: 0.6rem;
		padding-top: 0.6rem;
		border-top: 1px solid rgba(160, 40, 40, 0.18);
	}
	.ai-fix .btn {
		background: var(--card);
	}
	/* No keyboard shortcut to show on a touch screen. */
	@media (hover: none), (pointer: coarse) {
		.save kbd {
			display: none;
		}
	}
	/* A phone: one line, what holds it back (or ✓) and a short Enregistrer; the fix request sits under the errors. */
	@media (max-width: 40rem) {
		.savebar {
			flex-wrap: nowrap;
			padding-inline: 0.75rem;
		}
		.savebar {
			min-height: 3.25rem;
			padding-block: 0.35rem calc(0.35rem + env(safe-area-inset-bottom));
		}
		/* On a phone, "Valide" is its ✓ alone (still read out): the button's whole label on one line. */
		.why .ok {
			font-size: 0;
		}
		.why .ok > span {
			margin-right: 0;
			font-size: 1.25rem;
		}
		/* The fix and "Montrer dans le texte" on one row. */
		.diag.error {
			padding-inline: 0.6rem;
		}
		.save {
			min-width: 8.5rem;
			max-width: 70%;
			justify-content: center;
			text-align: center;
		}
		.save .long,
		.save kbd {
			display: none;
		}
		.save .brief {
			display: inline;
		}
		.ai-fix .btn {
			width: 100%;
			justify-content: center;
		}
		.add:not(.empty) textarea:not(.short) {
			height: 10rem;
		}
		/*
		 * Errors to settle: the box is short (seven lines, scrolled to the first
		 * error's line) so the error card and its fix sit right under that line,
		 * on the first screen. She can drag it taller.
		 */
		.add.errs textarea:not(.short) {
			height: calc(7 * 1.45 * 0.875rem + 0.9rem + 3px);
		}
		/* On a phone with errors, the steps line gives its room to the problem. */
		.add.errs .progress {
			display: none;
		}
		.progress {
			gap: 0.3rem 1rem;
		}
	}
	/* The toast clears the save bar. */
	.toast.lifted {
		bottom: 5rem;
	}
	@media (max-width: 40rem) {
		.toast.lifted {
			bottom: calc(7.5rem + env(safe-area-inset-bottom));
		}
	}
	.toast-action {
		color: #fff;
		margin-left: 0.75rem;
	}
	.toast.error {
		background: var(--danger);
	}
</style>
