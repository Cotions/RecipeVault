<script lang="ts">
	// A recipe as read: used by the recipe page and, identically, by the paste
	// box preview. Quantities rescale with the servings adjuster, in print too.
	import { onMount, untrack, type Snippet } from 'svelte';
	import { t, tagLabel, familyLabel } from '$lib/i18n';
	import { locale, prefs } from '$lib/prefs';
	import { formatDurationValue, formatSeconds } from '$lib/render/duration';
	import { formatAmount, ingredientParts, type NameForms, type ScaleBase } from '$lib/render/ingredient';
	import { ingredientHref } from '$lib/render/links';
	import { plainText } from '$lib/render/markers';
	import { scaleTarget } from '$lib/render/target';
	import { renderMarkdown } from '$lib/render/markdown';
	import { capFactor, DEFAULT_FACTOR_CAP, MULTIPLIERS, readAmount, servingsShown, servingsStep, scaleTextYield, servingsRange, subRecipeHref, type ScalingRules, type SubScaleRecipe } from '$lib/render/scale';
	import type { Conversions } from '$lib/ingredients/units';
	import { formatOven } from '$lib/render/temperature';
	import { bakedCount, findPan, panOptions, pluralPan, scaledCount, type PanSize } from '$lib/render/pans';
	import { formatNumber } from '$lib/render/fraction';
	import { takenFromParts } from '$lib/render/provenance';
	import { variantShown } from '$lib/form/family';
	import { parseBody } from '$lib/vault/body';
	import { findMarkers } from '$lib/vault/markers';
	import { headingKind } from '$lib/vault/vocab';
	import { loadStepStyle, setNumbered, stepStyle } from '$lib/stepstyle.svelte';
	import type { Ingredient, Recipe, Unit } from '$lib/vault/types';
	import IngredientLine from './IngredientLine.svelte';
	import Marked from './Marked.svelte';
	import SourceGlyph from './SourceGlyph.svelte';
	import StatusBadge from './StatusBadge.svelte';

	let {
		recipe,
		body,
		titles = {},
		photo = null,
		links = true,
		familyName = null,
		familySize = 0,
		tagViews,
		factor = $bindable(1),
		itemLinks,
		cost,
		photoPrompt,
		actions,
		statusNote,
		upkeep,
		scaling = null,
		subScale = null,
		showStatus = true
	}: {
		recipe: Recipe;
		body: string;
		/** Titles of recipes this one links to (sub-recipes, wikilinks) that exist. */
		titles?: Record<string, string>;
		/** The derived display copy; `src` null for a HEIC original (placeholder). */
		photo?: { src: string | null } | null;
		/** False in the paste preview: tags and family do not link away. */
		links?: boolean;
		/** The family's display label (vocab/families.yaml), when it has one. */
		familyName?: string | null;
		/** Recipe page: how many recipes the family holds, this one included (« Une des 4 variantes de Tourtière »). 0 in the paste preview. */
		familySize?: number;
		/** Recipe page: per tag of `recipe.tags`, its filter key and label (vocab/tag-labels.yaml). Without it (the paste preview) a tag shows as written. */
		tagViews?: { key: string; label: string }[];
		/** The scaling factor (plan 05): the page keeps it in its address (Q1 A). */
		factor?: number;
		/** Recipe page: how each line resolved, by position across groups. */
		itemLinks?: Record<number, { item?: string; key?: string; weights?: Partial<Record<Unit, number>>; forms?: NameForms }>;
		/** Recipe page: the cost line, given the current scaling factor. */
		cost?: Snippet<[number]>;
		/** Recipe page: shown where the photo goes when there is none ("Ajouter une photo", plan 04 Q13 A). */
		photoPrompt?: Snippet;
		/** Recipe page: what can be done with it, at the top right of the head. */
		actions?: Snippet;
		/** Recipe page, for whoever keeps the archive: what the review state means, and what to do about it, beside its badge. */
		statusNote?: Snippet;
		/** Recipe page, for whoever keeps the archive: one quiet line under the red rule (the review state, the names to link). */
		upkeep?: Snippet;
		/** vocab/scaling.yaml (plan 05): how amounts show at another factor; null shows the exact values. */
		scaling?: ScalingRules | null;
		/** Recipe page: the sub-recipes' yields and the conversions, so a sub-recipe's link carries the amount its line needs (Q5 A). */
		subScale?: { conversions: Conversions; recipes: Record<string, SubScaleRecipe> } | null;
		/** The review state (Brouillon, À relire…): for whoever keeps the archive, not for every reader. */
		showStatus?: boolean;
	} = $props();

	const lang = $derived(recipe.lang);
	/** Tapping an amount and the free factor (Q8 B): on the recipe page, not in the paste preview. */
	const interactive = $derived(links);
	const cap = $derived(scaling?.factor ?? DEFAULT_FACTOR_CAP);
	/** The servings at the factor: whole on the stepper, possibly not after a typed amount. */
	const servingsNow = $derived(recipe.servings ? recipe.servings * factor : 0);
	const wholeServings = $derived(Math.abs(servingsNow - Math.round(servingsNow)) < 1e-9);
	/** The multipliers offered: always the same chips, so none moves when the factor changes (a typed factor shows on the line under them). */
	const multipliers = [...MULTIPLIERS];
	/** « Pour [10] portions »: what « Autre quantité » asks for, a count when the recipe gives one, else a multiplier. */
	const target = $derived(interactive ? scaleTarget(recipe, lang, t.recipe.scale.toLowerCase()) : null);
	function stepServings(dir: 1 | -1) {
		const next = servingsStep(servingsNow, recipe.servings!, dir, scaling);
		if (next) factor = next.factor;
	}

	/** « La recette × 2 demande 2 lb (base : 1 lb). J’en ai : » — at × 1, « La recette demande 1 lb. J’en ai : ». */
	function haveLabel(base: ScaleBase): string {
		const q = { qty: { value: base.value }, unit: base.unit };
		const written = formatAmount(q, { lang, asWritten: true });
		if (factor === 1) return t.scaling.have(written);
		return t.scaling.haveScaled(formatNumber(factor, locale()), formatAmount(q, { lang, factor, rules: scaling, asWritten: true }), written);
	}
	// « J'en ai … »: a tapped amount, then factor = typed ÷ written.
	let asking = $state<{ key: string; base: ScaleBase } | null>(null);
	let haveText = $state('');
	let haveError = $state('');
	/** The amount tapped: Escape or « Annuler » gives it the focus back. */
	let askedFrom: HTMLElement | null = null;
	function ask(key: string, base: ScaleBase, from?: HTMLElement) {
		dismissHint();
		askFactor = false;
		asking = asking?.key === key && asking.base === base ? null : { key, base };
		askedFrom = from ?? null;
		haveText = '';
		haveError = '';
	}
	/** Close « J’en ai… » without changing anything, the focus back on its amount. */
	function cancelAsk() {
		asking = null;
		askedFrom?.focus();
	}
	/** Escape closes an open « J’en ai » or « Autre quantité » panel, as the filter sheet does. */
	function escapeClose(e: KeyboardEvent, close: () => void) {
		if (e.key !== 'Escape') return;
		e.preventDefault();
		e.stopPropagation();
		close();
	}
	/** A typed factor or amount → the factor, or an error line. */
	function checked(n: number | undefined): number | string {
		if (n === undefined) return t.scaling.unreadable;
		return capFactor(n, scaling) ?? t.scaling.outOfRange(formatNumber(cap.min, locale()), formatNumber(cap.max, locale()));
	}
	function applyHave(e: SubmitEvent) {
		e.preventDefault();
		if (!asking) return;
		const typed = readAmount(haveText);
		const f = checked(typed === undefined ? undefined : typed / asking.base.value);
		if (typeof f === 'string') haveError = f;
		else {
			factor = f;
			asking = null;
		}
	}
	let askFactor = $state(false);
	let factorText = $state('');
	let factorError = $state('');
	let otherButton: HTMLButtonElement | undefined = $state();
	function cancelOther() {
		askFactor = false;
		factorError = '';
		otherButton?.focus();
	}
	/** Open or close « Autre quantité », the count it asks for filled in with the current one. */
	function toggleOther() {
		askFactor = !askFactor;
		factorError = '';
		asking = null;
		factorText = askFactor && target ? formatNumber(target.base * factor, locale()) : '';
	}
	/** What the field says, as a factor: a typed count ÷ the recipe's, or the typed multiplier. */
	function typedFactor(text: string): number | undefined {
		if (target) {
			const n = readAmount(text);
			return n === undefined ? undefined : n / target.base;
		}
		return readAmount(text.replace(/^\s*[×x*]\s*/i, ''));
	}
	/** « = × 1 ¼ » beside a typed count, while it is typed. */
	const typedPreview = $derived.by(() => {
		if (!target || !askFactor) return '';
		const f = typedFactor(factorText);
		return f !== undefined && capFactor(f, scaling) !== undefined ? t.scaling.times(formatNumber(f, locale())) : '';
	});
	function applyFactor(e: SubmitEvent) {
		e.preventDefault();
		const f = checked(typedFactor(factorText));
		if (typeof f === 'string') factorError = f;
		else {
			factor = f;
			askFactor = false;
			factorError = '';
		}
	}
	function focus(node: HTMLInputElement) {
		node.focus();
		node.select();
	}
	/** From this many ingredient lines, a phone (one column) gets the sticky « Ingrédients | Préparation » bar. */
	const JUMP_MIN = 6;
	/** Every line, all groups: a long list gets a jump to the method on a phone. */
	const lineCount = $derived(recipe.ingredients.reduce((n, g) => n + g.items.length, 0));
	const jump = $derived(interactive && lineCount >= JUMP_MIN);
	/**
	 * The bar's marked half: the method once its head is in the upper part of
	 * the screen (under the bar), else the ingredients (usability round 4).
	 */
	let section = $state<'ingredients' | 'method'>('ingredients');
	let methodEl: HTMLElement | undefined = $state();
	$effect(() => {
		if (!jump || !methodEl) return;
		const el = methodEl;
		// One rectangle read per scroll event: cheap, and the state only changes when the half does.
		const on = () => {
			section = el.getBoundingClientRect().top <= window.innerHeight * 0.4 ? 'method' : 'ingredients';
		};
		on();
		window.addEventListener('scroll', on, { passive: true });
		window.addEventListener('resize', on, { passive: true });
		return () => {
			window.removeEventListener('scroll', on);
			window.removeEventListener('resize', on);
		};
	});

	/**
	 * Where a line leads, as small links after its text (never its words, which
	 * tick the line when tapped): a sub-recipe's page at the amount the line
	 * needs, the ingredient's page, or, when the page is given one, its row in
	 * the resolve queue (« non relié », for whoever keeps the archive).
	 */
	function goLinks(item: Ingredient, link: { item?: string; key?: string } | undefined) {
		const out: { kind: 'recipe' | 'item' | 'unlinked'; href: string; label: string; text: string }[] = [];
		for (const it of [item, ...(item.or ?? [])]) {
			if (it.recipe && titles[it.recipe]) out.push({ kind: 'recipe', href: subHref ? subHref(it) : `/r/${it.recipe}`, label: t.recipe.subRecipeGo(plainText(it.name)), text: t.recipe.subRecipeShort });
		}
		// A name not yet linked says nothing on the line (usability round 3): the keeper's line under the red rule counts them.
		if (!item.recipe && link?.item) out.push({ kind: 'item', href: ingredientHref(link.item), label: t.recipe.itemGo(plainText(item.name)), text: '›' });
		return out;
	}

	// Ingredients ticked off while gathering them: a small checkbox at the
	// row's start (or a tap on the row's plain text) strikes the line through.
	// A checkbox rather than the whole row, because most of a row already
	// does something when tapped: the amount scales, the name links to its
	// ingredient. Remembered for the tab's session, per recipe; never
	// printed. Kitchen mode keeps its own.
	const tickKey = $derived(`rv-ticked:${recipe.slug}`);
	let ticked = $state<Set<string>>(new Set());
	$effect(() => {
		const key = tickKey;
		try {
			ticked = new Set(JSON.parse(sessionStorage.getItem(key) ?? '[]') as string[]);
		} catch {
			ticked = new Set();
		}
	});
	function setTicked(next: Set<string>) {
		ticked = next;
		try {
			if (next.size) sessionStorage.setItem(tickKey, JSON.stringify([...next]));
			else sessionStorage.removeItem(tickKey);
		} catch {
			// storage unavailable: ticked for this page only
		}
	}
	function toggleTick(key: string) {
		const next = new Set(ticked);
		if (!next.delete(key)) next.add(key);
		setTicked(next);
	}
	/** A tap on the row, not on what it holds that does something else (an amount, a link, the « J'en ai » form). */
	function rowTap(e: MouseEvent, key: string) {
		const target = e.target as Element;
		if (target.closest('a, button, input, label, form')) return;
		if (window.getSelection()?.toString()) return;
		toggleTick(key);
	}
	/** The position of each group's first line across groups, as the index numbers them. */
	const offsets = $derived(recipe.ingredients.reduce<number[]>((a, g, i) => (a.push(i ? a[i - 1] + recipe.ingredients[i - 1].items.length : 0), a), []));
	/** Q6 B: at another amount, each measure in a step gets its scaled value beside it. */
	// At factor 1 too for an account that reads in a measuring system: a step's « 1 tasse » shows its `250 ml`.
	const stepScale = $derived(
		factor === 1
			? prefs().system === 'written'
				? undefined
				: { factor, lang, rules: scaling, title: t.scaling.stepSystemTitle }
			: { factor, lang, rules: scaling, title: t.scaling.stepAmountTitle(formatNumber(factor, locale())) }
	);
	// Each section head says what it heads: Préparation keeps the card's red
	// rule, Variantes gets a small label and a hairline (its text in the
	// steps' voice), Notes become the note de famille (below). Read
	// here from the rendered heads rather than in renderMarkdown, whose output
	// is pinned by the scaling baseline.
	const QUIET = new Set(['variants', 'alternatives']);
	const src = $derived(recipe.source);
	const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	/** A book, magazine, show or site with a title: « Tiré de <titre>, <auteur>, p. 109 ». */
	const published = $derived(!!src?.title && ['book', 'magazine', 'tv', 'website'].includes(src.type ?? ''));
	/** The author without markers, to choose « de » or « d’ ». */
	const plainName = $derived((src?.author ?? '').replace(/\[[^\]]*\]/g, '').trim());
	// Notes are the archive's own voice: each Notes section becomes a « note de
	// famille » (a tinted card, a pen rule, the text full size), signed with
	// the person the recipe is from when it is a person's (a family card or
	// one of unknown kind), not a book's author or a publisher.
	const noteBy = $derived(src?.author && !published && (!src.type || src.type === 'family') ? plainName : '');
	const html = $derived(
		renderMarkdown(body, { resolve: (s) => titles[s], numbered: stepStyle.numbered, scale: stepScale })
			.replace(/<h2>(.*?)<\/h2>/g, (_, inner: string) => {
				const kind = headingKind(inner.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&'));
				return `<h2 class="sec-${kind}${QUIET.has(kind) ? ' quiet' : ''}">${inner}</h2>`;
			})
			// [+] reads as a word, « ajouté », in a small chip; its title and the legend say the rest.
			.replace(/(<mark class="mk mk-added"[^>]*>)\[\+\](<\/mark>)/g, `$1${t.recipe.markerAdded}$2`)
			.replace(
				/(<h2 class="sec-notes[^"]*">[\s\S]*?<\/h2>)([\s\S]*?)(?=<h2|$)/g,
				(_, head: string, text: string) =>
					`<section class="family-note">${head}<div class="note-text">${text}</div>${noteBy ? `<p class="note-by">— ${escapeHtml(noteBy)}</p>` : ''}</section>`
			)
	);
	/** The method opens on a head: the steps' style control sits on its line. */
	const opensOnHead = $derived(html.trimStart().startsWith('<h2'));
	const steps = $derived(parseBody(body).body.steps);
	/** The pan a step (or a text yield) names, read once per recipe (plan 05, "The pan"). */
	const pan = $derived(findPan([...steps.map((s) => s.text), ...(typeof recipe.yield === 'string' ? [recipe.yield] : [])]));
	/** Whole things baked one per pan (« 2 tourtières », a pastry « pour 2 tartes »): at × 2, twice the pans, not a pan twice as large. */
	const bakedThings = $derived(bakedCount(recipe));
	/**
	 * At another amount, what to bake it in, short, for the one note under the
	 * list: pans whose bottom makes the scaled area (same depth, same times),
	 * else « moule : × 1 ½ la surface ». In the reader's words; the card's own
	 * word for the pan when it reads the card's language. A recipe that makes
	 * whole pies or cakes gets as many pans (« prévoir 4 assiettes à tarte »).
	 */
	const panLine = $derived.by(() => {
		if (factor === 1) return '';
		if (bakedThings) {
			const s = scaledCount(bakedThings.count, factor);
			const fallback = locale() === 'en' ? (bakedThings.pie ? 'pie plate' : 'pan') : bakedThings.pie ? 'assiette à tarte' : 'moule';
			const word = pan && locale() === lang ? pan.word : fallback;
			const size = pan?.size ? t.scaling.panSize(formatNumber(pan.size.w, locale()), formatNumber(pan.size.h, locale()), pan.size.shape === 'round', pan.size.unit === 'cm') : '';
			return t.scaling.panBakedShort(s.approx, formatNumber(s.n, locale()), pluralPan(word, s.n, locale()), size);
		}
		if (!pan) return '';
		const f = formatNumber(factor, locale());
		if (!pan.size) return t.scaling.panAreaShort(f);
		const opts = panOptions(pan.size, factor);
		if (!opts.length) return t.scaling.panAreaShort(f);
		const word = locale() === lang ? pan.word : locale() === 'en' ? 'pan' : 'moule';
		const dims = (s: PanSize) => t.scaling.panSize(formatNumber(s.w, locale()), formatNumber(s.h, locale()), s.shape === 'round', s.unit === 'cm');
		return t.scaling.panShort(opts.map((o) => t.scaling.panCount(o.count, word, dims(o.size))));
	});
	/** At another amount, any line rounded to a kitchen measure (≈). */
	const anyApprox = $derived(factor !== 1 && recipe.ingredients.some((g) => g.items.some((it) => ingredientParts(it, { factor, lang, rules: scaling }).some((p) => p.kind === 'approx'))));
	const hasSteps = $derived(steps.length > 0);
	// Read from the rendered method: an amount split by emphasis or a marker is marked there, not in the raw text.
	const stepHasAmount = $derived(!!stepScale && html.includes('class="step-scaled"'));
	/**
	 * At another amount, one short note under the list (usability round 6):
	 * what stays the card's (« Temps, four et moule inchangés »; the steps too
	 * when none of their amounts shows its scaled value), the pan to bake it
	 * in, and what ≈ means. Never above the method: one note, one place.
	 */
	const scaleNote = $derived.by(() => {
		if (factor === 1) return '';
		const kept = hasSteps || oven || times.length ? t.scaling.kept({ steps: hasSteps && !stepHasAmount, oven: !!oven, pan: !panLine && !!oven }) : '';
		return [kept, panLine, anyApprox ? t.scaling.approxShort : ''].filter(Boolean).join(' · ');
	});
	const subHref = $derived(subScale ? (line: Ingredient) => subRecipeHref(line, subScale.recipes[line.recipe!], subScale.conversions, factor, scaling) : undefined);
	// « Astuce : touchez une quantité… »: in the scale line's place at × 1
	// (so it takes no line of its own), said per device until she scales once,
	// by any control, or closes it at its ✕ (usability round 6). Shown only
	// after the page knows it was not seen, so it never flashes.
	const HINT_KEY = 'rv-tap-hint';
	let hintShown = $state(false);
	const hintNeeded = $derived(interactive && recipe.ingredients.some((g) => g.items.some((it) => it.qty && !it.toTaste)));
	onMount(() => {
		loadStepStyle();
		try {
			hintShown = localStorage.getItem(HINT_KEY) !== 'seen';
		} catch {
			// storage unavailable: the hint stays off rather than coming back on every page
		}
	});
	function dismissHint() {
		if (!hintShown) return;
		hintShown = false;
		try {
			localStorage.setItem(HINT_KEY, 'seen');
		} catch {
			// gone for this page only
		}
	}
	// A change of the amount on this recipe is a scale: the hint has done its work.
	// Another recipe (the page's component kept, its factor read from the address) is not.
	let lastAmount: { slug: string; factor: number } | null = null;
	$effect(() => {
		const now = { slug: recipe.slug, factor };
		untrack(() => {
			if (lastAmount && lastAmount.slug === now.slug && Math.abs(lastAmount.factor - now.factor) > 1e-9) dismissHint();
			lastAmount = now;
		});
	});
	const oven = $derived(recipe.oven ? formatOven(recipe.oven) : null);
	/** The markers of number fields written with one (`servings: "4 [?]"`), shown after the number. */
	const markersOf = (...raw: (string | undefined)[]) =>
		raw.flatMap((r) => (r ? findMarkers(r, '').map((m) => m.text) : [])).join(' ');
	const ovenMarkers = $derived(recipe.oven ? markersOf(recipe.oven.tempRaw, recipe.oven.tempMaxRaw) : '');
	const servingsMarkers = $derived(markersOf(recipe.servingsRaw, recipe.servingsMaxRaw));
	const kinds = $derived(new Set(recipe.markers.map((m) => (m.kind === 'uncertain-alt' ? 'uncertain' : m.kind))));

	const sourceParts = $derived.by(() => {
		if (!src) return [] as string[];
		const out: string[] = [];
		if (src.title) out.push(src.page !== undefined ? `${src.title}, ${t.recipe.page} ${src.page}` : src.title);
		else if (src.page !== undefined) out.push(`${t.recipe.page} ${src.page}`);
		if (src.note) out.push(src.note);
		return out;
	});

	const times = $derived(
		(
			[
				['prep', t.recipe.prep],
				['cook', t.recipe.cook],
				['rest', t.recipe.rest],
				['total', t.recipe.total]
			] as const
		)
			.map(([k, label]) => ({ label, value: recipe.times?.[k] }))
			.filter((x) => x.value)
	);
	const computedTotal = $derived.by(() => {
		const tm = recipe.times;
		if (!tm || tm.total) return null;
		const parts = [tm.prep, tm.cook, tm.rest].filter((d) => d !== undefined);
		if (parts.length < 2) return null;
		return parts.reduce((n, d) => n + (d.maxSeconds ?? d.seconds), 0);
	});

	/** The yield at the factor (Q7 A): an object scaled like a line, a text's leading number scaled, else the text with the factor beside it. */
	const yieldText = $derived.by(() => {
		const y = recipe.yield;
		if (!y) return null;
		if (typeof y === 'string') {
			const s = scaleTextYield(y, factor, scaling, lang);
			return `${s.approx ? '≈ ' : ''}${s.text}${s.scaled ? '' : ` ${t.scaling.yieldTimes(formatNumber(factor, lang))}`}`;
		}
		const amount = formatAmount(y, { lang, factor, rules: scaling });
		return [amount, y.note].filter(Boolean).join(' ');
	});
	/** The servings at the factor, a range scaled at both ends (Q7 A). */
	const shownServings = $derived(servingsRange(recipe, factor, lang));
	/** The card's own servings, at × 1. */
	const base1 = $derived(servingsRange(recipe, 1, lang));

	const factCount = $derived(times.length + (computedTotal ? 1 : 0) + (oven ? 1 : 0) + (recipe.servings ? 1 : 0) + (yieldText ? 1 : 0));
	const hasFacts = $derived(factCount > 0);

	// The photo, a small print in the head; tapped, it opens full in a dialog.
	let viewer: HTMLDialogElement | undefined = $state();
	function openPhoto(e: MouseEvent) {
		if (!viewer?.showModal || e.metaKey || e.ctrlKey || e.shiftKey) return;
		e.preventDefault();
		viewer.showModal();
	}

	/** Only http(s) becomes a link: a `javascript:` URL in a file must never be clickable. */
	function webUrl(url: string): boolean {
		try {
			return ['http:', 'https:'].includes(new URL(url).protocol);
		} catch {
			return false;
		}
	}

	/**
	 * The recipe page's own variant label, after « Une des 4 variantes de
	 * Tourtière » (usability round 3): as she reads it (lib/form/family.ts,
	 * « avec aneth », « de la revue »), left out when it only repeats who it is
	 * from, which the provenance line under the title says already.
	 */
	const ownVariant = $derived.by(() => {
		if (!recipe.variant) return '';
		const shown = variantShown(recipe.variant, { author: src?.author, source_type: src?.type, source_title: src?.title, title: recipe.title });
		const author = src?.author ? plainText(src.author) : '';
		return author && shown.endsWith(author) ? '' : shown;
	});
	/** A variant's label as written (`livre`, `tante-aline`), for display: « Livre », « Tante aline ». */
	function variantLabel(v: string): string {
		const words = v.replace(/-/g, ' ').trim();
		return words.charAt(0).toLocaleUpperCase(lang) + words.slice(1);
	}

	function host(url: string): string {
		try {
			return new URL(url).hostname || url;
		} catch {
			return url;
		}
	}
</script>

{#snippet url(u: string)}{#if webUrl(u)}<a href={u} rel="noopener noreferrer external">{host(u)}</a>{:else}<span class="url">{u}</span>{/if}{/snippet}

<!-- The kind of source, as a small line drawing before the provenance: a card, a book, a clipping, a site, a show, a pencil. -->

<article class="recipe" class:has-photo={!!photo} class:has-acts={!!actions} class:preview={!links} lang={lang}>
	<header class="head">
		{#if upkeep || recipe.family || (showStatus && recipe.status)}<div class="pre">
		<!-- For whoever keeps the archive only: one quiet line under the red rule (usability round 3). -->
		{#if upkeep}<div class="upkeep no-print" role="group" aria-label={t.recipe.upkeep}>{@render upkeep()}</div>{/if}
		{#if recipe.family || (showStatus && recipe.status)}
			<p class="eyebrow">
				{#if recipe.family}
					{@const name = familyLabel(recipe.family, familyName)}
					<!-- « Une des 4 variantes de Tourtière »: the dish it is a variant of (one word,
					     « variante », for sibling recipes on the whole page), then the variant's own
					     label (« — sans porc »), unless it only repeats the author the provenance names. -->
					<span class="family">
						{#if links}{t.recipe.versionOf(familySize, name)}<a href="/famille/{recipe.family}">{name}</a
							>{#if ownVariant}<span class="variant" data-testid="own-variant">{` — ${ownVariant}`}</span>{/if}{:else}{name}{#if recipe.variant}<span class="variant"> — {variantLabel(recipe.variant)}</span>{/if}{/if}
					</span>
				{/if}
				{#if showStatus}<span class="status"><StatusBadge status={recipe.status} />{#if statusNote}{@render statusNote()}{/if}</span>{/if}
			</p>
		{/if}
		</div>{/if}
		<h1><Marked text={recipe.title} /></h1>
	</header>

	{#if photo}
		<!-- The scan or the dish: a print laid on the card at the head's right (a strip
		     under the title on a phone); tapped, it opens full in a dialog. -->
		<figure class="photo">
			{#if photo.src}
				<a href={photo.src} onclick={openPhoto} title={t.recipe.photoOpen}
					><img src={photo.src} alt={t.recipe.photo} decoding="async" /><svg class="enlarge" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 3.5h4.5V8M8 16.5H3.5V12M16.5 3.5l-5 5M3.5 16.5l5-5" /></svg></a
				>
				<figcaption class="no-print"><a href={photo.src} onclick={openPhoto}>{t.recipe.photoOpen}</a></figcaption>
			{:else}
				<div class="heic">{t.recipe.heic}</div>
			{/if}
		</figure>
		{#if photo.src}
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -- a click on the backdrop closes; Escape and the button do the same from the keyboard -->
			<dialog class="viewer" bind:this={viewer} aria-label={t.recipe.photo} onclick={(e) => e.target === viewer && viewer?.close()}>
				<img src={photo.src} alt={t.recipe.photo} />
				<form method="dialog"><button class="btn" type="submit">{t.app.close}</button></form>
			</dialog>
		{/if}
	{:else if photoPrompt}
		<div class="photo prompt no-print">{@render photoPrompt()}</div>
	{/if}

	{#if src}
		<div class="prov-row">
			<p class="source">
				{#if src.type}<SourceGlyph type={src.type} />{/if}
				<span class="prov">
					{#if published}
						<!-- « Tiré de Cuisine familiale d’autrefois, Éditions du Pignon, p. 109 » -->
						{@const [lead, rest] = takenFromParts(src.title!)}{lead} <cite><Marked text={rest} /></cite>{#if src.author}, <Marked text={src.author} />{/if}{#if src.page !== undefined}, {t.recipe.page}&nbsp;{src.page}{/if}{#if src.note}, <Marked text={src.note} />{/if}{#if src.url}, {@render url(src.url)}{/if}
					{:else}
						{#if src.author}{t.recipe.from(plainName)}<strong><Marked text={src.author} /></strong>{/if}
						{#if src.author && (sourceParts.length || src.url)}<span aria-hidden="true"> — </span>{/if}
						{#if !src.author}{src.type ? (t.source[src.type] ?? src.type) : t.recipe.sourceUnknown}{#if sourceParts.length || src.url}<span aria-hidden="true"> — </span>{/if}{/if}
						{#each sourceParts as part, i (i)}{#if i > 0}, {/if}<Marked text={part} />{/each}
						{#if src.url}{#if sourceParts.length}, {/if}{@render url(src.url)}{/if}
					{/if}
				</span>
			</p>
		</div>
	{/if}

	{#if hasFacts}
		<dl class="facts" class:many={factCount > 4}>
			{#each times as tm (tm.label)}
				<div><dt>{tm.label}</dt><dd>{formatDurationValue(tm.value!, lang)}</dd></div>
			{/each}
			{#if computedTotal}
				<div><dt>{t.recipe.total}</dt><dd>{formatSeconds(computedTotal, lang)}</dd></div>
			{/if}
			{#if oven}
				<div><dt>{t.recipe.oven}</dt><dd>{oven.written}{#if ovenMarkers}&nbsp;<Marked text={ovenMarkers} />{/if} <span class="conv">({oven.converted})</span></dd></div>
			{/if}
			{#if recipe.servings}
				<div>
					<dt>{t.recipe.servings}</dt>
					<dd>
						{#if factor !== 1}
							<!-- Scaled: the count the stepper says, never a second, different figure (UI round 2); the card's own beside it. -->
							{servingsShown(servingsNow, lang)}
							<span class="conv">({t.scaling.servingsWas(base1.hi ? t.recipe.servingsRange(base1.lo, base1.hi) : base1.lo)})</span>
						{:else}
							{shownServings.hi ? t.recipe.servingsRange(shownServings.lo, shownServings.hi) : shownServings.lo}{#if servingsMarkers}&nbsp;<Marked text={servingsMarkers} />{/if}
						{/if}
						{#if recipe.servingsNote}<span class="conv"><Marked text={recipe.servingsNote} /></span>{/if}
					</dd>
				</div>
			{/if}
			{#if yieldText}
				<div><dt>{t.recipe.yield}</dt><dd><Marked text={yieldText} /></dd></div>
			{/if}
		</dl>
	{/if}

	{#if actions}<div class="acts no-print">{@render actions()}</div>{/if}

	{#if recipe.tags.length || recipe.season.length}
		<ul class="tags" aria-label={t.recipe.tags}>
			{#each recipe.tags as tag, i (tag)}
				{@const view = tagViews?.[i] ?? { key: tag, label: tagLabel(tag) }}
				<li>{#if links}<a href="/?tag={encodeURIComponent(view.key)}">{view.label}</a>{:else}{view.label}{/if}</li>
			{/each}
			{#each recipe.season as s (s)}
				<li class="season">{t.season[s] ?? s}</li>
			{/each}
		</ul>
	{/if}

	<div class="columns">
		{#if jump}
			<!-- One column (a phone, a narrow window): « Ingrédients | Préparation » stays at the top of the screen
			     while the sheet is read, the part in sight marked; a bar of its own, over nothing she reads (usability round 4). -->
			<nav class="jumpbar no-print" aria-label={t.recipe.jumpLabel} data-testid="jumpbar">
				<a href="#ingredients-title" aria-current={section === 'ingredients' ? 'location' : undefined} onclick={() => (section = 'ingredients')}>{t.recipe.ingredients}</a>
				<a href="#preparation" aria-current={section === 'method' ? 'location' : undefined} onclick={() => (section = 'method')}>{t.recipe.method}</a>
			</nav>
		{/if}
		<section class="ingredients" aria-labelledby="ingredients-title">
			<div class="ing-head">
				<h2 id="ingredients-title">{t.recipe.ingredients}</h2>
				<!-- The controls keep their places whatever the amount: « Remettre » and the
				     factor are on the line under them, so a second tap lands where the first did. -->
				<div class="scaler no-print">
					{#if recipe.servings}
						<div class="pill stepper">
							<button class="step" type="button" aria-label={t.recipe.decrease} disabled={!servingsStep(servingsNow, recipe.servings, -1, scaling)} onclick={() => stepServings(-1)}>−</button>
							{#if interactive}
								<!-- The count, tapped, asks for one (« Pour [10] portions »): 8 → 24 in one tap and a number. -->
								<button class="count" type="button" title={t.scaling.countTitle} aria-label={t.scaling.countLabel(servingsShown(servingsNow, lang))} aria-expanded={askFactor} onclick={toggleOther}><output aria-live="polite">{servingsShown(servingsNow, lang)} <span class="unit">{t.recipe.scale.toLowerCase()}</span></output></button>
							{:else}
								<output aria-live="polite">{servingsShown(servingsNow, lang)} <span class="unit">{t.recipe.scale.toLowerCase()}</span></output>
							{/if}
							<button class="step" type="button" aria-label={t.recipe.increase} disabled={!servingsStep(servingsNow, recipe.servings, 1, scaling)} onclick={() => stepServings(1)}>+</button>
						</div>
					{:else}
						<div class="pill times" role="group" aria-label={t.recipe.scaleFactor}>
							{#each multipliers as m (m)}
								<button type="button" aria-pressed={factor === m} onclick={() => (factor = m)}>×&nbsp;{formatNumber(m, lang)}</button>
							{/each}
						</div>
					{/if}
					{#if interactive && !recipe.servings}
						<!-- « Autre quantité » beside the × pill; with servings, the stepper's count is the way (tapping it opens the same panel — UI round 2). -->
						<button class="btn quiet other" type="button" bind:this={otherButton} aria-expanded={askFactor} aria-label={t.scaling.other} title={t.scaling.other} onclick={toggleOther}
							><span class="long" aria-hidden="true">{t.scaling.other}</span><span class="short" aria-hidden="true">{t.scaling.otherShort}</span></button
						>
					{/if}
				</div>
				<!-- One line under the controls, its height always there so the list never moves:
				     at × 1 the tap hint until she has scaled once, else nothing (the head says
				     what the recipe makes); scaled, « Recette × 2 · donne 4 tourtières · Remettre ». -->
				{#if interactive || factor !== 1}
					<div class="scale-status" class:at-base={factor === 1} class:no-print={factor === 1}>
						{#if factor !== 1}
							<p class="what">
								<span class="scaled">{t.scaling.factorShown(formatNumber(factor, locale()))}</span>{#if yieldText}<span class="result"
										><span class="sep" aria-hidden="true">&nbsp;·&nbsp;</span>{t.scaling.yields} <strong><Marked text={yieldText} /></strong></span
									>{/if}<span class="sep no-print" aria-hidden="true">&nbsp;·&nbsp;</span><button class="reset no-print" type="button" onclick={() => ((factor = 1), (asking = null))}>{t.recipe.reset}</button>
							</p>
						{:else if hintNeeded && hintShown}
							<p class="tap-hint" role="note">
								<span>{t.scaling.tapHint}</span>
								<button type="button" class="hint-x" aria-label={t.scaling.tapHintClose} title={t.scaling.tapHintClose} onclick={dismissHint}><span aria-hidden="true">✕</span></button>
							</p>
						{/if}
					</div>
				{/if}
			</div>
			{#if askFactor}
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -- Escape from any of its fields or buttons closes it -->
				<form class="ask no-print" onsubmit={applyFactor} onkeydown={(e) => escapeClose(e, cancelOther)}>
					{#if target}
						<!-- « Pour [10] portions = × 1 ¼ »: the count she wants, the factor it makes beside it. -->
						<label>{t.scaling.forLabel} <input inputmode="decimal" autocomplete="off" size="4" bind:value={factorText} use:focus oninput={() => (factorError = '')} /> <Marked text={target.word} /></label>
						<output class="typed" aria-live="polite">{#if typedPreview}= {typedPreview}{/if}</output>
					{:else}
						<label>{t.scaling.factorLabel} <span aria-hidden="true">×</span> <input inputmode="decimal" autocomplete="off" size="5" bind:value={factorText} use:focus /></label>
					{/if}
					<button class="btn primary" type="submit">{t.scaling.apply}</button>
					{#if factorError}<p class="err" role="alert">{factorError}</p>{/if}
				</form>
			{/if}
			{#each recipe.ingredients as g, gi (gi)}
				<div class="group" class:optional={g.optional}>
					{#if g.group || g.optional}
						<h3>
							{#if g.group}<Marked text={g.group} />{/if}
							{#if g.optional}<span class="opt">({t.recipe.optionalGroup})</span>{/if}
						</h3>
					{/if}
					<ul>
						{#each g.items as item, ii (ii)}
							{@const key = `${gi}:${ii}`}
							{@const done = interactive && ticked.has(key)}
							{@const link = itemLinks?.[offsets[gi] + ii]}
							<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -- the row's checkbox is the way to tick it, by finger or keyboard; a tap on the row's plain text does the same -->
							<li class:done onclick={interactive ? (e) => rowTap(e, key) : undefined}>
								{#if interactive}<label class="tickbox no-print"><input class="tick" type="checkbox" checked={done} onchange={() => toggleTick(key)} aria-labelledby="ing-{gi}-{ii}" /><span class="box" aria-hidden="true"></span></label>{/if}
								<span class="line" id="ing-{gi}-{ii}"><IngredientLine {item} {factor} {lang} {titles} rules={scaling} {subHref} {link} plainNames={interactive} onscale={interactive ? (b, el) => ask(key, b, el) : undefined} /></span>
								{#if interactive}
									{#each goLinks(item, link) as go (go.href + go.kind)}
										<!-- « › » and « recette › » are drawn (::before), so the line's text stays the line's. -->
										<a class="go {go.kind} no-print" href={go.href} aria-label={go.kind === 'unlinked' ? undefined : go.label} title={go.label} data-mark={go.kind === 'unlinked' ? undefined : go.text}>{#if go.kind === 'unlinked'}{go.text}{/if}</a>
									{/each}
								{/if}
								{#if asking?.key === key}
									<!-- svelte-ignore a11y_no_noninteractive_element_interactions -- Escape from any of its fields or buttons closes it -->
									<form class="ask no-print" onsubmit={applyHave} onkeydown={(e) => escapeClose(e, cancelAsk)}>
										<label>{haveLabel(asking.base)} <input inputmode="decimal" autocomplete="off" size="5" bind:value={haveText} use:focus /></label>
										<button class="btn primary" type="submit">{t.scaling.apply}</button>
										<button class="btn quiet" type="button" onclick={cancelAsk}>{t.scaling.cancel}</button>
										{#if haveError}<p class="err" role="alert">{haveError}</p>{/if}
									</form>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/each}
			{#if scaleNote}
				<!-- What stays the card's, the pan, what ≈ means: one note, under the list (usability round 6). -->
				<p class="foot" role="note">{scaleNote}</p>
			{/if}
			{#if ticked.size && interactive}
				<p class="ticks no-print"><span>{t.recipe.ticked(ticked.size)}</span><span class="sep" aria-hidden="true">&nbsp;·&nbsp;</span><button type="button" onclick={() => setTicked(new Set())}>{t.recipe.untickAll}</button></p>
			{/if}
		</section>

		<section class="method" id="preparation" bind:this={methodEl}>
			{#if hasSteps && interactive}
				<!-- Not in the paste preview: it checks what will be saved; the style is the reader's.
				     Bullets by default (issue #5); both choices in sight, the one in use pressed. -->
				<div class="step-style no-print" class:on-head={opensOnHead} role="group" aria-label={t.recipe.stepStyle}>
					<button type="button" aria-pressed={!stepStyle.numbered} onclick={() => setNumbered(false)}><span class="glyph" aria-hidden="true">•</span>{t.recipe.stepsBullets}</button
					><button type="button" aria-pressed={stepStyle.numbered} onclick={() => setNumbered(true)}><span class="glyph" aria-hidden="true">1.</span>{t.recipe.numberSteps}</button>
				</div>
			{/if}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- markdown-it with html: false; the notice and the link are escaped -->
			{@html html}
			<!-- The cost: a footnote of the method, not a line of the ingredient column. -->
			{#if cost}<div class="cost-slot">{@render cost(factor)}</div>{/if}
		</section>
	</div>

	{#if kinds.size}
		<aside class="legend" aria-label={t.recipe.legend}>
			{#if kinds.has('uncertain')}<span><mark class="mk mk-uncertain">[?]</mark> {t.recipe.legendUncertain}</span>{/if}
			{#if kinds.has('illegible')}<span><mark class="mk mk-illegible">[illisible]</mark> {t.recipe.legendIllegible}</span>{/if}
			{#if kinds.has('added')}<span><mark class="mk mk-added">{t.recipe.markerAdded}</mark> {t.recipe.legendAdded}</span>{/if}
		</aside>
	{/if}
</article>

<style>
	/* The sheet: one index card, its red rule along the top. */
	.recipe {
		background: var(--card);
		border-top: 3px solid var(--rule-red);
		padding: 1.25rem 1rem 1.5rem;
		box-shadow: 0 1px 0 var(--line);
	}
	@media (min-width: 48rem) {
		.recipe {
			padding: 2rem 2.25rem 2.25rem;
		}
	}

	/* The head. On a phone it reads down: the title, the scan as a strip
	   across the width (its top, where a card's title is), where it comes
	   from, the facts in one row, Cuisiner across the width, the tags, then
	   the ingredients. From 56rem, without a photo, the actions line up with
	   the title on its right. With one, the head is two columns: the title,
	   provenance, facts, tags and actions at the left, the print at the right
	   (~240 px, whole), so the facts no longer wait under it. */
	.recipe {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-areas: 'head' 'photo' 'prov' 'facts' 'acts' 'tags' 'columns' 'legend';
	}
	.head {
		grid-area: head;
		min-width: 0;
	}
	.prov-row {
		grid-area: prov;
		min-width: 0;
	}
	.photo {
		grid-area: photo;
	}
	.facts {
		grid-area: facts;
	}
	.acts {
		grid-area: acts;
	}
	.tags {
		grid-area: tags;
	}
	.columns {
		grid-area: columns;
	}
	.legend {
		grid-area: legend;
	}
	/* Up to 56rem, with a photo: the print a small square beside the title
	   (not a strip under it), so the facts, Cuisiner and the first
	   ingredients come up the first screen. */
	@media (max-width: 55.99rem) {
		.recipe.has-photo {
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas: 'eyebrow eyebrow' 'title photo' 'prov prov' 'facts facts' 'acts acts' 'tags tags' 'columns columns' 'legend legend';
			column-gap: 0.9rem;
		}
		/* The family line across the width, the title beside the print. */
		.has-photo .head {
			display: contents;
		}
		.has-photo .pre {
			grid-area: eyebrow;
		}
		.has-photo h1 {
			grid-area: title;
			align-self: center;
		}
	}
	/* Phone: the tags (ways into the list, not the recipe) after the method. */
	@media (max-width: 40rem) {
		.recipe:not(.preview) {
			grid-template-areas: 'head' 'photo' 'prov' 'facts' 'acts' 'columns' 'tags' 'legend';
		}
		.recipe.has-photo:not(.preview) {
			grid-template-areas: 'eyebrow eyebrow' 'title photo' 'prov prov' 'facts facts' 'acts acts' 'columns columns' 'tags tags' 'legend legend';
		}
		.recipe:not(.preview) .tags {
			margin-top: 1.5rem;
			padding-top: 0.9rem;
			border-top: 1px solid var(--line);
		}
	}
	@media (min-width: 56rem) {
		.recipe.has-acts {
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas: 'head acts' 'prov prov' 'facts facts' 'tags tags' 'columns columns' 'legend legend';
			column-gap: 2rem;
		}
		/* The last row of the left column takes what the print needs beyond the
		   rest, so a tall page never spreads the facts apart. */
		.recipe.has-photo {
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-rows: auto auto auto auto auto 1fr auto auto;
			grid-template-areas: 'head photo' 'prov photo' 'facts photo' 'tags photo' 'acts photo' '. photo' 'columns columns' 'legend legend';
			column-gap: 2.5rem;
		}
	}

	.eyebrow {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.75rem;
		margin: 0 0 0.35rem;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.family a {
		font-weight: 600;
	}
	/* The keeper's line: the review state and the names to link, in the quiet
	   ink, under the red rule; the family never sees it. */
	.upkeep {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.15rem 0;
		margin: 0 0 0.5rem;
		font-size: var(--step--1);
		line-height: 1.5;
		color: var(--ink-soft);
	}
	h1 {
		font-size: var(--step-3);
		max-width: 30ch;
	}
	@media (min-width: 48rem) {
		h1 {
			font-size: var(--step-4);
		}
	}
	@media (max-width: 40rem) {
		.has-photo h1 {
			font-size: 1.75rem;
		}
	}
	/* The provenance: the archive's signature, a line in the hand of the card. */
	.source {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin: 0.5rem 0 0;
		font-family: var(--serif);
		font-size: 1.25rem;
		font-style: italic;
		line-height: 1.4;
		color: var(--ink-soft);
	}
	.source strong {
		color: var(--ink);
		font-weight: 600;
	}
	.source cite {
		font-style: normal;
		color: var(--ink);
	}
	.source :global(.glyph) {
		flex: none;
		align-self: flex-start;
		margin-top: 0.2em;
	}
	@media (max-width: 40rem) {
		.source {
			font-size: 1.125rem;
		}
	}
	/* The paste preview: the same sheet, a smaller head, so the ingredients show without scrolling. */
	.preview {
		padding: 1rem 1.25rem 1.25rem;
	}
	.preview h1 {
		font-size: var(--step-3);
	}
	.preview .facts {
		margin-top: 0.75rem;
		padding-block: 0.5rem;
	}

	/* The facts: one row of small labels over their values. */
	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.75rem;
		margin: 1.25rem 0 0;
		padding: 0.75rem 0;
		border-block: 1px solid var(--line);
	}
	.facts div {
		display: flex;
		flex-direction: column;
	}
	/* « Cuisson », « Four », « Donne »: sentence case at the read floor (14 px), the value under it the figure. */
	.facts dt {
		font-family: var(--sans);
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--ink-soft);
	}
	.facts dd {
		margin: 0.1rem 0 0;
		font-size: var(--step-1);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.conv {
		font-weight: 400;
		color: var(--ink-soft);
	}
	/* Phone: up to four facts in one row across the width. */
	@media (max-width: 40rem) {
		.facts {
			gap: 0.4rem 1rem;
			margin-top: 0.85rem;
			padding: 0.5rem 0;
		}
		.facts:not(.many) {
			flex-wrap: nowrap;
			justify-content: space-between;
		}
		/* A preview sits in a narrower column than the page: its facts may
		   take two rows rather than run their labels together. */
		.preview .facts:not(.many) {
			flex-wrap: wrap;
			justify-content: flex-start;
		}
		.facts div {
			min-width: 0;
		}
		.facts dd {
			font-size: var(--step-0);
		}
		.facts .conv {
			font-size: var(--step--1);
		}
	}

	/* What can be done with it. Phone: Cuisiner across the width, ⋯ beside it. */
	.acts {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1rem;
	}
	.acts :global(form) {
		display: contents;
	}
	@media (max-width: 40rem) {
		.acts {
			flex-wrap: nowrap;
			margin-top: 0.85rem;
		}
		.acts > :global(.btn.primary) {
			flex: 1;
			justify-content: center;
			min-height: 3rem;
			font-size: 1.0625rem;
		}
		.acts :global(.menu > summary) {
			min-width: 3rem;
			min-height: 3rem;
			justify-content: center;
		}
	}
	@media (min-width: 56rem) {
		.acts {
			flex-wrap: nowrap;
			justify-content: flex-end;
			align-self: start;
			margin-top: 0;
		}
		/* With the print at the right: the actions close the left column. */
		.has-photo .acts {
			justify-content: flex-start;
			margin-top: 1.1rem;
		}
	}

	.tags {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0.9rem 0 0;
		padding: 0;
	}
	.tags li {
		font-size: var(--step--1);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 0.05rem 0.5rem;
	}
	.tags a {
		color: var(--ink);
		text-decoration: none;
	}
	.tags a:hover {
		text-decoration: underline;
		text-decoration-color: var(--link-line);
	}
	.tags .season {
		color: var(--ink-soft);
		border-style: dashed;
	}

	/* The photo: a print laid on the card, a paper border and its shadow;
	   tapped, it opens full. Up to 56rem: a small square print beside the
	   title, its top showing (a card's or a page's title is there). */
	.photo {
		margin: 0.15rem 0 0;
		min-width: 0;
		align-self: start;
	}
	.photo > a,
	.heic {
		position: relative;
		display: block;
		padding: 0.3rem;
		background: #fff;
		border: 1px solid var(--edge);
		box-shadow:
			0 1px 2px rgb(60 50 30 / 0.12),
			0 4px 12px rgb(60 50 30 / 0.12);
	}
	.photo > a,
	.photo .heic {
		transform: rotate(1.5deg);
	}
	.photo img {
		display: block;
		width: 5.5rem;
		height: 5.5rem;
		object-fit: cover;
		object-position: top;
	}
	/* The print says it opens: a small mark in its corner. */
	.enlarge {
		position: absolute;
		right: -0.4rem;
		bottom: -0.4rem;
		width: 1.6rem;
		height: 1.6rem;
		padding: 0.3rem;
		border-radius: 50%;
		background: rgb(255 253 247 / 0.92);
		color: var(--ink);
		box-shadow: 0 1px 3px rgb(28 42 66 / 0.25);
	}
	.photo figcaption {
		display: none;
	}
	.heic {
		width: 6.1rem;
		height: 6.1rem;
		display: grid;
		place-items: center;
		padding-inline: 0.4rem;
		font-size: 0.75rem;
		line-height: 1.25;
		text-align: center;
		color: var(--ink-soft);
	}
	.photo.prompt {
		width: auto;
		margin: 1rem 0 0;
	}
	/* Desktop: a print of ~240 px at the head's right, whole (a card across or
	   a book page up), slightly tilted; its caption under it. */
	@media (min-width: 56rem) {
		.photo {
			align-self: start;
			justify-self: end;
			display: flex;
			flex-direction: column;
			align-items: flex-end;
			margin: 0.25rem 0 0;
		}
		.photo > a,
		.heic {
			width: fit-content;
			padding: 0.45rem 0.45rem 1rem;
			transform: rotate(1.2deg);
			transition: transform 0.15s ease;
		}
		.photo > a:hover {
			transform: rotate(0deg) scale(1.015);
		}
		.photo img {
			width: auto;
			height: auto;
			max-width: 14.5rem;
			max-height: 16rem;
			object-fit: contain;
		}
		.enlarge {
			display: none;
		}
		.photo figcaption {
			display: block;
			margin-top: 0.7rem;
			font-size: var(--step--1);
			font-weight: 600;
		}
		.photo figcaption a {
			display: inline-block;
			padding-block: 0.3rem;
		}
		.heic {
			width: 14.5rem;
			height: 11rem;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.photo > a {
			transition: none;
		}
	}
	.viewer {
		max-width: min(64rem, calc(100vw - 2rem));
		max-height: calc(100vh - 2rem);
		padding: 0.6rem;
		border: 0;
		background: #fff;
		box-shadow: 0 12px 48px rgb(0 0 0 / 0.35);
	}
	.viewer::backdrop {
		background: rgb(28 42 66 / 0.7);
	}
	.viewer img {
		display: block;
		max-width: 100%;
		max-height: calc(100vh - 7rem);
		margin: 0 auto;
	}
	.viewer form {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.5rem;
	}

	.columns {
		display: grid;
		gap: 1.75rem;
		margin-top: 1.5rem;
	}
	@media (max-width: 40rem) {
		.columns {
			margin-top: 1.25rem;
		}
	}
	@media (min-width: 56rem) {
		.columns {
			grid-template-columns: minmax(18rem, 5fr) 7fr;
			gap: 2.5rem;
		}
	}
	h2 {
		font-size: var(--step-2);
	}
	.ing-head {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding-bottom: 0.5rem;
		border-bottom: 2px solid var(--rule-red);
	}
	/* One column, a long list: « Ingrédients | Préparation » sticks to the top
	   of the screen while the sheet is read (usability round 4); the part in
	   sight in ink with a rule under it, the other in the soft ink. On the
	   card, across its width, a thumb's height; the page under it scrolls by. */
	.jumpbar {
		position: sticky;
		top: 0;
		z-index: 6;
		display: flex;
		margin: -0.5rem -1rem -1.25rem;
		padding-inline: 0.5rem;
		background: var(--card);
		border-bottom: 1px solid var(--line);
		font-family: var(--sans);
	}
	@media (min-width: 48rem) {
		.jumpbar {
			margin-inline: -2.25rem;
			padding-inline: 1.75rem;
		}
	}
	.jumpbar a {
		flex: 1 1 0;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 2.75rem;
		font-size: var(--step--1);
		font-weight: 600;
		color: var(--ink-soft);
		text-decoration: none;
		box-shadow: inset 0 -2px 0 transparent;
	}
	.jumpbar a[aria-current] {
		color: var(--ink);
		box-shadow: inset 0 -2px 0 var(--ink);
	}
	.jumpbar a:hover {
		color: var(--ink);
	}
	.jumpbar a:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: -2px;
	}
	/* What a jump or a focus scrolls to stays clear of the bar. */
	@media (max-width: 55.99rem) {
		:global(html:has(.jumpbar)) {
			scroll-padding-top: 2.75rem;
		}
	}
	#preparation,
	.ingredients :global(#ingredients-title) {
		scroll-margin-top: 1rem;
	}
	@media (min-width: 56rem) {
		.jumpbar {
			display: none;
		}
	}

	/* The scaler: whether by servings (− 8 portions +) or by a factor
	   (× ½ × 1 × 2), the same pill, the same 44 px targets. */
	.scaler {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		border: 1.5px solid var(--edge);
		border-radius: 999px;
		background: var(--card);
		padding: 2px;
		font-family: var(--sans);
	}
	.pill button {
		min-width: 2.75rem;
		min-height: 2.75rem;
		padding: 0 0.6rem;
		border: 0;
		border-radius: 999px;
		background: none;
		color: var(--ink-soft);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
	}
	.pill button:hover:not(:disabled) {
		color: var(--ink);
		background: var(--hover);
	}
	.times button[aria-pressed='true'] {
		background: var(--ink);
		color: #fff;
	}
	.stepper .step {
		padding: 0;
		font-size: 1.375rem;
		line-height: 1;
		color: var(--ink);
	}
	.stepper .step:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
	.stepper output {
		display: inline-block;
		min-width: 6rem;
		text-align: center;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	/* The count: tapped, it asks for one; dotted like every amount that does something. */
	.stepper .count {
		padding: 0;
		color: var(--ink);
	}
	.stepper .count output {
		text-decoration: underline dotted var(--ink-soft);
		text-decoration-thickness: 1.5px;
		text-underline-offset: 0.3em;
	}
	.stepper .count[aria-expanded='true'] {
		background: var(--hover);
	}
	.scaler .unit {
		font-weight: 400;
		color: var(--ink-soft);
	}
	.scaler :global(.btn.quiet) {
		min-height: 2.75rem;
	}
	.other .short {
		display: none;
	}
	/* Phone: the heading and the scaler on one line when they fit (a servings
	   stepper does), else the scaler on its own line, « … » its last chip. */
	@media (max-width: 40rem) {
		.ing-head {
			gap: 0.5rem 0.4rem;
		}
		.stepper output {
			min-width: 4.75rem;
		}
		.pill button:not(.step) {
			padding-inline: 0.4rem;
		}
		.scaler {
			gap: 0.3rem;
		}
		.other {
			padding-inline: 0.6rem;
			justify-content: center;
			border: 1.5px solid var(--edge);
			border-radius: 999px;
			background: var(--card);
		}
		.other .long {
			display: none;
		}
		.other .short {
			display: inline;
		}
		.other[aria-expanded='true'] {
			border-color: var(--ink);
		}
	}
	/* « Recette × 2 · donne 4 tourtières · Remettre »: under the controls, on a
	   line of its own whose height is always there (min-height), so the list
	   never moves; at × 1 it holds the tap hint, or nothing. */
	.scale-status {
		flex-basis: 100%;
		display: flex;
		align-items: center;
		min-height: 1.4em;
		font-size: var(--step--1);
		line-height: 1.4;
	}
	.scale-status .what {
		margin: 0;
		min-width: 0;
		color: var(--ink-soft);
	}
	/* Inline-block, so its first letter can be a capital at the start of the line. */
	.scaled {
		display: inline-block;
		font-weight: 700;
		color: var(--ink);
	}
	.scaled::first-letter {
		text-transform: uppercase;
	}
	.scale-status .sep {
		color: var(--pencil);
	}
	.result strong {
		color: var(--ink);
	}

	/* « Astuce : touchez une quantité… ✕ »: the scale line's place at × 1, muted. */
	.tap-hint {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin: 0;
		color: var(--ink-soft);
	}
	/* The ✕: a thumb's target that does not make the line taller (it overlaps the space around it). */
	.tap-hint .hint-x {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.75rem;
		height: 2.75rem;
		margin-block: -0.75rem;
		padding: 0;
		border: 0;
		background: none;
		color: var(--ink-soft);
		font-size: 0.9rem;
		cursor: pointer;
	}
	.tap-hint .hint-x:hover {
		color: var(--ink);
	}
	.ticks button,
	.scale-status .reset {
		padding: 0.7rem 0.35rem;
		margin: -0.7rem -0.35rem;
		border: 0;
		background: none;
		color: var(--link);
		font-weight: 600;
		text-decoration: underline;
		text-decoration-color: var(--link-line);
		text-underline-offset: 0.18em;
		cursor: pointer;
	}
	.ticks button:hover,
	.scale-status .reset:hover {
		color: var(--link-hover);
		text-decoration-color: currentColor;
	}

	.ask {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.5rem;
		margin: 0.4rem 0 0.2rem;
		padding: 0.5rem 0.6rem;
		background: var(--paper, #f7f5ef);
		border-left: 3px solid var(--edge);
		font-size: var(--step--1);
	}
	.ask input {
		font: inherit;
		font-size: var(--step-0);
		width: 5rem;
		padding: 0.3rem 0.4rem;
		margin-left: 0.25rem;
	}
	.ask .err {
		flex-basis: 100%;
		margin: 0;
		color: var(--danger);
	}
	.group h3 {
		font-family: var(--sans);
		font-size: var(--step-0);
		margin: 1rem 0 0;
		color: var(--ink);
	}
	.group.optional h3 .opt {
		font-weight: 400;
		color: var(--ink-soft);
	}
	.group.optional ul {
		color: var(--ink-soft);
	}
	/* The faint blue ruled lines of the card. */
	.group ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	/* A line is one tick target, a thumb's height at least; what it leads to
	   (a sub-recipe, the ingredient's page) sits after its text. */
	.group li {
		position: relative;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		column-gap: 0.4rem;
		min-height: 2.75rem;
		padding: 0.55rem 0 0.45rem;
		border-bottom: 1px solid var(--rule-blue);
		font-size: 1.0625rem;
		line-height: 1.4;
	}
	.group li .line {
		flex: 1 1 0;
		min-width: 0;
	}
	.group li > .ask {
		flex-basis: 100%;
	}
	.go {
		flex: none;
		align-self: stretch;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 2.75rem;
		margin-block: -0.55rem -0.45rem;
		padding-inline: 0.35rem;
		font-family: var(--sans);
		font-size: var(--step--1);
		color: var(--ink-soft);
		text-decoration: none;
		white-space: nowrap;
	}
	.go[data-mark]::before {
		content: attr(data-mark);
	}
	.go.recipe::before {
		content: attr(data-mark) '\00a0›';
	}
	.go.item {
		margin-right: -0.5rem;
		font-size: 1.375rem;
		line-height: 1;
		color: var(--pencil);
	}
	.go.recipe {
		font-weight: 600;
		color: var(--link);
	}
	.go:hover,
	li:hover .go.item,
	.go:focus-visible {
		color: var(--link-hover);
	}
	/* With a mouse, the › shows when the line is pointed at, as the linked name did; a finger sees it always. */
	@media (hover: hover) and (pointer: fine) {
		.go.item {
			opacity: 0;
		}
		li:hover .go.item,
		.go.item:focus-visible {
			opacity: 1;
		}
	}
	.go.recipe:hover,
	.go.unlinked:hover {
		text-decoration: underline;
		text-decoration-color: var(--link-line);
	}
	/* Ticked off while gathering: a small box drawn at the row's start; the
	   checkbox itself is the whole band at the row's start (its full height,
	   48 px across, into the sheet's margin), so a finger finds it; a tap on
	   the row's words does the same. Ticked, the line is struck through. */
	.group li:has(.tickbox) {
		padding-left: 2.2rem;
	}
	.tickbox {
		position: absolute;
		top: 0;
		bottom: 0;
		left: -0.85rem;
		width: 2.9rem;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 0.78rem;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}
	.tick {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}
	.box {
		width: 1.2rem;
		height: 1.2rem;
		border: 1.5px solid #b9b2a2;
		border-radius: 3px;
		background: var(--card) center / 80% no-repeat;
		pointer-events: none;
	}
	.tickbox:hover .box {
		border-color: var(--ink-soft);
	}
	.tick:checked + .box {
		border-color: var(--ink-soft);
		background-color: var(--ink-soft);
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6.2l2.3 2.3 4.7-5' fill='none' stroke='white' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
	}
	/* A finger, or a phone's width: the box a fingertip's aim, centred on the line. */
	@media (pointer: coarse), (max-width: 40rem) {
		.tickbox {
			align-items: center;
			padding-top: 0;
		}
		.box {
			width: 1.4rem;
			height: 1.4rem;
		}
	}
	.tick:focus-visible + .box {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	.group li.done .line,
	.group li.done .line :global(.tap) {
		color: var(--ink-soft);
		text-decoration: line-through;
		text-decoration-color: rgb(28 42 66 / 0.55);
		text-decoration-thickness: 1.5px;
	}
	.group li.done .line :global(.approx) {
		color: var(--ink-soft);
	}
	/* Under the list at another amount: what ≈ means, what the steps keep. */
	.foot {
		margin: 0.6rem 0 0;
		font-size: var(--step--1);
		line-height: 1.45;
		color: var(--ink-soft);
	}
	.ticks {
		display: flex;
		justify-content: flex-end;
		align-items: baseline;
		margin: 0.6rem 0 0;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.ticks .sep {
		color: var(--pencil);
	}
	/* An amount scales when tapped: its dotted underline in the ink says it
	   can be (IngredientLine; round 2 of the usability pass: bold text alone
	   read as text), the hint says what it does, once. */
	.ingredients :global(.tap) {
		border-radius: 3px;
		padding-inline: 0.15rem;
		margin-inline: -0.15rem;
	}
	.ingredients :global(.tap:hover) {
		background: var(--hover);
		box-shadow: inset 0 -2px 0 var(--edge);
	}
	.ingredients :global(.tap:active) {
		background: #e9e1cf;
	}

	.method {
		position: relative;
		font-family: var(--serif);
		font-size: var(--step-1);
		line-height: 1.6;
		max-width: var(--measure);
	}
	.method :global(h2) {
		font-size: var(--step-2);
		margin: 0 0 0.5rem;
		padding-bottom: 0.5rem;
		border-bottom: 2px solid var(--rule-red);
	}
	.method :global(h2 ~ h2) {
		margin-top: 1.75rem;
	}
	/* Variantes: the same voice as the steps (serif, full size, full ink),
	   under a small label like the Notes', a hairline above it: not the card's
	   red rule, which heads Préparation. */
	.method :global(h2.quiet) {
		margin: 1.75rem 0 0.25rem;
		padding: 0.9rem 0 0;
		border: 0;
		border-top: 1px solid var(--line);
		font-family: var(--sans);
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--ink-soft);
	}
	.method :global(h2.quiet + ul),
	.method :global(h2.quiet + ol) {
		padding-left: 1.6rem;
		margin: 0.25rem 0 0.5rem;
	}
	.method :global(h2.quiet + ul > li),
	.method :global(h2.quiet + ol > li) {
		padding-left: 0.3rem;
		margin-bottom: 0.4rem;
	}
	/* The note de famille: the card's margin note, promoted. A tinted slip, a
	   pen rule (not the red, which means the sheet), the text full size and
	   full ink, signed when the recipe is a person's. */
	.method :global(.family-note) {
		margin: 1.75rem 0 0;
		padding: 0.85rem 1.1rem 0.95rem 1.15rem;
		background: #f5efe2;
		border-left: 3px solid rgb(28 42 66 / 0.55);
		border-radius: 0 var(--radius) var(--radius) 0;
		color: var(--ink);
	}
	.method :global(.family-note > h2) {
		margin: 0 0 0.3rem;
		padding: 0;
		border: 0;
		font-family: var(--sans);
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--ink-soft);
	}
	.method :global(.note-text) {
		font-size: 1.125rem;
		font-style: italic;
		line-height: 1.55;
	}
	.method :global(.note-text > :first-child) {
		margin-top: 0;
	}
	.method :global(.note-text > :last-child) {
		margin-bottom: 0;
	}
	.method :global(.note-by) {
		margin: 0.4rem 0 0;
		font-size: var(--step-0);
		color: var(--ink-soft);
	}
	.method :global(h3) {
		font-size: var(--step-1);
		margin: 1.25rem 0 0.25rem;
	}

	/* « • Puces | 1. Numéros »: both choices in sight on the method's first
	   head, the one in use pressed in ink (the scaler's pill, smaller).
	   Bullets by default (issue #5); kept per device. */
	.step-style {
		display: flex;
		justify-content: flex-end;
		margin-bottom: 0.5rem;
		font-family: var(--sans);
		font-size: var(--step--1);
	}
	.step-style.on-head {
		position: absolute;
		top: -0.1rem;
		right: 0;
		margin: 0;
	}
	.method:has(.step-style.on-head) > :global(h2:first-of-type) {
		padding-right: 12rem;
	}
	.step-style button {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		min-height: 2.25rem;
		padding: 0 0.65rem;
		border: 1.5px solid var(--edge);
		background: var(--card);
		color: var(--ink-soft);
		font-weight: 600;
		cursor: pointer;
	}
	.step-style button:first-child {
		border-radius: 999px 0 0 999px;
		border-right-width: 0;
	}
	.step-style button:last-child {
		border-radius: 0 999px 999px 0;
	}
	.step-style button:hover:not([aria-pressed='true']) {
		color: var(--ink);
		background: var(--hover);
	}
	.step-style button[aria-pressed='true'] {
		border-color: var(--ink);
		background: var(--ink);
		color: #fff;
	}
	.step-style .glyph {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	/* A finger: a 44 px target, the head as tall so the control sits above its rule. */
	@media (pointer: coarse) {
		.step-style button {
			min-height: 2.75rem;
		}
		.step-style.on-head {
			top: -0.35rem;
		}
		.method:has(.step-style.on-head) > :global(h2:first-of-type) {
			padding-block: 0.65rem;
		}
	}
	.method :global(ol),
	.method :global(ul.steps) {
		padding-left: 1.6rem;
		margin: 0.5rem 0;
	}
	.method :global(ol li),
	.method :global(ul.steps > li) {
		padding-left: 0.3rem;
		margin-bottom: 0.6rem;
	}
	/* Bullets (the default): one step, one paragraph of air, a firm ink dot
	   on its first line, so the eye finds the next step from the counter.
	   Numbers in ink too: red is the sheet's, not every line's. */
	.method :global(ul.steps) {
		list-style: none;
	}
	.method :global(ul.steps > li) {
		position: relative;
		margin-bottom: 1rem;
	}
	.method :global(ul.steps > li::before) {
		content: '';
		position: absolute;
		left: -1.05rem;
		top: 0.62em;
		width: 0.42rem;
		height: 0.42rem;
		border-radius: 50%;
		background: var(--ink);
	}
	.method :global(ol.steps > li) {
		margin-bottom: 1rem;
	}
	.method :global(ol li::marker) {
		font-family: var(--sans);
		font-weight: 700;
		color: var(--ink);
	}
	.method :global(p) {
		margin: 0.5rem 0;
	}
	/* Q6 B: the scaled value after an amount in a step; the card's text stays before it. */
	.method :global(.step-scaled) {
		font-family: var(--sans);
		font-weight: 700;
		color: var(--ink);
		background: var(--hover);
		border-radius: 2px;
		padding-inline: 0.15em;
		white-space: nowrap;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.5rem;
		margin-top: 1.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--line);
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	@media print {
		.recipe {
			border: 0;
			box-shadow: none;
			padding: 0;
		}
		h1 {
			font-size: 20pt;
		}
		.recipe {
			display: block;
		}
		.photo,
		.status,
		.step-style {
			display: none;
		}
		.columns {
			grid-template-columns: 2fr 3fr;
			gap: 1.5rem;
			break-inside: avoid;
		}
		.method {
			font-size: 11pt;
		}
		.scale-status {
			display: block;
		}
		.group li {
			padding: 0.15rem 0;
		}
		.group li:has(.tickbox) {
			padding-left: 0;
		}
		.group li.done .line,
		.group li.done .line :global(.tap) {
			color: inherit;
			text-decoration: none;
		}
	}
</style>
