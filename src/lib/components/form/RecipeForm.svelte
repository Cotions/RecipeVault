<script lang="ts" module>
	import type { FamilyOption, FormRecipe } from '$lib/form';
	import type { TagVocab } from './TagPicker.svelte';
	import type { CheckWords } from '$lib/vault/words';
	import type { Unit } from '$lib/vault/types';

	export interface FormPageData {
		form: FormRecipe;
		/** An edit: the recipe's slug and the hash of the file the form was opened from. */
		slug: string | null;
		hash: string | null;
		units: Unit[];
		families: FamilyOption[];
		tagVocab: TagVocab;
		tagLabels?: Record<string, string>;
		words?: CheckWords;
		/** The recipe's photo (an edit): `src` the display copy (null for a HEIC original), `thumb` the small one. */
		photo: { thumb: string | null; src?: string | null } | null;
	}

	/** A pasted file opened in the form from the paste box ("Relire et modifier"): a new recipe, its own draft slot. */
	export interface FromPaste {
		draftKey: string;
		/** Back to the pasted recipes, nothing saved (the draft stays). */
		onback: () => void;
		/** Saved: the paste box takes the file out and goes on; true when that is back to the other pasted recipes. */
		onsaved: (slug: string) => Promise<boolean>;
	}
</script>

<script lang="ts">
	// The recipe form (plan 04, Phases 4–5): a new recipe (/nouvelle) or an
	// edit (/r/<slug>/modifier). She never sees Markdown, YAML or marker
	// syntax; invalid states are prevented field by field and Save says what
	// is missing. One request saves; the toast offers "Annuler". The form state
	// is kept on the device while she types (Q17 A); a stale save shows both
	// versions side by side (Q18 A).
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import ItemRow from './ItemRow.svelte';
	import Marks from './Marks.svelte';
	import DurationField from './DurationField.svelte';
	import FamilyPicker from './FamilyPicker.svelte';
	import TagPicker from './TagPicker.svelte';
	import StaleCompare from './StaleCompare.svelte';
	import ListPaste from './ListPaste.svelte';
	import Suggest, { type Option } from './Suggest.svelte';
	import { undoSave } from './undo';
	import Menu from '../Menu.svelte';
	import {
		blockText,
		blocksImplicitSubmit,
		draftDiffers,
		fieldId,
		invalidMessage,
		listParts,
		mergeBlocks,
		packDraft,
		reasonGroups,
		reasonLine,
		reasonShort,
		saveSentence,
		sectionOf,
		sectionStates,
		stepEnter,
		unpackDraft,
		FORM_SECTIONS,
		type DraftPair,
		type FormDraft,
		type FormSectionKey
	} from './formui';
	import {
		addGroup,
		addItem,
		addStepRow,
		blankItem,
		blockOn,
		blocks as blocksOf,
		clearDraft,
		draftKey,
		ensureSection,
		fillItems,
		fillSteps,
		freeStepsToMethod,
		loadDraft,
		preambleSteps,
		move,
		nextStepRow,
		parseGives,
		splitAmount,
		stepTimeChange,
		durationInputText,
		removeAt,
		restoreAt,
		saveDraft,
		draftClock,
		showGroups,
		uncertainFields,
		unitMenu,
		variantPrefill,
		type Block,
		type ListedGroup,
		type ListedStep,
		type FormHint,
		type DurationValue,
		type MethodSection,
		type OtherSection,
		type StepRow,
		type TextKind,
		type TextSection
	} from '$lib/form';
	import { t, familyLabel, form as f } from '$lib/i18n';
	import { locale } from '$lib/prefs';
	import { toast } from '$lib/toast.svelte';
	import { unitLabel } from '$lib/render/ingredient';
	import { SOURCE_TYPES, SEASONS } from '$lib/vault/vocab';
	import { slugify } from '$lib/vault/slug';
	import { stripMarkers } from '$lib/vault/markers';

	let { data, paste }: { data: FormPageData; paste?: FromPaste } = $props();

	const TEXT_KINDS: TextKind[] = ['notes', 'variants', 'alternatives'];
	const TAPS = [
		['difficulty', f.difficulty, f.difficultyLevels],
		['rating', f.rating, f.ratingLevels]
	] as const;
	const TIMES = [
		['prep', f.prepTime],
		['cook', f.cookTime],
		['rest', f.restTime],
		['total', f.totalTime]
	] as const;
	/**
	 * The form as she edits it: Préparation and the three text sections always
	 * there (an empty one is not written) — a recipe whose steps sit under no
	 * heading still has a Préparation to type in, its text shown as « Texte libre ».
	 */
	function prepare(src: FormRecipe): FormRecipe {
		// A copy, never the proxy of a draft or a stale answer held in state.
		const copy = $state.snapshot(src) as FormRecipe;
		ensureSection(copy, 'method');
		for (const k of TEXT_KINDS) ensureSection(copy, k);
		return copy;
	}

	// The page's data is read once: the form is hers from here on.
	const slug = untrack(() => data.slug);
	const from = untrack(() => paste);
	const key = from?.draftKey ?? draftKey(slug ?? undefined);
	let form = $state(prepare(untrack(() => data.form)));
	let base = $state(untrack(() => (data.slug && data.hash ? { slug: data.slug, hash: data.hash } : undefined)));
	let initial = untrack(() => $state.snapshot(form)) as FormRecipe;

	let newFamilyLabel = $state('');
	let pair = $state<DraftPair | null>(null);
	let hints = $state<FormHint[]>([]);
	let same = $state<{ slug: string; title: string; hash: string; family: string | null }[]>([]);
	/** W505: vault recipes with nearly the same ingredients (plan 05, Phase 6). */
	let close = $state<{ slug: string; title: string; hash: string; family: string | null }[]>([]);
	/** Vault recipes whose title this one holds whole, or holds this one (« Pouding au riz » / « … de la voisine »): offered as variants. */
	let like = $state<{ slug: string; title: string; hash: string; family: string | null; author: string }[]>([]);
	let saving = $state(false);
	let message = $state<string | null>(null);
	let stale = $state<{ theirs: { form: FormRecipe; hash: string } } | null>(null);
	let foundDraft = $state<FormDraft | null>(null);
	let decided = $state(false);
	/** The draft she went past by typing in the form (usability round 5): still offered, in a quiet line. */
	let setAside = $state<FormDraft | null>(null);
	/** Enregistrer was pressed while the draft question was open: the banner says to choose first. */
	let draftAsk = $state(false);
	/** When the autosave last wrote the draft (« Brouillon gardé · 04 h 16 »), null while none is kept. */
	let keptAt = $state<number | null>(null);
	let draftBanner = $state<HTMLElement>();
	let photoFile = $state<File | null>(null);
	let photoPreview = $state<string | null>(null);
	let photoRemove = $state(false);
	let ovenRange = $state(false);
	const qtyInputs: Record<string, HTMLInputElement | undefined> = $state({});

	/** What the vault check (the live check, a refused save) found that the browser cannot: E213, E103. */
	let serverBlocks = $state<Block[]>([]);
	const blocks: Block[] = $derived(mergeBlocks(blocksOf(form), serverBlocks));
	const uncertain = $derived(uncertainFields(form).length);
	const groupsShown = $derived(showGroups(form));
	const method = $derived(form.sections.find((s) => s.kind === 'method') as MethodSection | undefined);
	const textSection = (k: TextKind) => form.sections.find((s) => s.kind === k) as TextSection;
	const units = untrack(() => data.units);
	const unitName = (u: Unit) => (u === 'piece' ? f.piece : unitLabel(u, 1, locale()));
	const recipeBlock = (field: string) => blockOn(blocks, 'recipe', field);
	/** The French line under a field of the recipe itself (the first of `fields` blocked). */
	const recipeErr = (...fields: string[]) => blockText(fields.map(recipeBlock).find(Boolean));
	const rowErr = (id: string, field: string) => blockText(blockOn(blocks, id, field));
	const titleHints = $derived(hints.filter((h) => h.code === 'W503'));
	const sameOffer = $derived(same.filter((s) => s.slug !== pair?.slug)[0]);
	/** The first close recipe not already offered by title, nor already paired. */
	// A close recipe already in this recipe's group is not offered: there is nothing to do about it (usability round 4).
	const closeOffer = $derived(close.filter((c) => c.slug !== pair?.slug && c.slug !== sameOffer?.slug && !(form.family && c.family === form.family))[0]);
	type Other = { slug: string; title: string; hash: string; family: string | null };
	/**
	 * The one line under the title (its room kept, so nothing moves when it
	 * shows): the same title (W608) first, then close ingredients (W505 —
	 * whatever the family: a copy put in the wrong family is what it is for;
	 * the pair offer only when this recipe has none), then a near title (W503).
	 */
	const titleNote = $derived.by((): { testid: string; text: string; short?: string; slug: string; pairWith?: Other } | undefined => {
		if (sameOffer && !form.family) return { testid: 'same-title', text: f.titleSame, short: f.titleSameShort, slug: sameOffer.slug, pairWith: sameOffer };
		if (closeOffer) return { testid: 'close-recipe', text: f.titleClose(closeOffer.title), slug: closeOffer.slug, pairWith: form.family ? undefined : closeOffer };
		const h = titleHints[0];
		if (h?.slug) return { testid: 'near-title', text: f.titleNear(h.value ?? ''), slug: h.slug };
		const l = like.find((x) => x.slug !== pair?.slug && !(form.family && x.family === form.family));
		if (l) return { testid: 'like-title', text: f.titleLike(l.title, l.author), slug: l.slug, pairWith: form.family ? undefined : l };
		return undefined;
	});

	/** What keeps Save disabled, as short French lines, once each, with the first field each one is about. */
	const reasons = $derived.by(() => {
		const out = new Map<string, Block>();
		for (const b of blocks) if (!out.has(reasonLine(b))) out.set(reasonLine(b), b);
		if (pair && !pair.variant.trim() && !out.has(f.blocks.variant)) out.set(f.blocks.variant, { id: 'recipe', field: 'pairVariant', reason: 'variant' });
		return [...out].map(([text, block]) => ({ text, block }));
	});
	/** The save bar's sentence: « Il manque : un titre et un ingrédient. À corriger : un temps. » */
	const said = $derived(reasonGroups(reasons));
	const sentence = $derived(saveSentence(said, locale()));
	/** One half of the sentence as the language joins a list (« a, b et c »): each item its field's button, the joins plain text. */
	function parts<R extends { text: string; block: Block }>(rs: R[]): { text: string; r?: R }[] {
		let k = 0;
		return listParts(
			rs.map((r) => r.text),
			locale()
		).map((p) => (p.item ? { text: p.text, r: rs[k++] } : { text: p.text }));
	}
	const missingParts = $derived(parts(said.missing));
	const fixParts = $derived(parts(said.fix));
	/**
	 * The first thing keeping Save off, in the order of the form (the title
	 * before the ingredients, before Classement): where the count, a blocked
	 * Enregistrer and Ctrl+Entrée take her (usability round 3).
	 */
	const firstReason = $derived.by(() => {
		const at = (r: { block: Block }) => {
			const k = sectionOf(r.block, form);
			return k ? FORM_SECTIONS.indexOf(k) : FORM_SECTIONS.length;
		};
		const r = reasons.reduce<(typeof reasons)[number] | undefined>((best, x) => (!best || at(x) < at(best) ? x : best), undefined);
		return r && { ...r, ...reasonShort(r.block) };
	});
	/** Save was tried while not ready: each field says why, a required one too (it waits quietly before). */
	let tried = $state(false);

	/** The fields that live in Classement: a block on one opens it. */
	const CLASS_FIELDS = ['family', 'variant', 'lang', 'tags', 'season', 'difficulty', 'rating'];
	const inClass = (b: Pick<Block, 'id' | 'field'>) => b.id === 'recipe' && CLASS_FIELDS.some((k) => b.field === k || b.field.startsWith(`${k}.`) || b.field.startsWith(`${k}[`));

	/** A reason in the save bar, touched (or Enregistrer before it is ready): the field it is about, in sight and focused. */
	async function jump(b: Pick<Block, 'id' | 'field'>) {
		tried = true;
		// She left the field for the bar: the bars are back in place before the page moves.
		clearTimeout(typingTimer);
		typing = false;
		if (inClass(b) && !classOpen) {
			classOpen = true;
			await tick();
		}
		if (!notesOpen && TEXT_KINDS.some((k) => textSection(k)?.id === b.id)) notesOpen = true;
		if (b.id === 'recipe' && b.field === 'source.note') noteAsked = true;
		if (b.id === 'recipe' && (b.field === 'times.rest' || b.field === 'times.total')) timesAsked = true;
		await tick();
		// « Ce qui distingue » shown under the title (« En faire une variante »): that one, in sight.
		const elId = b.id === 'recipe' && b.field === 'variant' && joined ? 'variant-inline' : fieldId(b, form);
		const el = (elId && document.getElementById(elId)) || document.querySelector<HTMLElement>('.recipe-form [aria-invalid="true"]');
		// No field to take her to: the sentence at the end of the form says what is missing.
		if (!el) return document.querySelector('[data-testid="savebar"]')?.scrollIntoView({ block: 'center' });
		const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		el.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
		el.focus({ preventScroll: true });
	}

	/** Variantes and Remplacements: a box once they hold text or she asks for one. */
	let textAsked = $state<TextKind[]>(['notes']);
	$effect(() => {
		const filled = TEXT_KINDS.filter((k) => textSection(k)?.text.trim());
		untrack(() => {
			const more = filled.filter((k) => !textAsked.includes(k));
			if (more.length) textAsked = [...textAsked, ...more];
		});
	});

	// ---------------------------------------------------------------- what shows folded

	/**
	 * Notes (and Variantes, Remplacements) open folded to one line, like the
	 * photo and Classement under them: their first words and « Modifier », or
	 * « Aucune note » and « Ajouter ». The form is long, and the ingredients and
	 * steps are what she came for. Something in them that needs her (a block, an
	 * uncertain reading) opens them; once open they stay open.
	 */
	let notesOpen = $state(false);
	const notesNeeds = $derived.by(() => {
		const ids = new Set(TEXT_KINDS.map((k) => textSection(k)?.id).filter(Boolean));
		return blocks.some((b) => ids.has(b.id)) || uncertainFields(form).some(([id]) => ids.has(id));
	});
	$effect(() => {
		if (notesNeeds) untrack(() => (notesOpen = true));
	});
	/** The folded line: the start of the notes, and which other texts there are. */
	const notesSummary = $derived.by(() => {
		const filled = TEXT_KINDS.filter((k) => textSection(k)?.text.trim());
		const first = filled[0] ? stripMarkers(textSection(filled[0]).text).replace(/\s+/g, ' ').trim() : '';
		const lead = first.length > 90 ? `${first.slice(0, 88).trimEnd()}…` : first;
		return [filled[0] && filled[0] !== 'notes' ? `${f[filled[0]]} : ${lead}` : lead, ...filled.slice(1).map((k) => f[k])].filter(Boolean).join(' · ');
	});

	/** Classement holds something: its folded line says what, and « Modifier » rather than « Compléter ». */
	const classFilled = (x: FormRecipe) => !!(x.family || x.tags.length || x.season.length || x.difficulty !== null || x.rating !== null);
	/** Classement opens folded, filled or not: its line says what it holds (the recipe page shows it too). */
	let classOpen = $state(false);
	// Something in it needs her (a block, the W502 question): it unfolds, and stays so.
	const classNeeds = $derived(blocks.some(inClass) || hints.some((h) => h.code === 'W502'));
	$effect(() => {
		if (classNeeds) untrack(() => (classOpen = true));
	});
	/** The folded line: what is filed, or that nothing is. */
	const classSummary = $derived.by(() => {
		const fam = data.families.find((x) => x.slug === form.family);
		const out = [
			form.family ? f.classVariantOf(newFamilyLabel || familyLabel(form.family, fam?.label ?? fam?.name)) : f.classNoVariant
		];
		if (form.season.length) out.push(form.season.map((s) => t.season[s] ?? s).join(', '));
		if (form.difficulty !== null) out.push(f.classDifficulty(f.difficultyLevels[form.difficulty - 1]));
		if (form.rating !== null) out.push(f.classRating(form.rating));
		if (form.lang !== 'fr') out.push(f.langs[form.lang] ?? form.lang);
		return out.join(' · ');
	});

	/**
	 * « Donne » is one field (round 5): « 8 », « 6 à 8 portions » are portions
	 * (`servings`, `servings_max`); « 2 tourtières », « 3 douzaines » what the
	 * recipe makes (`yield`, text). The file's keys are as the schema has them.
	 * A recipe with both shows its portions here and its yield on a line of its
	 * own (« Donne aussi »), as does a yield written as an amount (`{ qty, unit }`).
	 */
	const hasServings = (x: FormRecipe) => !!(x.servings.trim() || x.servingsMax.trim());
	const givesOf = (x: FormRecipe) =>
		hasServings(x) ? f.givesPortions(x.servings.trim(), x.servingsMax.trim()) : x.yield.kind === 'text' ? x.yield.text : '';
	/** Both: the yield in words on its own line, never overwritten by what she types in « Donne ». */
	let alsoYield = $state(untrack(() => hasServings(form) && form.yield.kind === 'text'));
	let givesText = $state(untrack(() => givesOf(form)));
	function resetGives() {
		alsoYield = hasServings(form) && form.yield.kind === 'text';
		givesText = givesOf(form);
	}
	/** What she typed in « Donne », filed: portions, or the yield in words. */
	function setGives(v: string) {
		givesText = v;
		const g = parseGives(v);
		form.servings = g.servings;
		form.servingsMax = g.servingsMax;
		if (g.yieldText) {
			form.yield = { kind: 'text', text: g.yieldText, qty: '', qtyMax: '', unit: '', note: '' };
			alsoYield = false;
		} else if (!alsoYield && form.yield.kind === 'text') {
			form.yield = { kind: 'none', text: '', qty: '', qtyMax: '', unit: '', note: '' };
		}
	}
	/** How « Donne » is filed, said under it while she types there. */
	const givesAs = $derived(hasServings(form) ? f.givesAsPortions : form.yield.kind === 'text' && !alsoYield ? f.givesAsYield : '');
	/** The nouns of the vault's yields after the amount she typed: « 2 » → « 2 portions », « 2 tourtières »… */
	async function gives(q: string): Promise<Option[]> {
		const { amount, rest } = splitAmount(q);
		if (!amount) return [];
		const res = await fetch(`/api/suggest?kind=yield&q=${encodeURIComponent(rest)}`);
		if (!res.ok) return [];
		const d = (await res.json()) as { items: string[] };
		const [lo, hi] = amount.split(/\s*(?:à|-|–)\s*/);
		const portions = f.givesPortions(lo, hi ?? '');
		const lead = !rest.trim() || portions.toLowerCase().includes(rest.trim().toLowerCase()) ? [portions] : [];
		const out = [...lead, ...d.items.map((n) => `${amount} ${n}`)].filter((v) => v !== q.trim());
		return [...new Set(out)].slice(0, 7).map((v) => ({ value: v, label: v }));
	}
	/** Provenance's précision, the rest and total times: a link until filled or asked for; once shown, they stay. */
	let noteAsked = $state(false);
	let timesAsked = $state(false);
	const timeFilled = (d: FormRecipe['times']['rest']) =>
		d.hours !== null || d.minutes !== null || d.maxHours !== null || d.maxMinutes !== null || !!(d.typed && Object.keys(d.typed).length);
	$effect(() => {
		if (form.source.note.trim() || recipeBlock('source.note')) untrack(() => (noteAsked = true));
	});
	$effect(() => {
		if (timeFilled(form.times.rest) || timeFilled(form.times.total) || recipeBlock('times.rest') || recipeBlock('times.total')) untrack(() => (timesAsked = true));
	});

	// ---------------------------------------------------------------- the parts of the form (rail, phone strip)

	/** The row she works on: on a phone the other filled rows fold to one line each. */
	let activeItem = $state<string | null>(null);

	const SECTION_EL: Record<FormSectionKey, string> = {
		title: 'sec-title',
		source: 'sec-source',
		ingredients: 'sec-ingr',
		method: 'sec-method',
		notes: 'sec-notes',
		class: 'sec-class'
	};
	const states = $derived(sectionStates(form, blocks));
	/** The phone's picker cannot draw the dots: a sign before each part's name says the same. */
	const NAV_GLYPH: Record<string, string> = { done: '✓', empty: '○', fix: '!' };
	const navKeys = $derived(FORM_SECTIONS.filter((k) => k !== 'method' || !!method));
	/** The part in sight: the last one whose top is in the top quarter of the screen (at most 180 px down; the last of all at the very bottom). */
	let current = $state<FormSectionKey>('title');
	let strip: HTMLElement | undefined = $state();
	let spyFrame = 0;
	function spy() {
		cancelAnimationFrame(spyFrame);
		spyFrame = requestAnimationFrame(() => {
			const line = Math.min(window.innerHeight / 4, 180);
			let at: FormSectionKey = navKeys[0];
			for (const k of navKeys) {
				const el = document.getElementById(SECTION_EL[k]);
				if (el && el.getBoundingClientRect().top <= line) at = k;
			}
			if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) at = navKeys[navKeys.length - 1];
			current = at;
		});
	}
	/** The strip has more chips past its left or right edge: that edge fades. */
	let moreLeft = $state(false);
	let moreRight = $state(false);
	function edges() {
		if (!strip) return;
		moreLeft = strip.scrollLeft > 2;
		moreRight = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2;
	}
	// The phone strip scrolls sideways: the part in sight kept in view in it,
	// with a little of the next chip showing (the strip is positioned, so a
	// chip's offsetLeft is measured from the strip's own left edge).
	$effect(() => {
		const k = current;
		if (!strip) return;
		if (strip.scrollWidth > strip.clientWidth) {
			const a = strip.querySelector<HTMLElement>(`[data-testid="nav-${k}"]`);
			if (a) {
				const left = a.offsetLeft;
				const pad = 40;
				if (left - pad < strip.scrollLeft || left + a.offsetWidth + pad > strip.scrollLeft + strip.clientWidth) {
					const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
					strip.scrollTo({ left: Math.max(0, left - pad), behavior: still ? 'auto' : 'smooth' });
				}
			}
		}
		edges();
	});
	/** A link of the rail: the part in sight (Classement opened), the focus on it, not on a field (no keyboard pops up). */
	async function goTo(k: FormSectionKey) {
		// She left the field for the rail: the bar and the strip are back in place before the page moves.
		clearTimeout(typingTimer);
		typing = false;
		if (k === 'class') classOpen = true;
		if (k === 'notes') notesOpen = true;
		await tick();
		const el = document.getElementById(SECTION_EL[k]);
		if (!el) return;
		const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		el.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
		el.focus({ preventScroll: true });
		current = k;
	}

	/**
	 * « + Ajouter un groupe »: the rows she typed become a group too, its name
	 * box in sight above them. That box first when it is empty and the rows are
	 * not (usability round 5: the rows read « Groupe 1 » with no name asked,
	 * the focus gone to the new group's); Entrée then takes her to the new one.
	 */
	async function addGroupHere() {
		const first = form.groups.length === 1 && !form.groups[0].name.trim() && form.groups[0].items.some((it) => !blankItem(it)) ? form.groups[0] : undefined;
		const g = addGroup(form);
		await tick();
		document.getElementById(`g-${(first ?? g).id}`)?.focus();
	}
	/** Entrée in a group's name: the next group's name while it is empty, else this group's first row. */
	async function groupNameEnter(gi: number) {
		const next = form.groups[gi + 1];
		if (next && !next.name.trim()) return document.getElementById(`g-${next.id}`)?.focus();
		const it = form.groups[gi]?.items[0];
		if (!it) return;
		activeItem = it.id;
		await tick();
		qtyInputs[it.id]?.focus();
	}

	// ---------------------------------------------------------------- draft (Q17 A)

	onMount(() => {
		const d = loadDraft(localStorage, key) as FormDraft | undefined;
		if (d && draftDiffers(d, initial)) foundDraft = d;
		else decided = true;
		try {
			scanOn = localStorage.getItem(SCAN_KEY) === '1';
		} catch {
			/* no storage: the card waits to be asked for */
		}
		spy();
		edges();
	});
	// Leaving the form: no live check fires for it afterwards, and a chosen
	// photo's preview (up to 25 MB) is let go rather than held until the tab closes.
	onDestroy(() => {
		clearTimeout(checkTimer);
		clearTimeout(typingTimer);
		if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(spyFrame);
		if (photoPreview) URL.revokeObjectURL(photoPreview);
	});

	function resumeDraft() {
		const d = foundDraft ?? setAside;
		if (!d) return;
		form = prepare(d.form);
		resetGives();
		// What she chose beside the form: a new family's label, the W608 pair.
		({ familyLabel: newFamilyLabel, pair } = unpackDraft(d));
		// The draft was typed over the version it was opened from: the stale guard compares with that one.
		if (base && d.hash) base.hash = d.hash;
		foundDraft = setAside = null;
		draftAsk = false;
		decided = true;
	}

	function discardDraft() {
		clearDraft(localStorage, key);
		keptAt = null;
		foundDraft = setAside = null;
		draftAsk = false;
		decided = true;
	}

	/**
	 * She typed in the form while « brouillon trouvé » was open (usability
	 * round 5: the form was inert then, and Enregistrer did nothing, silently):
	 * that is « Repartir de … » with her change. The old draft stays offered
	 * in a quiet line until she saves or leaves; the autosave now keeps hers.
	 */
	$effect(() => {
		if (!foundDraft) return;
		const snap = $state.snapshot(form) as FormRecipe;
		const d = packDraft(snap, { familyLabel: newFamilyLabel, pair: pair ? ($state.snapshot(pair) as DraftPair) : null }, 0);
		if (!draftDiffers(d, initial)) return;
		untrack(() => {
			setAside = foundDraft;
			foundDraft = null;
			draftAsk = false;
			decided = true;
		});
	});

	// Until she answers "brouillon trouvé" (or types, which answers it), the old draft is not overwritten.
	// After a save, nothing is written again.
	let draftTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const snap = $state.snapshot(form) as FormRecipe;
		const extras = { hash: base?.hash, familyLabel: newFamilyLabel, pair: pair ? ($state.snapshot(pair) as DraftPair) : null };
		if (!decided) return;
		draftTimer = setTimeout(() => {
			if (!decided) return;
			const d = packDraft(snap, extras, Date.now());
			if (!draftDiffers(d, initial)) {
				clearDraft(localStorage, key);
				keptAt = null;
			} else keptAt = saveDraft(localStorage, key, d) ? d.at : null;
		}, 400);
		return () => clearTimeout(draftTimer);
	});

	// ---------------------------------------------------------------- live check (Q9 A)

	let checkTimer: ReturnType<typeof setTimeout> | undefined;
	let checkSeq = 0;
	$effect(() => {
		const snap = $state.snapshot(form) as FormRecipe;
		const b = base ? { ...base } : undefined;
		clearTimeout(checkTimer);
		if (!snap.title.trim()) {
			hints = [];
			same = [];
			close = [];
			like = [];
			serverBlocks = [];
			return;
		}
		checkTimer = setTimeout(async () => {
			const mine = ++checkSeq;
			try {
				const res = await fetch('/api/form/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ form: snap, base: b }) });
				if (!res.ok || mine !== checkSeq) return;
				const got = await res.json();
				if (mine !== checkSeq) return;
				hints = got.hints ?? [];
				same = got.same ?? [];
				close = got.close ?? [];
				like = got.like ?? [];
				serverBlocks = Array.isArray(got.errors) ? got.errors : [];
			} catch {
				/* offline: no hints, nothing blocks */
			}
		}, 500);
	});

	// ---------------------------------------------------------------- rows

	function removed(text: string, undo: () => void) {
		toast.show({ text, action: { label: f.undo, run: () => (undo(), toast.close()) } }, 8000);
	}

	async function focusQty(id: string) {
		await tick();
		qtyInputs[id]?.focus();
	}

	function addRow(gi: number, after?: number) {
		const it = addItem(form.groups[gi], after);
		activeItem = it.id;
		focusQty(it.id);
	}

	/** Enter in a name: the next row — the empty one already there (a new form has three), else a new one after it (not after a row with nothing typed in it). */
	function enterRow(gi: number, i: number) {
		const g = form.groups[gi];
		if (blankItem(g.items[i])) return;
		const next = g.items[i + 1];
		if (next && blankItem(next)) {
			activeItem = next.id;
			focusQty(next.id);
			return;
		}
		addRow(gi, i);
	}

	// « Coller une liste »: one box open at a time, under the group (its id), the steps ('steps'),
	// or under a card's heading ('items-head', 'steps-head') while that card has nothing typed yet.
	let listFor = $state<string | null>(null);
	/** Nothing typed in the ingredients yet (one group, no name): « Coller une liste » is at the top of the card. */
	const itemsBlank = $derived(!groupsShown && form.groups.length === 1 && form.groups[0].items.every(blankItem));
	const stepsBlank = $derived(!!method && method.rows.every((r) => !r.text.trim()));

	function pasteItems(gi: number, list: ListedGroup[]) {
		const before = $state.snapshot(form.groups) as FormRecipe['groups'];
		const added = fillItems(form, gi, list, form.lang);
		listFor = null;
		activeItem = null;
		if (!added.length) return;
		toast.show({ text: f.pastedItems(added.length), action: { label: f.undo, run: () => ((form.groups = before), toast.close()) } }, 8000);
		shown(`it-${added[0].id}-qty`, gi);
	}

	/**
	 * After a pasted list: its first row in sight, the focus back on « Coller
	 * une liste » of that place (a phone keyboard does not pop up over the rows).
	 */
	async function shown(rowEl: string, gi: number | null) {
		await tick();
		const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		document.getElementById(rowEl)?.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
		document.querySelectorAll<HTMLElement>(gi === null ? '[data-testid="paste-steps"]' : '[data-testid="paste-items"]')[gi ?? 0]?.focus({ preventScroll: true });
	}

	// « Texte libre »: the body's text under no heading, and sections the file format does not know —
	// shown and editable, written back as they are (never invisible, never dropped).
	let freeKept = $state(false);
	const freeShown = $derived(freeKept || !!form.preamble.trim());
	$effect(() => {
		if (form.preamble.trim()) untrack(() => (freeKept = true));
	});
	const others = $derived(form.sections.filter((s): s is OtherSection => s.kind === 'other'));
	const freeSteps = $derived(preambleSteps(form.preamble)?.steps ?? 0);
	/** « Ranger ces N lignes dans Préparation »: the free text's step lines become the first steps; the toast undoes it. */
	async function freeToSteps() {
		const m = method;
		if (!m) return;
		const before = { preamble: form.preamble, rows: $state.snapshot(m.rows) as StepRow[] };
		const n = freeStepsToMethod(form);
		if (!n) return;
		toast.show(
			{
				text: f.pastedSteps(n),
				action: {
					label: f.undo,
					run: () => {
						form.preamble = before.preamble;
						m.rows.splice(0, m.rows.length, ...before.rows);
						toast.close();
					}
				}
			},
			8000
		);
		await tick();
		const first = m.rows[0] && document.getElementById(`r-${m.rows[0].id}`);
		if (!first) return;
		first.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
		first.focus({ preventScroll: true });
	}

	async function pasteSteps(list: ListedStep[]) {
		const m = method;
		if (!m) return;
		const before = $state.snapshot(m.rows) as StepRow[];
		const added = fillSteps(m.rows, list);
		listFor = null;
		if (!added.length) return;
		toast.show({ text: f.pastedSteps(added.filter((r) => r.type === 'step').length), action: { label: f.undo, run: () => (m.rows.splice(0, m.rows.length, ...before), toast.close()) } }, 8000);
		shown(`r-${added[0].id}`, null);
	}

	function removeItem(gi: number, i: number) {
		const g = form.groups[gi];
		const r = removeAt(g.items, i);
		if (!r) return;
		if (!g.items.length && form.groups.length === 1) addItem(g);
		removed(f.removedItem, () => {
			if (g.items.length === 1 && !g.items[0].name.trim() && !g.items[0].qty.trim()) g.items.splice(0, 1);
			restoreAt(g.items, r);
		});
	}

	function removeGroup(gi: number) {
		const r = removeAt(form.groups, gi);
		if (!r) return;
		if (!form.groups.length) addGroup(form);
		removed(f.removedGroup, () => restoreAt(form.groups, r));
	}

	function removeStep(i: number) {
		const m = method;
		if (!m) return;
		const r = removeAt(m.rows, i);
		if (!r) return;
		removed(f.removedStep, () => restoreAt(m.rows, r));
	}

	/** Enter at the end of a step (or in a heading): the next step, focused; Maj+Entrée keeps a new line in the step. */
	async function stepKey(e: KeyboardEvent, i: number) {
		const m = method;
		if (!m) return;
		const el = e.currentTarget as HTMLTextAreaElement | HTMLInputElement;
		const what = el.tagName === 'INPUT' ? (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing ? 'next' : null) : stepEnter(e, el);
		if (!what) return;
		e.preventDefault();
		if (what === 'stay') return;
		const r = nextStepRow(m.rows, i);
		await tick();
		document.getElementById(`r-${r.id}`)?.focus();
	}

	/**
	 * A step's time changed while Cuisson (or Préparation) still holds the old
	 * one — the box came from it: « Cuisson : 12 min → 12 à 14 min ? [Mettre à
	 * jour] » under the step, once she leaves it; never changed on its own
	 * (usability round 3). Dismissed, it goes.
	 */
	const stepWas: Record<string, string> = {};
	let nudge = $state<{ row: string; key: 'cook' | 'prep'; from: string; to: DurationValue } | null>(null);
	function stepLeft(r: StepRow) {
		const before = stepWas[r.id];
		delete stepWas[r.id];
		if (before === undefined || before === r.text) return;
		for (const key of ['cook', 'prep'] as const) {
			const to = stepTimeChange(before, r.text, form.times[key]);
			if (to) {
				nudge = { row: r.id, key, from: durationInputText(form.times[key], f.timeWords), to };
				return;
			}
		}
	}
	/** True when a step not yet left has a time change to offer: the offer shows, focused, and this save waits. */
	function heldForNudge(): boolean {
		if (nudgeHeld || !method) return false;
		for (const r of method.rows) {
			if (r.type !== 'step' || stepWas[r.id] === undefined) continue;
			stepLeft(r);
			if (nudge?.row === r.id) {
				nudgeHeld = true;
				tick().then(() => document.querySelector<HTMLButtonElement>('[data-testid="time-nudge-yes"]')?.focus());
				return true;
			}
		}
		return false;
	}
	/** One wait per visit: a second Enregistrer saves whatever the times say. */
	let nudgeHeld = false;
	function takeNudge() {
		if (!nudge) return;
		Object.assign(form.times[nudge.key], nudge.to, { typed: undefined });
		nudge = null;
	}

	const stepNumber = (i: number) => (method ? method.rows.slice(0, i + 1).filter((r) => r.type === 'step').length : 0);

	function grow(el: HTMLTextAreaElement) {
		const fit = () => {
			el.style.height = 'auto';
			el.style.height = `${el.scrollHeight + 2}px`;
		};
		fit();
		el.addEventListener('input', fit);
		return { destroy: () => el.removeEventListener('input', fit) };
	}

	// ---------------------------------------------------------------- family pair (W608, Q10 A)

	/**
	 * « En faire une variante » from the title's note joined a group that was
	 * already there: « Ce qui distingue cette variante » shows right under the
	 * note, focused (usability round 3) — not only in Classement at the end.
	 */
	let joined = $state<string | null>(null);
	const joinedShown = $derived(!!joined && form.family === joined && !pair);

	async function makePair(other: { slug: string; title: string; hash: string; family: string | null }) {
		if (other.family) {
			// The other recipe is already in a family: this one joins it, who it is from as the first guess.
			form.family = other.family;
			newFamilyLabel = '';
			if (!form.variant.trim()) form.variant = variantPrefill(form.source.author);
			joined = other.family;
			await tick();
			focusIn2('variant-inline');
			return;
		}
		// A new group named after the shorter title (« Pouding au riz », not « … de la voisine »), as « Grouper avec… » names it.
		const name = [form.title.trim(), other.title.trim()].sort((a, b) => a.length - b.length)[0];
		form.family = slugify(name);
		newFamilyLabel = name;
		pair = { slug: other.slug, hash: other.hash, title: other.title, variant: '' };
		await tick();
		focusIn2('pair-variant');
	}
	/** A field that just appeared under the title: in sight, focused. */
	function focusIn2(elId: string) {
		const el = document.getElementById(elId);
		if (!el) return;
		el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
		el.focus({ preventScroll: true });
	}

	// ---------------------------------------------------------------- source

	/** The kind of source picked: the provenance fields take its names (« Titre du livre », « Site »). */
	const srcType = $derived(form.source.type || '');
	/** A person's recipe (or no kind yet): « De qui », with an example name. */
	const personal = $derived(srcType === '' || srcType === 'family' || srcType === 'invented');
	/** A source with a name of its own: a book, a magazine, a site, a show. */
	const titled = $derived(srcType === 'book' || srcType === 'magazine' || srcType === 'website' || srcType === 'tv');

	async function authors(q: string): Promise<Option[]> {
		const res = await fetch(`/api/suggest?kind=author&q=${encodeURIComponent(q)}`);
		if (!res.ok) return [];
		const d = (await res.json()) as { items: string[] };
		return d.items.filter((a) => a !== q).map((a) => ({ value: a, label: a }));
	}

	// ---------------------------------------------------------------- photo

	function pickPhoto(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (file.size > 25 * 1024 * 1024) {
			message = t.photo.tooBig(25);
			return;
		}
		if (photoPreview) URL.revokeObjectURL(photoPreview);
		photoFile = file;
		photoPreview = URL.createObjectURL(file);
		photoRemove = false;
	}

	function dropPhoto() {
		if (photoPreview) URL.revokeObjectURL(photoPreview);
		photoFile = null;
		photoPreview = null;
	}

	/** After the recipe is saved: send the photo she chose, or remove the one she took off. The commit, if any. */
	async function photoStep(s: string, hash: string): Promise<{ commit?: string; error?: string }> {
		try {
			if (photoFile) {
				const body = new FormData();
				body.set('slug', s);
				body.set('hash', hash);
				body.set('photo', photoFile);
				const res = await fetch('/api/photo', { method: 'POST', body });
				const d = await res.json().catch(() => ({}));
				return res.ok ? { commit: d.commit } : { error: d.message ?? t.photo.failed };
			}
			if (photoRemove && data.photo) {
				const res = await fetch('/api/photo', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: s, hash }) });
				const d = await res.json().catch(() => ({}));
				return res.ok ? { commit: d.commit } : { error: d.message ?? t.photo.failed };
			}
		} catch {
			return { error: t.photo.offline };
		}
		return {};
	}

	// ---------------------------------------------------------------- the card beside the form

	/**
	 * A wide screen (≥ 1200 px), a recipe with a photo (often the card itself):
	 * « Afficher la fiche à côté » puts it in the rail, in place of the parts'
	 * links, kept in sight while she types from it; a touch enlarges it.
	 * Remembered on the device.
	 */
	const SCAN_KEY = 'rv-form-scan';
	const scanSrc = $derived(photoPreview ?? (photoRemove ? null : (data.photo?.src ?? null)));
	let scanOn = $state(false);
	let scanZoom = $state(false);
	const scanShown = $derived(scanOn && !!scanSrc);
	function toggleScan() {
		scanOn = !scanOn;
		scanZoom = false;
		try {
			localStorage.setItem(SCAN_KEY, scanOn ? '1' : '0');
		} catch {
			/* private window: not remembered */
		}
	}

	// ---------------------------------------------------------------- save

	async function save() {
		if (saving) return;
		// The draft question is open and she changed nothing yet: never a silent dead save — the question, in sight, says to choose first.
		if (foundDraft) {
			draftAsk = true;
			await tick();
			const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
			draftBanner?.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
			draftBanner?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
			return;
		}
		// Not ready: Enregistrer takes her to the first thing missing.
		if (firstReason) return jump(firstReason.block);
		// Saved from the step she is still in (Ctrl+Entrée), its time changed while Cuisson still holds the old one:
		// the save waits once, the offer under the step; Enregistrer again saves as it is (usability round 4).
		if (heldForNudge()) return;
		message = null;
		if (typeof navigator !== 'undefined' && !navigator.onLine) {
			message = f.offline;
			return;
		}
		saving = true;
		const snap = $state.snapshot(form) as FormRecipe;
		const body = {
			form: snap,
			...(base ? { base: { ...base } } : {}),
			...(newFamilyLabel && form.family ? { familyLabel: newFamilyLabel } : {}),
			...(pair && form.family ? { pair: { slug: pair.slug, hash: pair.hash, variant: pair.variant } } : {})
		};
		try {
			const res = await fetch('/api/form/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
			if (res.status === 401) {
				message = f.signedOut;
				return;
			}
			if (!res.ok) {
				message = f.failed;
				return;
			}
			const r = await res.json();
			switch (r.status) {
				case 'saved':
				case 'unchanged': {
					const commits: string[] = r.status === 'saved' && r.commit ? [r.commit] : [];
					const photo = await photoStep(r.slug, r.hash);
					if (photo.commit) commits.unshift(photo.commit);
					// Saved: no pending autosave may write the form back as a draft.
					decided = false;
					clearTimeout(draftTimer);
					clearDraft(localStorage, key);
					keptAt = null;
					setAside = null;
					dropPhoto();
					const title = stripMarkers(form.title);
					let listed = false;
					if (from) listed = await from.onsaved(r.slug);
					else await goto(`/r/${r.slug}`, { invalidateAll: true });
					// Back among the other pasted recipes: the toast links the one saved.
					const link = listed ? { link: { href: `/r/${r.slug}`, label: title } } : {};
					if (photo.error) toast.show({ text: f.photoFailed(photo.error), error: true, ...link });
					else
						toast.show({
							text: !commits.length ? f.unchanged : slug ? f.savedEdit : f.saved,
							...link,
							...(commits.length ? { action: { label: f.undo, run: () => undoSave(r.slug, commits) } } : {})
						});
					return;
				}
				case 'stale':
					if (r.theirs) stale = { theirs: r.theirs };
					else message = f.staleGone;
					window.scrollTo({ top: 0 });
					return;
				case 'invalid':
					// Each field named on its row; nothing written.
					serverBlocks = Array.isArray(r.errors) ? r.errors : [];
					message = invalidMessage(serverBlocks);
					return;
				case 'refused':
					message = r.reason === 'pair' ? f.pairChanged : r.reason === 'gone' ? f.gone : f.broken;
					if (r.reason === 'pair') pair = null;
					return;
				default:
					message = f.failed;
			}
		} catch {
			message = f.offline;
		} finally {
			saving = false;
		}
	}

	function keepMine() {
		if (!stale || !base) return;
		base.hash = stale.theirs.hash;
		stale = null;
		save();
	}

	function takeTheirs() {
		if (!stale || !base) return;
		base.hash = stale.theirs.hash;
		form = prepare(stale.theirs.form);
		resetGives();
		initial = $state.snapshot(form) as FormRecipe;
		newFamilyLabel = '';
		pair = null;
		clearDraft(localStorage, key);
		stale = null;
	}

	// ---------------------------------------------------------------- nothing floats over the field she types in

	/**
	 * Save is in the rail (a wide screen) or at the right of the strip at the
	 * top (a phone, a tablet), and at the end of the form with the whole
	 * sentence: nothing sits over the cards. While a field has the focus on a
	 * phone the strip stops floating, so the keyboard's small window is hers.
	 */
	let typing = $state(false);
	const TYPED = 'input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select';
	function focusIn(e: FocusEvent) {
		const el = e.target as HTMLElement;
		if (!el.matches?.(TYPED)) return;
		typing = window.matchMedia('(max-width: 37.5rem)').matches;
	}
	/** The short words on the quick Save while it is not ready: « 2 à compléter », « 1 à corriger ». */
	const countText = $derived.by(() => {
		const n = said.missing.length + said.fix.length;
		return !reasons.length ? '' : said.fix.length ? f.saveCountFix(n) : f.saveCountMissing(n);
	});
	let typingTimer: ReturnType<typeof setTimeout> | undefined;
	function focusOut() {
		// Back over the form a moment later, so the tap that took the focus away lands where she aimed.
		clearTimeout(typingTimer);
		typingTimer = setTimeout(() => {
			const now = document.activeElement as HTMLElement | null;
			if (!now?.matches?.(TYPED)) typing = false;
		}, 350);
	}

	const when = (ms: number) => new Date(ms).toLocaleString(`${locale()}-CA`, { dateStyle: 'medium', timeStyle: 'short' });
	const clock = (ms: number) => draftClock(ms, locale());
	const discardLabel = $derived(from ? f.draftDiscardPaste : slug ? f.draftDiscard : f.draftDiscardNew);
</script>

{#snippet amountYield()}
	{@const menu = unitMenu(units)}
	<!-- A yield written as an amount (`{ qty, unit, note }`, a sub-recipe's « 2 abaisses »): its own small editor. -->
	<input class="short" type="text" inputmode="decimal" bind:value={form.yield.qty} aria-label={f.yieldAmount} aria-invalid={!!(recipeBlock('yield.qty') || recipeBlock('yield.qtyMax')) || undefined} />
	<select class="unit" bind:value={form.yield.unit} aria-label={f.unit} aria-invalid={!!recipeBlock('yield.unit') || undefined}>
		<optgroup label={f.unitsCommon}>
			{#each menu.common as u (u)}<option value={u}>{unitName(u)}</option>{/each}
			<option value="">{f.noUnit}</option>
		</optgroup>
		<optgroup label={f.unitsOther}>
			{#each menu.rest as u (u)}<option value={u}>{unitName(u)}</option>{/each}
		</optgroup>
	</select>
	<input class="note" type="text" bind:value={form.yield.note} aria-label={f.yield} />
{/snippet}

<svelte:window onscroll={spy} onresize={() => (spy(), edges())} />

<!-- The keydown stops implicit submission and gives Ctrl/Cmd+Entrée to Enregistrer (as on /ajouter); Enregistrer itself is a button. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<form
	class="recipe-form"
	class:scan-on={scanShown}
	novalidate
	onsubmit={(e) => (e.preventDefault(), save())}
	onkeydown={(e) => {
		// Ctrl+Entrée (⌘+Entrée on a Mac) saves from any field, as on /ajouter; a box of its own using it (« Coller une liste ») keeps it.
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			if (e.defaultPrevented) return;
			e.preventDefault();
			save();
			return;
		}
		// Enter in a one-line field saves nothing: only Enregistrer saves.
		if (blocksImplicitSubmit(e.key, e.target as HTMLElement & { type?: string })) e.preventDefault();
	}}
	onfocusin={focusIn}
	onfocusout={focusOut}
>
	<header class="head">
		{#if from}
			<button type="button" class="btn quiet back" onclick={from.onback} data-testid="back-to-paste">← {f.backToPaste}</button>
			<h1>{f.pasteTitle}</h1>
			<p class="lead" data-testid="paste-lead">{f.pasteLead}</p>
		{:else}
			<h1>{slug ? f.editTitle : f.newTitle}</h1>
			<p class="back">
				<a href={slug ? `/r/${slug}` : '/'} aria-label={f.cancel} data-testid="quit">← <span class="long">{f.cancel}</span><span class="short">{f.cancelShort}</span></a>
			</p>
		{/if}
	</header>

	{#if foundDraft}
		<!-- The form stays live: typing in it answers « Repartir de … » with her change (round 5); Enregistrer before any change asks here. -->
		<div class="banner" class:ask={draftAsk} role="status" data-testid="draft-banner" bind:this={draftBanner}>
			<p>{f.draftFound(when(foundDraft.at))}</p>
			<div class="acts">
				<button type="button" class="btn primary" onclick={resumeDraft}>{f.draftResume}</button>
				<button type="button" class="btn" onclick={discardDraft}>{discardLabel}</button>
			</div>
			{#if draftAsk}<p class="ask-line" data-testid="draft-ask">{f.draftChooseFirst(discardLabel)}</p>{/if}
		</div>
	{:else if setAside}
		<p class="aside" role="status" data-testid="draft-aside">
			{f.draftSetAside(when(setAside.at))}
			<button type="button" class="btn quiet" title={f.draftResumeOver} onclick={resumeDraft} data-testid="draft-aside-resume">{f.draftResume}</button>
		</p>
	{/if}

	<!-- The parts of the form and a quick Save: a rail at the left on a wide screen, a strip at the top on a phone. Each dot says filled, empty or to fix. -->
	<div class="rail" class:typing>
	<nav class="sections" aria-label={f.sectionsNav} data-testid="form-nav">
		<div class="chips" class:more-left={moreLeft} class:more-right={moreRight} bind:this={strip} onscroll={edges}>
		<ul>
			{#each navKeys as k (k)}
				<li>
					<a
						href="#{SECTION_EL[k]}"
						aria-current={current === k ? 'location' : undefined}
						onclick={(e) => {
							e.preventDefault();
							goTo(k);
						}}
						data-testid="nav-{k}"
						><span class="dot {states[k]}" aria-hidden="true"></span>{f.sectionNames[k]}<span class="visually-hidden">{` (${f.sectionStates[states[k]]})`}</span></a
					>
				</li>
			{/each}
		</ul>
		</div>
		<!-- A phone: the parts as one picker showing the part in sight — never a chip cut at the edge. -->
		<label class="visually-hidden" for="nav-jump">{f.sectionsJump}</label>
		<select
			id="nav-jump"
			class="jump-select"
			value={current}
			onchange={(e) => goTo(e.currentTarget.value as FormSectionKey)}
			data-testid="nav-select"
		>
			{#each navKeys as k (k)}<option value={k}>{NAV_GLYPH[states[k]]} {f.sectionNames[k]}{states[k] === 'fix' ? ` — ${f.sectionStates.fix}` : ''}</option>{/each}
		</select>
	</nav>
	<!-- Save within reach without covering anything (a phone: the bar at the bottom); not ready, it takes her to what is missing. -->
	<div class="quick-wrap">
		<button
			type="button"
			class="btn primary quick"
			class:waiting={!!reasons.length}
			aria-disabled={reasons.length || saving ? 'true' : undefined}
			aria-describedby={reasons.length ? 'save-why' : undefined}
			aria-busy={saving}
			onclick={save}
			data-testid="save-quick"
			><span class="quick-label">{saving ? f.saving : f.save}</span>{#if !countText && !saving}<kbd class="quick-keys">{f.saveKeys}</kbd>{/if}</button
		>
		{#if firstReason}
			<!-- « 2 à compléter », a button: the first field missing, in sight and focused, its reason beside it (round 3). -->
			{@const go = firstReason}
			<button type="button" class="count-go" title={f.saveCountGo(go.text)} onclick={() => jump(go.block)} data-testid="save-go"
				><span class="count-n" data-testid="save-count">{countText}</span><span class="count-what">{go.text}</span></button
			>
		{/if}
		{#if keptAt !== null && !firstReason}<span class="kept" title={f.draftKeptTitle} data-testid="draft-kept-rail">{f.draftKept(clock(keptAt))}</span>{/if}
	</div>
	{#if scanSrc}
		<button type="button" class="btn quiet scan-toggle" aria-pressed={scanShown} aria-controls="form-scan" onclick={toggleScan} data-testid="scan-toggle"
			>{scanShown ? f.scanHide : f.scanShow}</button
		>
		{#if scanShown}
			<div id="form-scan" class="scan" class:zoom={scanZoom} data-testid="form-scan">
				<button type="button" class="scan-img" aria-pressed={scanZoom} aria-label={scanZoom ? f.scanUnzoom : f.scanZoom} onclick={() => (scanZoom = !scanZoom)}
					><img src={scanSrc} alt={f.scanAlt} /></button
				>
			</div>
		{/if}
	{/if}
	</div>

	<div class="body" data-testid="form-body">
	{#if stale}
		<StaleCompare mine={form} theirs={stale.theirs.form} onkeep={keepMine} ontake={takeTheirs} />
	{/if}

	{#if message}<p class="msg" role="alert" data-testid="form-message">{message}</p>{/if}

	<!-- Title and provenance: the top of the card -->
	<section class="card" id="sec-title" tabindex="-1" aria-labelledby="s-title">
		<h2 id="s-title" class="visually-hidden">{f.title}</h2>
		<div class="field">
			<label for="title">{f.title} <span class="req">({f.required})</span></label>
			<input
				id="title"
				class="title-input"
				type="text"
				bind:value={form.title}
				placeholder={f.titlePlaceholder}
				data-testid="title"
				aria-invalid={(!!recipeBlock('title') && (tried || recipeBlock('title')?.reason !== 'required')) || undefined}
				aria-describedby={recipeBlock('title') && (tried || recipeBlock('title')?.reason !== 'required') ? 'err-title' : undefined}
			/>
			{#if recipeBlock('title') && (tried || recipeBlock('title')?.reason !== 'required')}<p class="err" id="err-title" data-testid="err-title">{recipeErr('title')}</p>{/if}
			<Marks owner={form} key="title" lang={form.lang} text={form.title} onpick={(a) => (form.title = a)} />
		</div>
		<!-- One line, its room always kept (≈ 30 px): the form does not move when a hint shows. -->
		<div class="title-note" role="status">
			{#if titleNote}
				{@const note = titleNote}
				<p data-testid={note.testid}>
					<span class="note-text" title={note.text}
						>{#if note.short}<span class="wide">{note.text}</span><span class="narrow">{note.short}</span>{:else}{note.text}{/if}</span
					>
					<a href="/r/{note.slug}" target="_blank" rel="noopener">{f.near}</a>
					{#if note.pairWith}
						{@const other = note.pairWith}
						<button type="button" class="note-act" title={f.sameTitle} onclick={() => makePair(other)}>{f.samePair}</button>
					{/if}
				</p>
			{/if}
		</div>
		{#if joinedShown}
			<!-- « En faire une variante » joined a group: what tells this one apart, typed right here (Classement shows the same field). -->
			{@const vb = recipeBlock('variant')}
			<div class="pair" data-testid="variant-inline">
				<div class="field">
					<label for="variant-inline">{f.variant} <span class="req">({f.required})</span></label>
					<input
						id="variant-inline"
						type="text"
						bind:value={form.variant}
						placeholder={f.variantPlaceholder}
						aria-invalid={(!!vb && tried) || undefined}
						aria-describedby={vb && tried ? 'variant-inline-err' : undefined}
					/>
					{#if vb && tried}<p class="err" id="variant-inline-err">{blockText(vb)}</p>{/if}
				</div>
				<div class="pair-acts">
					<button
						type="button"
						class="btn quiet"
						onclick={() => {
							form.family = '';
							form.variant = '';
							joined = null;
						}}>{f.familyRemove}</button
					>
				</div>
			</div>
		{/if}
		{#if pair}
			<div class="pair" data-testid="pair">
				<p>{f.pairNote(pair.title)}</p>
				<div class="field">
					<label for="pair-variant">{f.pairVariant(pair.title)} <span class="req">({f.required})</span></label>
					<input
						id="pair-variant"
						type="text"
						bind:value={pair.variant}
						placeholder={f.variantPlaceholder}
						aria-invalid={(tried && !pair.variant.trim()) || undefined}
						aria-describedby={tried && !pair.variant.trim() ? 'pair-variant-err' : undefined}
					/>
					{#if tried && !pair.variant.trim()}<p class="err" id="pair-variant-err">{f.field.variant}</p>{/if}
				</div>
				<button
					type="button"
					class="btn quiet"
					onclick={() => {
						pair = null;
						form.family = '';
						form.variant = '';
						newFamilyLabel = '';
					}}>{f.pairCancel}</button
				>
			</div>
		{/if}

		<div class="minor-row" id="sec-source" tabindex="-1">
			<h3 id="s-source" class="minor">{f.source}</h3>
			{#if !noteAsked}
				<button
					type="button"
					class="btn quiet small"
					data-testid="add-source-note"
					onclick={async () => {
						noteAsked = true;
						await tick();
						document.getElementById('src-note')?.focus();
					}}>+ {f.addSourceNote}</button
				>
			{/if}
		</div>
		<!-- D'où first: the other fields are named for the kind of source (« Titre du livre », « Site »); the same fields underneath. -->
		<div class="grid" role="group" aria-labelledby="s-source">
			<div class="field">
				<label for="src-type">{f.sourceType}</label>
				<select id="src-type" bind:value={form.source.type} data-testid="src-type">
					<option value="">{f.sourceNone}</option>
					{#each SOURCE_TYPES as s (s)}<option value={s}>{t.source[s]}</option>{/each}
				</select>
			</div>
			<div class="field">
				<Suggest
					id="src-author"
					label={f.srcAuthor[srcType] ?? f.author}
					bind:value={form.source.author}
					load={authors}
					onpick={(o) => (form.source.author = o.value)}
					placeholder={personal ? f.authorPlaceholder : undefined}
				/>
				{#if recipeBlock('source.author')}<p class="err">{recipeErr('source.author')}</p>{/if}
				<Marks owner={form} key="source.author" lang={form.lang} text={form.source.author} onpick={(v) => (form.source.author = v)} />
			</div>
			{#if titled || form.source.title}
				<div class="field book">
					<label for="src-title">{f.srcTitle[srcType] ?? f.sourceTitle}</label>
					<input id="src-title" type="text" bind:value={form.source.title} aria-invalid={!!recipeBlock('source.title') || undefined} />
					{#if recipeBlock('source.title')}<p class="err">{recipeErr('source.title')}</p>{/if}
				</div>
			{/if}
			{#if srcType === 'book' || srcType === 'magazine' || form.source.page}
				<div class="field narrow">
					<label for="src-page">{f.srcPage[srcType] ?? f.page}</label>
					<input id="src-page" type="text" inputmode={srcType === 'magazine' ? 'text' : 'numeric'} bind:value={form.source.page} aria-invalid={!!recipeBlock('source.page') || undefined} />
					{#if recipeBlock('source.page')}<p class="err">{recipeErr('source.page')}</p>{/if}
				</div>
			{/if}
			{#if srcType === 'website' || srcType === 'tv' || form.source.url}
				<div class="field wide">
					<label for="src-url">{f.srcUrl[srcType] ?? f.url}</label>
					<input id="src-url" type="url" inputmode="url" autocapitalize="none" bind:value={form.source.url} placeholder="https://" aria-invalid={!!recipeBlock('source.url') || undefined} />
					{#if recipeBlock('source.url')}<p class="err">{recipeErr('source.url')}</p>{/if}
				</div>
			{/if}
			{#if noteAsked}
				<!-- Free words (« écriture de Mémère, encre bleue »): the whole line, read whole. -->
				<div class="field wide">
					<label for="src-note">{f.sourceNote}</label>
					<input id="src-note" type="text" bind:value={form.source.note} aria-invalid={!!recipeBlock('source.note') || undefined} />
					{#if recipeBlock('source.note')}<p class="err">{recipeErr('source.note')}</p>{/if}
				</div>
			{/if}
		</div>

		<!-- Servings, yield, oven, times: the line under the title on a card, one compact row (wrapping on a phone). -->
		<div class="basics" role="group" aria-labelledby="s-basics">
			<h3 id="s-basics" class="visually-hidden">{f.basics}</h3>
			<!-- « Donne » : one field — a number is portions (servings, servings_max), words are the yield; the file's keys as the schema has them. -->
			<div class="field gives" role="group" aria-labelledby="gives-label">
				<label id="gives-label" for="gives">{f.yield}</label>
				<div class="line">
					<div class="gives-box">
						<Suggest
							id="gives"
							bind:value={givesText}
							load={gives}
							oninput={setGives}
							onpick={(o) => setGives(o.value)}
							placeholder={f.givesPlaceholder}
							invalid={!!(recipeBlock('servings') || recipeBlock('servingsMax') || (!alsoYield && recipeBlock('yield.text')))}
							describedby="gives-as"
							testid="yield"
						/>
					</div>
					{#if hasServings(form) || form.servingsNote.trim()}
						<label class="visually-hidden" for="servings-note">{f.servingsNote}</label>
						<input id="servings-note" class="note" type="text" bind:value={form.servingsNote} placeholder={f.servingsNotePlaceholder} aria-invalid={!!recipeBlock('servingsNote') || undefined} />
					{/if}
				</div>
				<small class="help gives-as" id="gives-as">{givesAs}</small>
				{#if alsoYield}
					<div class="line also">
						<label class="also-label" for="yield-also">{f.yieldAlso}</label>
						<input
							id="yield-also"
							class="text"
							type="text"
							value={form.yield.text}
							oninput={(e) => {
								form.yield.text = e.currentTarget.value;
								form.yield.kind = e.currentTarget.value.trim() ? 'text' : 'none';
							}}
						/>
					</div>
				{:else if form.yield.kind === 'amount'}
					<div class="line also">
						<span class="also-label">{f.yieldAlso}</span>
						{@render amountYield()}
					</div>
				{/if}
				{#if recipeBlock('servings') || recipeBlock('servingsMax')}<p class="err" data-testid="err-servings">{recipeErr('servings', 'servingsMax')}</p>{/if}
				{#if recipeBlock('servingsNote')}<p class="err">{recipeErr('servingsNote')}</p>{/if}
				{#if recipeErr('yield.qty', 'yield.unit', 'yield.qtyMax', 'yield.text', 'yield.note', 'yield')}<p class="err" data-testid="err-yield">{recipeErr('yield.qty', 'yield.unit', 'yield.qtyMax', 'yield.text', 'yield.note', 'yield')}</p>{/if}
			</div>
			<fieldset class="field oven">
				<legend>{f.ovenLegend}</legend>
				<div class="line">
					<label class="visually-hidden" for="oven-temp">{f.ovenTemp}</label>
					<input id="oven-temp" class="short" type="text" inputmode="numeric" bind:value={form.oven.temp} placeholder={f.ovenTempPlaceholder} aria-invalid={!!recipeBlock('oven.temp') || undefined} data-testid="oven-temp" />
					{#if ovenRange || form.oven.tempMax}
						<span class="to">{f.range}</span>
						<label class="visually-hidden" for="oven-max">{f.ovenTemp} {f.range}</label>
						<input id="oven-max" class="short" type="text" inputmode="numeric" bind:value={form.oven.tempMax} aria-invalid={!!recipeBlock('oven.tempMax') || undefined} />
					{/if}
					<div class="seg" role="radiogroup" aria-label={f.ovenUnit}>
						{#each ['F', 'C'] as const as u (u)}
							<button type="button" role="radio" aria-checked={form.oven.unit === u} aria-label="°{u} ({f.ovenUnitNames[u]})" title={f.ovenUnitNames[u]} class:on={form.oven.unit === u} onclick={() => (form.oven.unit = u)}>°{u}</button>
						{/each}
					</div>
					{#if !ovenRange && !form.oven.tempMax && form.oven.temp}
						<button
							type="button"
							class="btn quiet small range-add"
							onclick={async () => {
								ovenRange = true;
								await tick();
								document.getElementById('oven-max')?.focus();
							}}
							data-testid="oven-range">+ {f.rangeAdd(form.oven.unit)}</button
						>
					{/if}
				</div>
				{#if recipeBlock('oven.temp') || recipeBlock('oven.tempMax') || recipeBlock('oven.unit')}<p class="err" data-testid="err-oven">{recipeErr('oven.unit', 'oven.temp', 'oven.tempMax')}</p>{/if}
			</fieldset>

		<fieldset class="times" class:all={timesAsked} aria-describedby="times-help">
			<legend class="visually-hidden">{f.times}</legend>
			{#each TIMES as [k, name] (k)}
				{@const b = recipeBlock(`times.${k}`)}
				<div class="time" class:extra={k === 'rest' || k === 'total'}>
					<DurationField
						d={form.times[k]}
						id="time-{k}"
						label={name}
						placeholder={k === 'prep' ? f.prepTimePlaceholder : k === 'cook' ? f.cookTimePlaceholder : undefined}
						error={b ? (b.reason === 'range' ? f.field.range : f.timeFormat) : undefined}
					/>
				</div>
			{/each}
			{#if !timesAsked}
				<div class="time more">
					<button
						type="button"
						class="btn quiet"
						data-testid="add-times"
						onclick={async () => {
							timesAsked = true;
							await tick();
							document.getElementById('time-rest')?.focus();
						}}>+ {f.addMoreTimes}</button
					>
				</div>
			{/if}
		</fieldset>
			<p class="help times-help" id="times-help">{f.timeHelp}</p>
		</div>
	</section>

	<!-- Ingredients -->
	<section class="card" id="sec-ingr" tabindex="-1" aria-labelledby="s-ingr">
		<div class="card-head">
			<h2 id="s-ingr">{f.ingredients}</h2>
			<!-- A list typed elsewhere (a text, a note on the phone): in at once, from the top of the card. -->
			{#if itemsBlank || listFor === 'items-head'}
				<button
					type="button"
					class="btn head-paste"
					aria-expanded={listFor === 'items-head'}
					aria-controls="paste-items-head"
					onclick={() => (listFor = listFor === 'items-head' ? null : 'items-head')}
					data-testid="paste-items">{f.pasteList}</button
				>
			{/if}
		</div>
		{#if listFor === 'items-head'}
			<div id="paste-items-head" class="head-box">
				<ListPaste id="paste-items-head-box" kind="items" lang={form.lang} onitems={(l) => pasteItems(0, l)} oncancel={() => (listFor = null)} />
			</div>
		{/if}
		{#if tried && recipeBlock('ingredients')}<p class="err" data-testid="err-ingredients">{recipeErr('ingredients')}</p>{/if}
		{#each form.groups as g, gi (g.id)}
			<div class="group" class:named={groupsShown} data-testid="group">
				{#if groupsShown}
					<!-- Its name, labelled in sight (a placeholder alone went when she typed, round 3). -->
					<label class="group-label" for="g-{g.id}">{f.groupName}{#if form.groups.length > 1}{' '}{gi + 1}{/if}</label>
					<div class="group-head">
						<input
							id="g-{g.id}"
							class="group-name"
							type="text"
							bind:value={g.name}
							placeholder={gi === 0 && form.groups.length > 1 ? f.groupPlaceholderFirst : f.groupPlaceholder}
							onkeydown={(e) => {
								if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey) return;
								e.preventDefault();
								groupNameEnter(gi);
							}}
							data-testid="group-name"
							aria-invalid={!!blockOn(blocks, g.id, 'name') || undefined}
							aria-describedby={blockOn(blocks, g.id, 'name') ? `g-${g.id}-err` : undefined}
						/>
						{#if g.optional}<span class="tag">{f.sum.optional}</span>{/if}
						<Menu label={f.groupActions(gi + 1)} testid="group-menu">
							<button type="button" disabled={gi === 0} onclick={() => move(form.groups, gi, -1)}>{f.moveUp}</button>
							<button type="button" disabled={gi === form.groups.length - 1} onclick={() => move(form.groups, gi, 1)}>{f.moveDown}</button>
							<button type="button" aria-pressed={g.optional} onclick={() => (g.optional = !g.optional)}>{f.groupOptional}<span aria-hidden="true">{g.optional ? '✓' : ''}</span></button>
							<hr />
							<button type="button" class="danger" onclick={() => removeGroup(gi)}>{f.removeGroup}</button>
						</Menu>
					</div>
					{#if blockOn(blocks, g.id, 'name')}<p class="err" id="g-{g.id}-err">{rowErr(g.id, 'name')}</p>{/if}
					<Marks owner={g} key="name" lang={form.lang} text={g.name} onpick={(v) => (g.name = v)} />
					{#if blockOn(blocks, g.id, 'items')}<p class="err">{f.field.items}</p>{/if}
				{/if}
				{#if gi === 0}
					<!-- What each box holds, once, on a wide screen (each box has its own label too). -->
					<div class="cols" aria-hidden="true"><span>{f.cols.qty}</span><span>{f.cols.unit}</span><span>{f.cols.name}</span></div>
				{/if}
				{#each g.items as it, i (it.id)}
					<ItemRow
						item={it}
						lang={form.lang}
						{units}
						words={data.words}
						own={slug ?? ''}
						{blocks}
						{hints}
						label="{f.name} {i + 1}{groupsShown ? ` (${g.name || f.group + ' ' + (gi + 1)})` : ''}"
						first={i === 0}
						last={i === g.items.length - 1}
						onmove={(by) => move(g.items, i, by)}
						onremove={() => removeItem(gi, i)}
						onenter={() => enterRow(gi, i)}
						compactable={activeItem !== it.id}
						onactivate={() => (activeItem = it.id)}
						example={i}
						reveal={tried}
						bind:qtyInput={qtyInputs[it.id]}
					/>
				{/each}
				<div class="acts add-row">
					<button type="button" class="btn add" onclick={() => addRow(gi)} data-testid="add-item">+ {f.addItem}</button>
					{#if !(gi === 0 && (itemsBlank || listFor === 'items-head'))}
						<button
							type="button"
							class="btn quiet"
							aria-expanded={listFor === g.id}
							aria-controls="paste-{g.id}"
							onclick={() => (listFor = listFor === g.id ? null : g.id)}
							data-testid="paste-items">{f.pasteList}</button
						>
					{/if}
					{#if gi === form.groups.length - 1}
						<button
							type="button"
							class="btn quiet"
							onclick={() => addGroupHere()}
										data-testid="add-group">+ {f.addGroup}</button
									>
								{/if}
							</div>
							{#if listFor === g.id}
								<div id="paste-{g.id}">
									<ListPaste id="paste-{g.id}-box" kind="items" lang={form.lang} onitems={(l) => pasteItems(gi, l)} oncancel={() => (listFor = null)} />
								</div>
							{/if}
							</div>
							{/each}
	</section>

	<!-- Method -->
	{#if method}
		<section class="card" id="sec-method" tabindex="-1" aria-labelledby="s-method">
			<div class="card-head">
				<h2 id="s-method">{f.method}</h2>
				{#if stepsBlank || listFor === 'steps-head'}
					<button
						type="button"
						class="btn head-paste"
						aria-expanded={listFor === 'steps-head'}
						aria-controls="paste-steps-head"
						onclick={() => (listFor = listFor === 'steps-head' ? null : 'steps-head')}
						data-testid="paste-steps">{f.pasteList}</button
					>
				{/if}
			</div>
			<p class="help">{f.stepHelp}</p>
			<!-- The keys, one line, for a keyboard (a phone has none to learn). -->
			<p class="help keys" id="keys-help" data-testid="keys-help">{f.keysHelp}</p>
			{#if freeShown}
				<!-- The body's text under no heading (steps written without « ## Préparation »): shown, editable, kept as written. -->
				<div class="free" data-testid="free-text">
					<label for="free-text">{f.freeText}</label>
					<p class="help" id="free-text-help">{f.freeTextHelp}</p>
					<textarea id="free-text" rows="3" bind:value={form.preamble} use:grow aria-describedby="free-text-help" aria-invalid={!!recipeBlock('preamble') || undefined} data-testid="free-text-box"></textarea>
					{#if recipeBlock('preamble')}<p class="err">{recipeErr('preamble')}</p>{/if}
					{#if freeSteps}
						<button type="button" class="btn" onclick={freeToSteps} data-testid="free-to-steps">{f.freeToSteps(freeSteps)}</button>
					{/if}
				</div>
			{/if}
			{#if listFor === 'steps-head'}
				<div id="paste-steps-head" class="head-box">
					<ListPaste id="paste-steps-head-box" kind="steps" lang={form.lang} onsteps={pasteSteps} oncancel={() => (listFor = null)} />
				</div>
			{/if}
			<ol class="steps">
				{#each method.rows as r, i (r.id)}
					<li class="step" class:heading={r.type === 'heading'} class:worded={r.type !== 'step'} data-testid="step-row">
						<label for="r-{r.id}" class="num">{r.type === 'heading' ? f.heading : r.type === 'text' ? f.text : stepNumber(i)}</label>
						<div class="step-body">
							{#if r.type === 'heading'}
								<input id="r-{r.id}" type="text" bind:value={r.text} placeholder={f.headingPlaceholder} onkeydown={(e) => stepKey(e, i)} data-testid="heading" />
							{:else}
								<textarea
									id="r-{r.id}"
									rows="2"
									bind:value={r.text}
									use:grow
									aria-label={r.type === 'step' ? f.step(stepNumber(i)) : f.text}
									aria-describedby="keys-help"
									onkeydown={(e) => stepKey(e, i)}
									onfocus={() => (stepWas[r.id] ??= r.text)}
									onblur={() => stepLeft(r)}
									data-testid="step"
								></textarea>
							{/if}
							{#if nudge?.row === r.id}
								{@const n = nudge}
								{@const field = n.key === 'cook' ? f.cookTime : f.prepTime}
								<!-- The step's time changed and the box held the old one: offered, never done on its own. -->
								<p class="nudge" role="status" data-testid="time-nudge">
									<span>{f.timeNudge(field, n.from, durationInputText({ ...n.to }, f.timeWords))}</span>
									<button type="button" class="btn" onclick={takeNudge} data-testid="time-nudge-yes">{f.timeNudgeYes}</button>
									<button type="button" class="btn quiet x" aria-label={f.timeNudgeNo(field)} title={f.timeNudgeNo(field)} onclick={() => (nudge = null)}>✕</button>
								</p>
							{/if}
							{#if blockOn(blocks, r.id, 'text')}<p class="err" data-testid="err-step">{rowErr(r.id, 'text')}</p>{/if}
							<Marks owner={r} key="text" lang={form.lang} text={r.text} onpick={(v) => (r.text = v)} />
						</div>
						<div class="tools">
							<Menu label={f.stepActions(r.type === 'heading' ? `${f.heading} ${i + 1}` : r.type === 'text' ? `${f.text} ${i + 1}` : f.step(stepNumber(i)))} testid="step-menu">
								<button type="button" disabled={i === 0} onclick={() => move(method!.rows, i, -1)}>{f.moveUp}</button>
								<button type="button" disabled={i === method.rows.length - 1} onclick={() => move(method!.rows, i, 1)}>{f.moveDown}</button>
								<hr />
								<button type="button" class="danger" onclick={() => removeStep(i)}>{f.remove}</button>
							</Menu>
						</div>
					</li>
				{/each}
			</ol>
			{#if blockOn(blocks, method.id, 'steps')}<p class="err" data-testid="err-steps">{rowErr(method.id, 'steps')}</p>{/if}
			<div class="acts">
				<button
					type="button"
					class="btn add"
					onclick={async () => {
						const r = addStepRow(method!.rows);
						await tick();
						document.getElementById(`r-${r.id}`)?.focus();
					}}
					data-testid="add-step">+ {f.addStep}</button
				>
				<button
					type="button"
					class="btn quiet"
					onclick={async () => {
						const r = addStepRow(method!.rows, 'heading');
						await tick();
						document.getElementById(`r-${r.id}`)?.focus();
							}}>+ {f.addHeading}</button
						>
						{#if !(stepsBlank || listFor === 'steps-head')}
							<button
								type="button"
								class="btn quiet"
								aria-expanded={listFor === 'steps'}
								aria-controls="paste-steps"
								onclick={() => (listFor = listFor === 'steps' ? null : 'steps')}
								data-testid="paste-steps">{f.pasteList}</button
							>
						{/if}
					</div>
					{#if listFor === 'steps'}
						<div id="paste-steps">
							<ListPaste id="paste-steps-box" kind="steps" lang={form.lang} onsteps={pasteSteps} oncancel={() => (listFor = null)} />
						</div>
					{/if}
					<!-- Sections the file format does not know (« ## Conseils de Mémère »): their text, editable, written back under their own heading. -->
					{#each others as o (o.id)}
						<div class="free" data-testid="free-section">
							<label for="o-{o.id}">{f.freeTextOther(o.heading)}</label>
							<p class="help" id="o-{o.id}-help">{f.freeTextOtherHelp}</p>
							<textarea id="o-{o.id}" rows="3" bind:value={o.text} use:grow aria-describedby="o-{o.id}-help"></textarea>
						</div>
					{/each}
					</section>
					{/if}

	<!-- The rest, on one card: notes, the photo, the filing. Each folds to one line once it holds something (an edit is long). -->
	<div class="card extras">
	<!-- Notes, variants, alternatives -->
	<section class="part" id="sec-notes" tabindex="-1" aria-labelledby="s-notes" class:folded={!notesOpen}>
		<h2 id="s-notes" class="fold-head">
			<button type="button" aria-expanded={notesOpen} aria-controls="notes-body" onclick={async () => {
					notesOpen = !notesOpen;
					// « Ajouter »: straight into the box.
					if (notesOpen && !notesSummary) {
						await tick();
						document.getElementById('t-notes')?.focus();
					}
				}} data-testid="notes-toggle">
				<span class="fold-title">{f.notes}</span>
				{#if !notesOpen}<span class="fold-sum clip" data-testid="notes-summary">{notesSummary || f.notesNone}</span>{/if}
				<span class="fold-act">{notesOpen ? f.classClose : notesSummary ? f.edit : f.notesAdd}</span>
			</button>
		</h2>
		<!-- In the page only once open: the boxes size to their text when they appear (a hidden box measures nothing). -->
		{#if notesOpen}
		<div id="notes-body" class="fold-body">
		{#each TEXT_KINDS as k (k)}
			{@const s = textSection(k)}
			{#if textAsked.includes(k)}
				<div class="field">
					<label for="t-{k}" class:visually-hidden={k === 'notes'}>{f[k]}</label>
					{#if k === 'notes'}<small class="help">{f.notesHelp}</small>{/if}
					<textarea id="t-{k}" rows={k === 'notes' ? 3 : 2} bind:value={s.text} use:grow data-testid="text-{k}"></textarea>
					{#if blockOn(blocks, s.id, 'text')}<p class="err">{rowErr(s.id, 'text')}</p>{/if}
					<Marks owner={s} key="text" lang={form.lang} text={s.text} onpick={(v) => (s.text = v)} />
				</div>
			{/if}
		{/each}
		{#if TEXT_KINDS.some((k) => !textAsked.includes(k))}
			<div class="acts">
				{#each TEXT_KINDS.filter((k) => !textAsked.includes(k)) as k (k)}
					<button
						type="button"
						class="btn quiet"
						data-testid="add-text-{k}"
						onclick={async () => {
							textAsked = [...textAsked, k];
							await tick();
							document.getElementById(`t-${k}`)?.focus();
						}}>+ {f[k]}</button
					>
				{/each}
			</div>
		{/if}
		</div>
		{/if}
	</section>

	<!-- Photo: the recipe's one photo (media.final) — the dish, or in this archive often the card itself. One line. -->
	<section class="part photo-part" aria-labelledby="s-photo">
		<h2 id="s-photo" class="fold-title">{f.photo}</h2>
		<div class="photo">
			{#if photoPreview}
				<img src={photoPreview} alt="" />
			{:else if data.photo?.thumb}
				<img src={data.photo.thumb} alt="" class:going={photoRemove} />
			{/if}
			<div class="photo-acts">
				{#if photoFile}
					<p>{f.photoPending(photoFile.name)}</p>
					<p class="help">{f.photoNotInDraft}</p>
					<button type="button" class="btn quiet" onclick={dropPhoto}>{f.photoCancel}</button>
				{:else if photoRemove}
					<!-- Nothing is removed until Enregistrer: « Garder la photo » undoes it. -->
					<p role="status" data-testid="photo-removed">{f.photoRemoved}</p>
					<button type="button" class="btn" onclick={() => (photoRemove = false)} data-testid="photo-keep">{f.photoKeep}</button>
				{:else}
					<label class="btn file">
						<input type="file" accept="image/*" onchange={pickPhoto} data-testid="photo-input" />
						{data.photo ? t.photo.replace : t.photo.add}
					</label>
					{#if data.photo}
						<button type="button" class="btn quiet" onclick={() => (photoRemove = true)} data-testid="photo-remove">{t.photo.remove}</button>
					{:else}
						<small class="help">{f.photoHelp}</small>
					{/if}
				{/if}
			</div>
		</div>
	</section>

	<!-- Filing: family, tags, seasons, difficulty, rating, language -->
	<section class="part classify" id="sec-class" tabindex="-1" class:folded={!classOpen} aria-labelledby="s-class">
		<h2 id="s-class" class="fold-head">
			<button type="button" aria-expanded={classOpen} aria-controls="class-body" onclick={() => (classOpen = !classOpen)} data-testid="class-toggle">
				<span class="fold-title">{f.classify}</span>
				{#if !classOpen}<span class="fold-sum" data-testid="class-summary">{classSummary}</span>{/if}
				<span class="fold-act">{classOpen ? f.classClose : classFilled(form) ? f.edit : f.classOpen}</span>
			</button>
		</h2>
		<!-- The tags, in place whether Classement is folded or not: a chip off, a tag on, without opening anything. -->
		<div class="field tags-inline">
			<h3 id="tags-head" class="tags-head">{f.tags}</h3>
			{#if classOpen}<small class="help">{f.tagsHelp}</small>{/if}
			<TagPicker bind:tags={form.tags} vocab={data.tagVocab} labels={data.tagLabels} />
		</div>
		<div id="class-body" class="fold-body" hidden={!classOpen}>
		<FamilyPicker {form} families={data.families} {blocks} {hints} bind:newLabel={newFamilyLabel} />
		<fieldset class="field toggles">
			<legend>{f.seasons}</legend>
			{#each SEASONS as s (s)}
				<label class="toggle">
					<input
						type="checkbox"
						checked={form.season.includes(s)}
						onchange={(e) => {
							if (e.currentTarget.checked) form.season = [...SEASONS].filter((x) => x === s || form.season.includes(x));
							else form.season = form.season.filter((x) => x !== s);
						}}
					/>
					<span>{t.season[s]}</span>
				</label>
			{/each}
		</fieldset>
		<div class="taps-row">
			{#each TAPS as [k, name, levels] (k)}
				<fieldset class="field taps" data-testid="taps-{k}">
					<legend>{name} <span class="level" class:none={form[k] === null}>— {form[k] === null ? (k === 'rating' ? f.ratingNone : f.difficultyNone) : levels[(form[k] ?? 1) - 1]}</span></legend>
					<div class="scale" class:stars={k === 'rating'}>
						{#each [1, 2, 3, 4, 5] as n (n)}
							<button
								type="button"
								class="tap"
								class:on={(form[k] ?? 0) >= n}
								aria-pressed={form[k] === n}
								aria-label={levels[n - 1]}
								title={levels[n - 1]}
								onclick={() => (form[k] = form[k] === n ? null : n)}>{k === 'rating' ? '★' : n}</button
							>
						{/each}
					</div>
					{#if k === 'difficulty'}
						<div class="ends" aria-hidden="true"><span>{levels[0]}</span><span>{levels[4]}</span></div>
					{/if}
				</fieldset>
			{/each}
		</div>
		<div class="field narrow">
			<label for="lang">{f.lang}</label>
			<select id="lang" bind:value={form.lang}>
				{#each Object.entries(f.langs) as [v, l] (v)}<option value={v}>{l}</option>{/each}
			</select>
		</div>
		</div>
	</section>
	</div>

	<!-- Save, at the end of the form: what is missing as a sentence (each part takes her to its field); Enregistrer, not ready yet, takes her to the first. -->
	<div class="savebar" class:typing data-testid="savebar">
		<div class="why" aria-live="polite">
			{#if firstReason}
				<!-- A phone: the bar sits at the bottom of the screen, one line — the first thing missing, a button to its field, and how many more. -->
				{@const go = firstReason}
				<button type="button" class="jump first" onclick={() => jump(go.block)} data-testid="save-first"
					><span class="lead">{go.missing ? f.missingLead : f.fixLead}</span>{' '}{go.text}{#if said.missing.length + said.fix.length > 1}{' '}<span class="more">{f.moreReasons(said.missing.length + said.fix.length - 1)}</span>{/if}</button
				>
			{/if}
			{#if reasons.length}
				<!-- Whitespace and joins as expressions: Svelte trims the edges of a block's text, so « , » and « et » come from listParts whole. -->
				<p class="sentence" data-testid="save-sentence">
					{#if said.missing.length}<span class="lead">{f.missingLead}</span>{' '}{#each missingParts as p, k (k)}{#if p.r}{@const r = p.r}<button
									type="button"
									class="jump"
									title={f.jumpTo(r.text)}
									onclick={() => jump(r.block)}>{p.text}</button
								>{:else}{p.text}{/if}{/each}{'.'}{/if}{#if said.fix.length}{#if said.missing.length}{' '}{/if}<span class="lead">{f.fixLead}</span>{' '}{#each fixParts as p, k (k)}{#if p.r}{@const r = p.r}<button
									type="button"
									class="jump"
									title={f.jumpTo(r.text)}
									onclick={() => jump(r.block)}>{p.text}</button
								>{:else}{p.text}{/if}{/each}{'.'}{/if}
				</p>
			{:else if uncertain}
				<span class="soft">{f.uncertainLeft(uncertain)}</span>
			{/if}
			{#if keptAt !== null && !reasons.length && !uncertain}<span class="kept" title={f.draftKeptTitle} data-testid="draft-kept">{f.draftKept(clock(keptAt))}</span>{/if}
		</div>
		<button
			type="submit"
			class="btn primary"
			class:waiting={!!reasons.length}
			aria-disabled={reasons.length || saving ? 'true' : undefined}
			aria-describedby={reasons.length ? 'save-why' : undefined}
			aria-busy={saving}
			data-testid="save">{saving ? f.saving : f.save}{#if !reasons.length && !saving}<kbd>{f.saveKeys}</kbd>{/if}</button
		>
		{#if reasons.length}<span id="save-why" class="visually-hidden">{sentence}</span>{/if}
	</div>
	</div>
</form>

<style>
	.recipe-form {
		max-width: 50rem;
		margin: 0 auto;
		padding-bottom: 1.5rem;
	}
	/* A field scrolled to (focus, a jump) lands clear of the phone strip; nothing floats at the bottom. */
	:global(html:has(form.recipe-form)) {
		scroll-padding-top: 1rem;
		scroll-padding-bottom: 1rem;
	}
	/* A part jumped to takes the focus (so the keyboard follows), with no ring: it is not a control. */
	.card[tabindex='-1']:focus,
	.part[tabindex='-1']:focus,
	.minor-row[tabindex='-1']:focus {
		outline: none;
	}
	/* Placeholders are hints, never values: « qté », « ex. 350 » (UI round 1),
	   regular weight and grey, upright (italic read as a scan's handwriting),
	   the sans of the fields — not the title's bold serif. */
	.recipe-form :global(input::placeholder),
	.recipe-form :global(textarea::placeholder) {
		font-family: var(--sans);
		font-weight: 400;
		font-style: normal;
		color: var(--pencil);
		opacity: 1;
	}

	/*
	 * The parts of the form and a quick Save. A phone, a tablet: a strip of
	 * chips under the page head with Enregistrer at its right, kept at the top
	 * while she scrolls (it steps back while she types on a phone). A wide
	 * screen: a rail at the left, beside the cards, Enregistrer under the links.
	 * Nothing sits over the cards.
	 */
	.rail {
		position: relative;
	}
	/* Positioned: the links' hidden state text (absolute) stays inside the strip's scroll box, never widening the page; a chip's offsetLeft is measured from here. */
	.chips {
		position: relative;
	}
	.sections ul {
		display: flex;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.sections a {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 44px;
		padding: 0 0.7rem;
		border-radius: 999px;
		color: var(--ink-soft);
		font-size: var(--step--1);
		font-weight: 600;
		white-space: nowrap;
		text-decoration: none;
	}
	.sections a:hover {
		color: var(--ink);
	}
	.sections a[aria-current] {
		color: var(--ink);
		background: var(--card);
		box-shadow: inset 0 0 0 1.5px var(--ink);
	}
	.dot {
		flex: none;
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		border: 1.5px solid var(--pencil);
	}
	.dot.done {
		background: var(--ink);
		border-color: var(--ink);
	}
	.dot.fix {
		background: var(--danger);
		border-color: var(--danger);
	}
	/* Enregistrer, quick: its word, and under it while not ready how many things are left (« 2 à compléter »). */
	.btn.quick {
		flex: none;
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0;
		min-height: 44px;
		line-height: 1.1;
	}
	.quick-count {
		font-size: 0.72rem;
		font-weight: 500;
		letter-spacing: 0.01em;
	}
	/* Ready, on a computer: the keys that save from any field (as on /ajouter); a touch screen has none to show. */
	.quick-keys {
		font-size: 0.72rem;
	}
	.savebar .btn kbd {
		margin-left: 0.5rem;
	}
	@media (hover: none), (pointer: coarse), (max-width: 37.5rem) {
		.btn kbd {
			display: none;
		}
	}
	.quick-wrap {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.25rem 0.5rem;
	}
	/* « 2 à compléter › »: a button to the first field missing (round 3); on a wide screen, what that is under it. */
	.count-go {
		display: inline-flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		min-height: 44px;
		padding: 0.2rem 0.35rem;
		border: 0;
		border-radius: var(--radius);
		background: none;
		color: var(--danger);
		font: inherit;
		font-size: var(--step--1);
		font-weight: 600;
		line-height: 1.25;
		text-align: left;
		cursor: pointer;
	}
	.count-go:hover {
		background: var(--hover);
	}
	.count-n {
		white-space: nowrap;
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	.count-n::after {
		content: ' ›';
	}
	.count-what {
		display: none;
		font-weight: 400;
		color: var(--ink-soft);
	}
	@media (max-width: 63.99rem) {
		.rail {
			position: sticky;
			top: 0;
			z-index: 9;
			display: flex;
			align-items: center;
			gap: 0.5rem;
			margin: 0 0 0.75rem;
			padding: 0.25rem 0;
			background: var(--paper);
			border-bottom: 1px solid var(--edge);
		}
		.sections {
			flex: 1 1 auto;
			min-width: 0;
		}
		.chips {
			overflow-x: auto;
			scrollbar-width: none;
			overscroll-behavior-x: contain;
		}
		.chips::-webkit-scrollbar {
			display: none;
		}
		/* More chips past an edge: that edge fades, so the strip reads as one to slide. */
		.chips.more-right {
			mask-image: linear-gradient(to right, #000 calc(100% - 2.5rem), transparent);
		}
		.chips.more-left {
			mask-image: linear-gradient(to right, transparent, #000 2.5rem);
		}
		.chips.more-left.more-right {
			mask-image: linear-gradient(to right, transparent, #000 2.5rem, #000 calc(100% - 2.5rem), transparent);
		}
		.chips {
			scroll-snap-type: x proximity;
			scroll-padding-inline: 2.5rem;
		}
		.chips li {
			scroll-snap-align: start;
		}
		.btn.quick {
			padding-inline: 0.85rem;
		}
		:global(html:has(form.recipe-form)) {
			scroll-padding-top: 4rem;
		}
	}
	/* The phone's picker: only at ≤ 600 px, where six chips cannot fit beside Enregistrer. */
	.jump-select {
		display: none;
	}
	@media (max-width: 37.5rem) {
		/* She types: the strip stops floating, the keyboard's small window is hers. */
		.rail.typing {
			position: relative;
		}
		/* A phone: Enregistrer is in the bar at the bottom, under the thumb (round 3); the strip keeps the parts. */
		.quick-wrap {
			display: none;
		}
		.chips {
			display: none;
		}
		.jump-select {
			display: block;
			width: 100%;
			min-height: 44px;
			font-weight: 600;
			background-color: var(--card);
		}
	}
	@media (min-width: 64rem) {
		.recipe-form {
			max-width: 63rem;
			display: grid;
			grid-template-columns: 10.5rem minmax(0, 1fr);
			column-gap: 2.5rem;
		}
		.head,
		.banner,
		.aside,
		.body {
			grid-column: 2;
		}
		.rail {
			grid-column: 1;
			grid-row: 2 / span 3;
			position: sticky;
			top: 1.25rem;
			align-self: start;
		}
		.sections ul {
			flex-direction: column;
			gap: 0.1rem;
		}
		.sections a {
			min-height: 2.5rem;
			border-radius: var(--radius);
		}
		.sections a[aria-current] {
			box-shadow: inset 3px 0 0 var(--ink);
		}
		.quick-wrap {
			flex-direction: column;
			align-items: stretch;
			margin-top: 1rem;
		}
		.btn.quick {
			width: 100%;
			min-height: 3rem;
		}
		.count-go {
			min-height: 2.5rem;
		}
		.count-what {
			display: block;
		}
	}
	/* The card beside the form: a wide screen only (≥ 1200 px); below, the toggle and the card are not there. */
	.scan-toggle,
	.scan {
		display: none;
	}
	@media (min-width: 75rem) {
		.btn.scan-toggle {
			display: inline-flex;
			width: 100%;
			justify-content: center;
			margin-top: 0.5rem;
			min-height: 2.5rem;
			font-size: var(--step--1);
		}
		.recipe-form.scan-on {
			max-width: none;
			grid-template-columns: minmax(20rem, 26rem) minmax(0, 50rem);
			justify-content: center;
		}
		.recipe-form.scan-on .sections {
			display: none;
		}
		.recipe-form.scan-on .quick-wrap {
			margin-top: 0;
		}
		.scan {
			display: block;
			margin-top: 0.75rem;
			max-height: calc(100vh - 10rem);
			overflow: auto;
			border: 1px solid var(--edge);
			border-radius: var(--radius);
			background: var(--card);
			box-shadow: var(--shadow);
		}
		.scan-img {
			display: block;
			width: 100%;
			padding: 0;
			border: 0;
			background: none;
			cursor: zoom-in;
		}
		.scan-img img {
			display: block;
			width: 100%;
			height: auto;
		}
		/* Enlarged: twice the width, the box scrolls both ways. */
		.scan.zoom .scan-img {
			width: 200%;
			cursor: zoom-out;
		}
	}
	.head {
		margin-bottom: 0.75rem;
	}
	/* The title of the page and « Quitter sans enregistrer » on one line when there is room. */
	.head:has(> h1 + .back) {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0 1rem;
	}
	.head > h1 + .back {
		flex: 0 1 auto;
		text-align: right;
	}
	.back .short {
		display: none;
	}
	@media (max-width: 37.5rem) {
		.back .long {
			display: none;
		}
		.back .short {
			display: inline;
		}
	}
	.back {
		margin: 0 0 0.35rem;
		font-size: var(--step--1);
	}
	.head > h1 + .back {
		margin: 0;
	}
	.back a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
	}
	.btn.back {
		margin-bottom: 0.5rem;
	}
	h1 {
		font-size: var(--step-3);
	}
	.lead {
		margin: 0.25rem 0 0;
		color: var(--ink-soft);
	}
	h2 {
		font-size: var(--step-1);
		margin-bottom: 0.6rem;
	}
	h3 {
		font-size: var(--step-1);
		margin: 0.75rem 0 0.2rem;
	}
	/* A heading inside a card, set like the field labels: Provenance under the title. */
	.minor-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin: 0.1rem 0 0.2rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--edge);
	}
	.minor-row h3.minor {
		margin: 0;
		padding: 0;
		border: 0;
	}
	h3.minor {
		margin: 0.9rem 0 0.4rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--edge);
		font-family: var(--sans);
		font-size: var(--step--1);
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}
	/* Each part of the form on a plain card: the red rule is for recipe cards only. */
	.card {
		position: relative;
		background: var(--card);
		border: 1px solid var(--edge);
		border-radius: var(--radius);
		padding: 0.9rem 1rem 1rem;
		margin-bottom: 1rem;
		box-shadow: var(--shadow);
	}
	/* A card's heading with « Coller une liste » at its right while the card is empty. */
	.card-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.25rem 0.75rem;
		margin-bottom: 0.6rem;
	}
	.card-head h2 {
		margin: 0;
	}
	.btn.head-paste {
		min-height: 44px;
		font-size: var(--step--1);
	}
	@media (pointer: fine) and (min-width: 34.01rem) {
		.btn.head-paste {
			min-height: 2.5rem;
			padding-block: 0.2rem;
		}
	}
	.head-box {
		margin-bottom: 0.75rem;
	}
	@media (max-width: 34rem) {
		.card {
			padding: 0.75rem 0.7rem 0.85rem;
		}
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		margin-inline: 0;
		margin-bottom: 0.6rem;
		min-width: 0;
		border: 0;
		padding: 0;
	}
	.field.narrow {
		max-width: 14rem;
	}
	.field > label,
	legend {
		font-size: var(--step--1);
		font-weight: 600;
		color: var(--ink-soft);
		padding: 0;
	}
	.req {
		font-weight: 400;
	}
	input[type='text'],
	input[type='url'],
	select,
	textarea {
		min-height: 44px;
		width: 100%;
	}
	input[aria-invalid='true'] {
		border-color: var(--danger);
	}
	.title-input {
		font-family: var(--serif);
		font-size: var(--step-2);
		font-weight: 700;
	}
	textarea {
		resize: vertical;
		line-height: 1.45;
	}
	.help,
	small.help {
		font-size: var(--step--1);
		color: var(--ink-soft);
		margin: 0 0 0.3rem;
	}
	/* The keys line: a keyboard's (a touch screen with no pointer has none to learn). */
	.help.keys {
		color: var(--pencil);
	}
	@media (hover: none) and (pointer: coarse), (max-width: 37.5rem) {
		.help.keys {
			display: none;
		}
	}
	.err {
		margin: 0.2rem 0 0;
		font-size: var(--step--1);
		color: var(--danger);
	}
	/*
	 * The line under the title: one line's room, always kept, so the form never
	 * moves under the hand when a hint (a near title) shows. UI round 1: the old
	 * ~60 px reserve read as a missing field; one text line (≈ 30 px) does not.
	 * The words give way (…) to the links.
	 */
	.field:has(> .title-input) {
		margin-bottom: 0;
	}
	.title-note {
		min-height: 1.9rem;
		display: flex;
		align-items: center;
	}
	.title-note p {
		display: flex;
		align-items: baseline;
		gap: 0 0.6rem;
		min-width: 0;
		margin: 0;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.note-text {
		flex: 0 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.title-note a,
	.note-act {
		flex: none;
		white-space: nowrap;
		font-weight: 600;
	}
	.note-act {
		padding: 0;
		border: 0;
		background: none;
		color: var(--link);
		font: inherit;
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 0.2em;
		cursor: pointer;
	}
	.note-act:hover {
		color: var(--ink);
	}
	.note-text .narrow {
		display: none;
	}
	/*
	 * A phone: the sentence whole on its line, the two links on the next —
	 * cut to « Presq… » it said nothing. Both lines' room is kept, so the
	 * form still does not move when the note shows (a very long title may
	 * take a third line).
	 */
	@media (max-width: 37.5rem) {
		.title-note {
			min-height: 3.75rem;
		}
		.title-note p {
			flex-wrap: wrap;
			gap: 0.15rem 0.9rem;
			padding-block: 0.3rem;
		}
		.note-text {
			flex: 1 1 100%;
			white-space: normal;
		}
	}
	/* A finger: the two links stay a comfortable target without growing the line. */
	/* The two actions: a 40 px target (44 px for a finger) without growing the line. */
	.title-note a,
	.note-act {
		display: inline-flex;
		align-items: center;
		min-height: 40px;
		margin-block: -0.5rem;
	}
	@media (pointer: coarse), (max-width: 37.5rem) {
		.title-note a,
		.note-act {
			min-height: 44px;
			margin-block: -0.6rem;
		}
	}
	.pair {
		padding: 0.5rem 0.75rem;
		margin-bottom: 0.6rem;
		border: 1px dashed var(--link);
		border-radius: var(--radius);
	}
	.pair p {
		margin: 0 0 0.4rem;
	}
	.pair .field {
		margin-bottom: 0.25rem;
	}
	.pair-acts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	/* « Cuisson : 12 min → 12 à 14 min ? [Mettre à jour] ✕ »: one line under the step, dismissible. */
	.nudge {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.6rem;
		margin: 0.3rem 0 0;
		padding: 0.25rem 0.25rem 0.25rem 0.6rem;
		border-left: 3px solid var(--link);
		background: var(--hover);
		font-size: var(--step--1);
	}
	.nudge .btn {
		min-height: 2.5rem;
	}
	.nudge .x {
		min-width: 2.5rem;
		justify-content: center;
	}
	@media (pointer: coarse), (max-width: 37.5rem) {
		.nudge .btn {
			min-height: 44px;
		}
		.nudge .x {
			min-width: 44px;
		}
	}
	.group-label {
		display: block;
		margin: 0 0 0.1rem;
		font-size: var(--step--1);
		font-weight: 600;
		color: var(--ink-soft);
	}
	.banner {
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
		background: #fffbe0;
		border: 1px solid var(--highlight);
		border-radius: var(--radius);
	}
	.banner p {
		margin: 0 0 0.5rem;
	}
	/* Enregistrer pressed before she chose: the question says so, in the danger ink. */
	.banner.ask {
		border-color: var(--danger);
	}
	.banner .ask-line {
		margin: 0.5rem 0 0;
		color: var(--danger);
		font-weight: 600;
	}
	/* The draft she went past by typing: one quiet line, still a tap away. */
	.aside {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 0.5rem;
		margin: 0 0 0.75rem;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	/* « Brouillon gardé · 04 h 16 »: quiet, beside Enregistrer. */
	.kept {
		font-size: var(--step--1);
		color: var(--ink-soft);
		font-variant-numeric: tabular-nums;
	}
	.msg {
		padding: 0.6rem 0.9rem;
		margin: 0 0 1rem;
		border-left: 4px solid var(--danger);
		background: var(--danger-bg);
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.acts .btn,
	.btn.add,
	.btn.quiet {
		min-height: 44px;
	}
	.add-row {
		margin-top: 0.3rem;
	}
	@media (pointer: fine) and (min-width: 34.01rem) {
		.add-row .btn,
		.group-head input.group-name,
		.group-head :global(summary) {
			min-height: 2.5rem;
			padding-block: 0.2rem;
		}
	}
	/* Servings, yield, oven and times: one compact row under the provenance, wrapping on a phone. */
	.basics {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 0 0.85rem;
		margin-top: 0.4rem;
		padding-top: 0.6rem;
		border-top: 1px solid var(--edge);
	}
	.basics > .field {
		margin-bottom: 0.5rem;
	}
	/* « Donne » : one box (« 8 portions », « 2 tourtières »), the précision of portions beside it. */
	.gives {
		flex: 1 1 17rem;
		max-width: 26rem;
		min-width: 0;
	}
	.gives .line {
		flex-wrap: wrap;
	}
	.gives-box {
		flex: 1 1 11rem;
		min-width: 0;
	}
	/* How it is filed (portions, or the yield as written): said while she is in the box. */
	.gives-as {
		display: none;
		margin: 0.15rem 0 0;
	}
	.gives:focus-within .gives-as:not(:empty) {
		display: block;
	}
	.gives input.text {
		flex: 1 1 12rem;
		width: auto;
		min-width: 0;
	}
	.gives input.note {
		flex: 1 1 9rem;
		width: auto;
		min-width: 0;
	}
	.gives select.unit {
		width: auto;
	}
	.line.also {
		margin-top: 0.35rem;
	}
	.also-label {
		font-size: var(--step--1);
		color: var(--ink-soft);
		min-width: 5.5rem;
	}
	/* The times in the same row: Préparation, Cuisson; Repos and Total once filled or asked for (« + Repos, total »), on every screen. */
	.times {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 0.5rem 0.75rem;
		flex: 0 1 auto;
		min-width: 0;
		margin: 0 0 0.5rem;
		padding: 0;
		border: 0;
	}
	/* Wide enough for « 50 min à 1 h » whole. */
	.time {
		flex: 0 0 9.5rem;
		min-width: 0;
	}
	/* Level with the boxes (under their labels). */
	.time.more {
		flex: 0 0 auto;
		align-self: start;
		margin-top: 1.3rem;
	}
	.times:not(.all) .time.extra {
		display: none;
	}
	/*
	 * How to write a time: said under the row, always — shown only while she
	 * was in a time box, it vanished as she left it, moving the next card up
	 * under the pointer that had just been pressed there.
	 */
	.times-help {
		flex: 1 1 100%;
		margin: 0 0 0.4rem;
	}
	@media (max-width: 37.5rem) {
		.times {
			flex: 1 1 100%;
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 0.4rem 0.6rem;
		}
		/* « + Repos, total » under the two boxes, which keep the whole width. */
		.time.more {
			grid-column: 1 / -1;
			align-self: start;
			margin-top: -0.6rem;
		}
		.time.more .btn {
			padding-inline: 0.2rem;
		}
	}
	
	/* What each box of a row holds, once above the rows; the same columns as ItemRow's line. A phone has none (its rows fold to lines). */
	.cols {
		display: grid;
		grid-template-columns: 4.6rem 7.5rem minmax(0, 1fr) 44px;
		gap: 0 0.35rem;
		margin: 0 0 0.1rem;
		/* Sentence case at the body's small size: small capitals read as a form's legalese (UI round 1). */
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--pencil);
	}
	.cols span:first-child {
		text-align: right;
		padding-right: 0.6rem;
	}
	.cols span:not(:first-child) {
		padding-left: 0.6rem;
	}
	@media (max-width: 37.5rem) {
		.cols {
			display: none;
		}
	}
	/* A group of ingredients: its name is a heading of the list, not another row. */
	.group.named + .group.named {
		margin-top: 0.9rem;
	}
	.group-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding-left: 0.6rem;
		border-left: 3px solid var(--ink);
		margin-bottom: 0.15rem;
	}
	input.group-name {
		flex: 1 1 auto;
		min-width: 0;
		padding-left: 0.3rem;
		border-color: transparent;
		background: transparent;
		font-family: var(--serif);
		font-size: var(--step-1);
		font-weight: 700;
	}
	input.group-name:hover {
		border-color: var(--edge);
	}
	input.group-name:focus {
		border-color: var(--ink);
		background: var(--card);
	}
	input.group-name[aria-invalid='true'] {
		border-color: var(--danger);
	}
	.tag {
		font-size: var(--step--1);
		color: var(--ink-soft);
		font-style: italic;
		white-space: nowrap;
	}
	.group-head :global(summary) {
		min-width: 44px;
		min-height: 44px;
		justify-content: center;
		padding-inline: 0;
		border-color: transparent;
		background: none;
		color: var(--ink-soft);
	}
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 44px;
		cursor: pointer;
	}
	.tools {
		display: flex;
		gap: 2px;
	}
	.tools :global(summary) {
		min-width: 44px;
		min-height: 44px;
		justify-content: center;
		padding-inline: 0;
		border-color: transparent;
		background: none;
		color: var(--ink-soft);
	}
	.tools :global(summary:hover) {
		border-color: var(--edge);
		color: var(--ink);
	}
	/*
	 * Notes, Photo, Classement: one card, each part a line of its own under a
	 * hairline. Folded, a part is its name, what it holds and « Modifier »
	 * (« Compléter », « Ajouter » when empty).
	 */
	.extras {
		padding-block: 0.3rem;
	}
	.part {
		padding-block: 0.45rem;
	}
	.part + .part {
		border-top: 1px solid var(--edge);
	}
	.part:not(.folded) .fold-head {
		margin-bottom: 0.4rem;
	}
	.photo-part {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 1rem;
	}
	.photo-part h2 {
		margin: 0;
	}
	.photo-part .photo {
		flex: 1 1 20rem;
		min-width: 0;
	}
	.photo-part .photo-acts {
		flex: 1 1 0;
		min-width: 0;
		flex-wrap: nowrap;
	}
	.photo-part .photo-acts:has(p) {
		flex-wrap: wrap;
	}
	@media (max-width: 37.5rem) {
		.photo-part .photo-acts {
			flex-wrap: wrap;
		}
	}
	/* The tags under Classement's line, folded or not. */
	.tags-inline {
		margin: 0.1rem 0 0.4rem;
	}
	h3.tags-head {
		margin: 0 0 0.15rem;
		font-family: var(--sans);
		font-size: var(--step--1);
		font-weight: 600;
		color: var(--ink-soft);
	}
	/* The folded notes: their first words, on one line. */
	.fold-sum.clip {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* A section folded to one line (Classement): its name, what it holds, « Compléter ». */
	.fold-head {
		margin: 0;
	}
	.fold-head button {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.15rem 0.75rem;
		width: 100%;
		min-height: 44px;
		padding: 0.2rem 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.fold-title {
		font-family: var(--serif);
		font-size: var(--step-1);
		font-weight: 700;
	}
	.fold-sum {
		flex: 1 1 12rem;
		min-width: 0;
		font-family: var(--sans);
		font-size: var(--step--1);
		font-weight: 400;
		color: var(--ink-soft);
	}
	.fold-act {
		margin-left: auto;
		font-family: var(--sans);
		font-size: var(--step--1);
		font-weight: 600;
		color: var(--link);
	}
	.fold-head button:hover .fold-act {
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	
	/* « Texte libre »: a plain box among the steps, its name like a field's (no red rule: a form section, not a card). */
	.free {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.3rem;
		margin: 0.25rem 0 0.9rem;
		padding: 0.6rem 0.75rem 0.75rem;
		border: 1px dashed var(--edge);
		border-radius: var(--radius);
	}
	.free > label {
		font-size: var(--step--1);
		font-weight: 600;
		color: var(--ink-soft);
	}
	.free .help {
		margin: 0;
	}
	.free textarea {
		align-self: stretch;
	}
	.free .btn {
		min-height: 44px;
		max-width: 100%;
		white-space: normal;
		text-align: left;
	}
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.step {
		display: grid;
		grid-template-columns: 2.2rem minmax(0, 1fr) auto;
		gap: 0.4rem;
		align-items: start;
		padding: 0.4rem 0;
		border-bottom: 1px solid var(--rule-blue);
	}
	.num {
		font-family: var(--serif);
		font-size: var(--step-1);
		font-weight: 700;
		color: var(--ink-soft);
		text-align: right;
		padding-top: 0.45rem;
	}
	.step.heading .num,
	.step:not(.heading) .num:not(:empty) {
		font-size: var(--step-0);
	}
	.step.heading input {
		font-family: var(--serif);
		font-weight: 700;
	}
	/* A row named in words ("Titre de section", "Texte"): the name above the field, never squeezed into the number's gutter. */
	.step.worded .num {
		grid-column: 2 / 4;
		grid-row: 1;
		padding-top: 0;
		font-family: inherit;
		font-weight: 600;
		font-size: var(--step--1);
		color: var(--ink-soft);
		text-align: left;
	}
	.step.worded .step-body {
		grid-column: 2;
		grid-row: 2;
	}
	.step.worded .tools {
		grid-column: 3;
		grid-row: 2;
	}
	/*
	 * A phone (round 2 of the usability pass): the number and ⋯ on a line of
	 * their own above the step, the box the card's whole width (it had 239 of
	 * 319 px beside the number's gutter, a long step 225 px tall).
	 */
	@media (max-width: 37.5rem) {
		.step {
			grid-template-columns: minmax(0, 1fr) 44px;
			gap: 0 0.3rem;
			padding-top: 0.15rem;
		}
		.step .num,
		.step.worded .num {
			grid-column: 1;
			grid-row: 1;
			align-self: center;
			padding-top: 0;
			text-align: left;
		}
		.step .tools,
		.step.worded .tools {
			grid-column: 2;
			grid-row: 1;
		}
		.step .step-body,
		.step.worded .step-body {
			grid-column: 1 / 3;
			grid-row: 2;
		}
	}
	.photo {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
	}
	.photo img {
		width: 3.5rem;
		height: 3.5rem;
		object-fit: cover;
		border-radius: var(--radius);
		border: 1px solid var(--edge);
	}
	/* Taken off, not yet saved: still there, faded, until « Garder la photo » or Enregistrer. */
	.photo img.going {
		opacity: 0.35;
		filter: grayscale(1);
	}
	.photo-acts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 0.75rem;
		align-items: center;
	}
	.photo-acts p {
		margin: 0;
		flex-basis: 100%;
	}
	.btn.file {
		position: relative;
		min-height: 44px;
	}
	.btn.file input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}
	.btn.file:focus-within {
		outline: 3px solid var(--focus);
		outline-offset: 2px;
	}
	/* Seasons: chips like the tags — ink-edged and ticked when chosen. */
	.toggles {
		flex-direction: row;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.75rem;
	}
	.toggles legend {
		width: 100%;
		margin-bottom: 0.3rem;
	}
	.toggle input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}
	.toggle span {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		min-height: 40px;
		padding: 0 0.85rem;
		border: 1.5px solid var(--edge);
		border-radius: 999px;
		background: var(--card);
		color: var(--ink-soft);
	}
	.toggle:hover span {
		border-color: var(--ink-soft);
	}
	.toggle input:checked + span {
		border-color: var(--ink);
		color: var(--ink);
		font-weight: 600;
	}
	.toggle input:checked + span::before {
		content: '✓';
	}
	.toggle input:focus-visible + span {
		outline: 3px solid var(--focus);
		outline-offset: 2px;
	}
	@media (pointer: coarse) {
		.toggle span {
			min-height: 44px;
		}
	}
	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
	}
	/* Difficulty and rating side by side; what the value means said beside the name. */
	.taps-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0 2.5rem;
		margin-top: 0.75rem;
	}
	.level {
		font-weight: 400;
		color: var(--ink);
	}
	.level.none {
		color: var(--pencil);
	}
	.scale {
		display: inline-flex;
		margin-top: 0.2rem;
	}
	.tap {
		min-width: 44px;
		min-height: 44px;
		border: 1.5px solid var(--ink);
		background: var(--card);
		color: var(--ink);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
	}
	/* Difficulty: five joined steps, filled up to the value. */
	.scale:not(.stars) .tap + .tap {
		border-left-width: 0;
	}
	.scale:not(.stars) .tap:first-child {
		border-radius: var(--radius) 0 0 var(--radius);
	}
	.scale:not(.stars) .tap:last-child {
		border-radius: 0 var(--radius) var(--radius) 0;
	}
	.scale:not(.stars) .tap.on {
		background: var(--ink);
		color: #fff;
	}
	.ends {
		display: flex;
		justify-content: space-between;
		width: calc(5 * 44px);
		margin-top: 0.15rem;
		font-size: 0.75rem;
		color: var(--pencil);
	}
	/* Rating: stars, filled up to the value; under the pointer, up to the one it is on. */
	.stars {
		gap: 0;
	}
	.stars .tap {
		border: 0;
		background: none;
		font-size: 1.6rem;
		line-height: 1;
		color: #d6d0c0;
	}
	.stars .tap.on {
		color: var(--ink);
	}
	@media (hover: hover) {
		.stars:hover .tap {
			color: var(--ink-soft);
		}
		.stars .tap:hover ~ .tap {
			color: #d6d0c0;
		}
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: 0.25rem 1rem;
	}
	.field.wide {
		grid-column: 1 / -1;
	}
	/* A phone: two fields side by side (de qui, d'où; livre, page); « Donne » on its line, the oven under it. */
	@media (max-width: 37.5rem) {
		.grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 0.25rem 0.6rem;
		}
		.basics {
			gap: 0 0.5rem;
		}
		.gives {
			flex-basis: 100%;
			max-width: none;
		}
		.field.book {
			grid-column: 1 / -1;
		}
	}
	/* Room for its hint « ex. 350 » whole. */
	input.short {
		width: 5.25rem;
		text-align: right;
	}
	.line select {
		width: auto;
	}
	.to {
		font-style: italic;
		color: var(--ink-soft);
	}
	.seg {
		flex: none;
		display: inline-flex;
		border: 1.5px solid var(--ink);
		border-radius: var(--radius);
		overflow: hidden;
	}
	.seg button {
		min-width: 44px;
		min-height: 44px;
		border: 0;
		background: var(--card);
		font-weight: 700;
		cursor: pointer;
	}
	.seg button.on {
		background: var(--ink);
		color: #fff;
	}
	.btn.small {
		padding-inline: 0.4rem;
		font-size: var(--step--1);
	}
	/*
	 * Save at the end of the form, in the flow: what is missing as a sentence
	 * (each part a button to its field) beside Enregistrer. It never floats —
	 * the quick Save in the rail or the strip is the one always in reach.
	 */
	.savebar {
		position: relative;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 0.5rem 1rem;
		padding: 0.75rem 0 0;
		border-top: 1px solid var(--edge);
	}
	.why {
		flex: 1 1 16rem;
		min-width: 0;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.sentence {
		margin: 0;
		line-height: 1.45;
	}
	.sentence .lead {
		font-weight: 600;
		color: var(--ink);
	}
	/* « un titre, un ingrédient »: each one takes her to its field. */
	.jump {
		display: inline;
		padding: 0;
		border: 0;
		background: none;
		color: var(--link);
		font: inherit;
		text-align: left;
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
		text-underline-offset: 0.2em;
		cursor: pointer;
	}
	.jump:hover {
		color: var(--ink);
		text-decoration-color: currentColor;
	}
	/* A finger, or a phone's width: each part of the sentence 44 px high to touch (it was 22). */
	@media (pointer: coarse), (max-width: 37.5rem) {
		.jump {
			display: inline-flex;
			align-items: center;
			min-height: 44px;
			padding-inline: 0.15rem;
			vertical-align: middle;
		}
	}
	.why .soft {
		font-weight: 400;
		color: var(--highlight-ink);
		background: var(--highlight);
		padding: 0 0.3rem;
	}
	.savebar .btn.primary {
		flex: none;
		min-width: 9rem;
		min-height: 48px;
		justify-content: center;
	}
	/* Not ready: the same navy at full strength (a faded button read as broken,
	   UI round 1); « Il manque : un titre » beside it carries the state, and a
	   touch goes to what is missing. */
	/* The first reason as one button: a phone's bar only. */
	.jump.first {
		display: none;
	}
	/*
	 * A phone (round 3): the bar is at the bottom of the screen, as on
	 * /ajouter — the first thing missing (a button to its field) and
	 * Enregistrer, one line, under the thumb. At the end of the form it is in
	 * its own place, so nothing is under it. While she types it steps back
	 * into the flow: the keyboard's small window is hers, never covered.
	 */
	@media (max-width: 37.5rem) {
		.savebar {
			position: sticky;
			bottom: 0;
			z-index: 9;
			flex-wrap: nowrap;
			gap: 0.5rem;
			margin-inline: -0.25rem;
			padding: 0.35rem 0.6rem calc(0.35rem + env(safe-area-inset-bottom));
			background: var(--card);
			border: 1px solid var(--edge);
			border-radius: var(--radius);
			box-shadow: 0 -6px 14px -10px rgba(28, 42, 66, 0.35);
		}
		.savebar.typing {
			position: relative;
		}
		.why {
			flex: 1 1 auto;
		}
		.why .sentence {
			display: none;
		}
		.jump.first {
			display: block;
			min-height: 44px;
			padding: 0.25rem 0;
			color: var(--danger);
			font-weight: 600;
			line-height: 1.25;
			text-decoration: underline;
			text-underline-offset: 0.2em;
		}
		.jump.first .lead {
			color: inherit;
		}
		.jump.first .more {
			font-weight: 400;
			color: var(--ink-soft);
		}
		.savebar .btn.primary {
			flex: none;
			min-width: 8.5rem;
			min-height: 44px;
		}
		.savebar:not(:has(.jump.first)) .btn.primary {
			margin-left: auto;
		}
		:global(html:has(form.recipe-form)) {
			scroll-padding-bottom: 5rem;
		}
	}
</style>
