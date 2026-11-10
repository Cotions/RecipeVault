<script lang="ts">
	// Possible duplicates (plan 05, Phase 7): one card per set of recipes
	// linked by pairs, the new ones first, then the closest, 10 a page (5 on a
	// phone, then « Voir les suivantes »); three decisions per card. A decided
	// card folds into a one-line receipt where it stood (« ✓ Fèves au lard : 2
	// variantes · Annuler », its one undo; no toast), and
	// focus moves to the next card: the rest of the same card when the decision
	// took in only some of its recipes (it comes back as a new card, nothing
	// open), else the one after the receipt. The head's count drops the moment
	// a card folds away, and says how many were done since she came in this tab
	// (« 3 sur 22 faits »); its « 1 nouveau » is a link to the first new card.
	// The keyboard: J / K next / previous card, 1 2 3 open its three choices,
	// Échap closes them, said behind « Raccourcis » (usability round 4;
	// docs/DATA-FLOW.md, "/doublons"). The cards little alike can all be set
	// aside at once (« Toutes différentes », duplicates.ts LOW_CLOSE), after
	// the cards.
	import { applyAction, enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { tick } from 'svelte';
	import { toast } from '$lib/toast.svelte';
	import { post, type Settled } from '$lib/settle.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { GroupView } from '$lib/server/duplicates';
	import PageHead from '$lib/components/PageHead.svelte';
	import { t } from '$lib/i18n';
	import GroupCard from './GroupCard.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const s = t.duplicates;
	const pageHref = (p: number) => (p === 1 ? '/doublons' : `/doublons?page=${p}`);
	/** On a phone the page shows 5 cards at first. */
	const PHONE_FIRST = 5;
	let allShown = $state(false);
	let mounted = $state(false);
	$effect(() => {
		mounted = true;
	});

	/** What a decision's action answers (+page.server.ts run). */
	type Decided = Settled & { card: string; receipt?: string; next?: string | null; rest?: number };
	/**
	 * A decided card, folded into one line where it stood: after the card
	 * `after` (null: at the top); right above `next` when part of its recipes
	 * still make a card (the line and what is left of the card together).
	 */
	type Receipt = { id: number; key: string; after: string | null; next: string | null; text: string; rest: number; undo?: Record<string, string | string[]> };
	let receipts = $state<Receipt[]>([]);
	/** A decision's sentence, for a screen reader (the receipt shows it; no toast). */
	let announce = $state('');
	let seq = 0;
	/** The cards folded away, waiting for the server. */
	let gone = $state(new Set<string>());
	/** A card back after a decision about some of its recipes is a new card: nothing open, the closest two ticked. */
	let epoch = $state<Record<string, number>>({});
	/** True while the list takes no click (a card just folded away: the next click lands where she sees it). */
	let busy = $state(false);
	let hold: ReturnType<typeof setTimeout> | undefined;
	const holdClicks = () => {
		busy = true;
		clearTimeout(hold);
		hold = setTimeout(() => (busy = false), 350);
	};
	const back = (keys: string[]) => (gone = new Set([...gone].filter((k) => !keys.includes(k))));
	const dropReceipt = (id: number) => (receipts = receipts.filter((r) => r.id !== id));
	// Another page of cards: the receipts were this one's.
	let shownPage = 0;
	$effect.pre(() => {
		if (data.page !== shownPage) receipts = [];
		shownPage = data.page;
	});

	/** The new cards as the page first showed them this visit: the tag stays while she works, though the device's mark moved on. */
	let freshSeen = $state(new Set<string>());
	$effect.pre(() => {
		const keys = data.groups.filter((g) => g.fresh).map((g) => g.key);
		if (keys.some((k) => !freshSeen.has(k))) freshSeen = new Set([...freshSeen, ...keys]);
	});
	const isFresh = (g: GroupView) => g.fresh || freshSeen.has(g.key);
	const firstFresh = $derived(data.groups.find((g) => isFresh(g) && !gone.has(g.key)));
	/** The head's « N nouveaux »: every new card (all pages) while the device's mark has not moved, else those this visit showed. */
	const freshLeft = $derived(Math.max(data.fresh - data.groups.filter((g) => g.fresh && gone.has(g.key)).length, data.groups.filter((g) => isFresh(g) && !gone.has(g.key)).length));

	const left = $derived(Math.max(0, data.total - [...gone].filter((k) => data.groups.some((g) => g.key === k) || data.low.some((l) => l.key === k)).length));
	// « N sur M faits »: the most cards seen waiting in this tab, against what is left (sessionStorage, a convenience only).
	const START = 'rv-doublons-start';
	let start = $state(0);
	$effect(() => {
		let n = 0;
		try {
			n = Number(sessionStorage.getItem(START)) || 0;
		} catch {
			/* private window: no progress line */
		}
		if (left > n) n = left;
		start = n;
		try {
			sessionStorage.setItem(START, String(n));
		} catch {
			/* ignore */
		}
	});
	const done = $derived(Math.max(0, start - left));

	/** The cards and the receipts, each receipt after the card it followed. */
	const rows = $derived.by(() => {
		const out: ({ kind: 'r'; r: Receipt } | { kind: 'g'; g: GroupView; i: number })[] = [];
		const used = new Set<number>();
		const shown = new Set(data.groups.map((g) => g.key));
		const emit = (anchor: string | null) => {
			for (const r of receipts)
				if (!used.has(r.id) && r.after === anchor && !(r.next && shown.has(r.next))) {
					used.add(r.id);
					out.push({ kind: 'r', r });
					emit(r.key);
				}
		};
		emit(null);
		data.groups.forEach((g, i) => {
			for (const r of receipts)
				if (!used.has(r.id) && r.next === g.key) {
					used.add(r.id);
					out.push({ kind: 'r', r });
				}
			out.push({ kind: 'g', g, i });
			emit(g.key);
		});
		// A receipt whose card went with the next data: at the top.
		const lost = receipts.filter((r) => !used.has(r.id)).map((r): { kind: 'r'; r: Receipt } => ({ kind: 'r', r }));
		return [...lost, ...out];
	});

	const cardEl = (key: string) => document.querySelector<HTMLElement>(`ul.cards > li.card[data-group="${CSS.escape(key)}"]`);
	/** The cards she can land on, in order: shown, not folded. */
	const cardEls = () => [...document.querySelectorAll<HTMLElement>('ul.cards > li.card:not(.gone)')].filter((el) => el.offsetParent !== null);
	const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	/** Focus `el`, scrolled into view (`from`: a line above it to show too, its receipt). */
	function land(el: HTMLElement | null | undefined, from?: HTMLElement | null) {
		if (!el) return;
		el.focus({ preventScroll: true });
		const behavior = reduced() ? 'auto' : 'smooth';
		const [a, b] = [from?.getBoundingClientRect(), el.getBoundingClientRect()];
		// Both in view already: no jump. Else the receipt at the top, the card under it; or the card alone.
		if (a && a.top >= 0 && b.top < innerHeight - 80) return;
		if (a) from!.scrollIntoView({ block: 'start', behavior });
		else el.scrollIntoView({ block: 'nearest', behavior });
	}
	/** After a decision: the rest of its card (its receipt right above), else the first card after its receipt, else the receipt. */
	async function landAfter(r: Receipt) {
		await tick();
		const receipt = document.getElementById(`receipt-${r.id}`);
		if (r.next && cardEl(r.next)) {
			return land(cardEl(r.next), receipt);
		}
		let el = receipt?.nextElementSibling as HTMLElement | null;
		while (el && !(el.matches('li.card:not(.gone)') && el.offsetParent !== null)) el = el.nextElementSibling as HTMLElement | null;
		land(el ?? receipt);
	}

	/** One decision's `use:enhance` for card `key` (`after`: where its receipt goes, by default after the card before it). */
	function decide(key: string, keys: string[] = [key], after?: string | null): SubmitFunction {
		return () => {
			const i = data.groups.findIndex((g) => g.key === key);
			const anchor = after !== undefined ? after : i > 0 ? data.groups[i - 1].key : null;
			gone = new Set([...gone, ...keys]);
			holdClicks();
			return async ({ result }) => {
				const d = (result.type === 'success' || result.type === 'failure' ? result.data : undefined) as Partial<Decided> | undefined;
				if (result.type === 'success' && d?.ok) {
					const r: Receipt = { id: ++seq, key, after: anchor, next: d.next ?? null, text: d.receipt ?? d.message ?? '', rest: d.rest ?? 0, undo: d.undo };
					receipts = [...receipts, r];
					// One undo per decision: the receipt's « Annuler ». Said aloud, with what is left.
					announce = d.message ?? r.text;
					await invalidateAll();
					epoch = { ...epoch, [key]: (epoch[key] ?? 0) + 1 };
					back(keys);
					await landAfter(r);
				} else {
					back(keys);
					if (d?.message) toast.show({ text: d.message, error: true });
					else await applyAction(result);
				}
			};
		};
	}
	/** « Toutes différentes »: the cards little alike on this page, folded at once; their receipt at the top. */
	const lowForm = $derived(
		decide(
			'low',
			data.low.map((l) => l.key),
			null
		)
	);

	/** « Annuler » on a receipt: as the toast's. */
	async function undoReceipt(r: Receipt) {
		if (!r.undo) return;
		const res = await post('?/undo', r.undo);
		const message = res.type === 'success' || res.type === 'failure' ? (res.data as Partial<Settled> | undefined)?.message : undefined;
		if (res.type === 'success') {
			dropReceipt(r.id);
			await invalidateAll();
			toast.show({ text: message ?? t.app.undone }, 4000);
		} else toast.show({ text: message ?? t.app.undoFailed, error: true });
	}

	// The keyboard path: J / K, 1 2 3, Échap. Never while typing in a field, never with a modifier.
	let current: HTMLElement | null = null;
	function onkeydown(e: KeyboardEvent) {
		if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
		const target = e.target as HTMLElement | null;
		const typing = !!target?.closest('textarea, select, [contenteditable], input:not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"])');
		const inCard = target?.closest<HTMLElement>('ul.cards > li.card');
		const card = inCard ?? (current && current.isConnected && !current.classList.contains('gone') ? current : null);
		if (e.key === 'Escape') {
			const open = card?.querySelector<HTMLDetailsElement>('.actions details[open]');
			if (!open || !card) return;
			open.open = false;
			e.preventDefault();
			land(card);
			return;
		}
		if (typing) return;
		const k = e.key.toLowerCase();
		if (k === 'j' || k === 'k') {
			const list = cardEls();
			if (!list.length) return;
			e.preventDefault();
			const i = card ? list.indexOf(card) : -1;
			// No card yet: the first one in view (J) or the one before it (K).
			const from = i >= 0 ? i : list.findIndex((el) => el.getBoundingClientRect().bottom > 0);
			const to = i < 0 ? Math.max(0, from) : k === 'j' ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1);
			current = list[to];
			land(current);
		} else if (card && ['1', '2', '3'].includes(e.key)) {
			const d = card.querySelectorAll<HTMLDetailsElement>('.actions > details')[Number(e.key) - 1];
			if (!d) return;
			e.preventDefault();
			current = card;
			d.open = true;
			const first = d.querySelector<HTMLElement>('form input:not([type="hidden"]):not(:disabled), form select, form button:not(:disabled)');
			(first ?? d.querySelector<HTMLElement>('summary'))?.focus();
		}
	}
</script>

<svelte:window {onkeydown} />

<p class="visually-hidden" role="status">{announce}</p>

<svelte:head><title>{s.title} — {t.app.name}</title></svelte:head>

<PageHead title={s.title} intro={s.intro} meta={data.groups.length || done ? headLine : undefined} />

{#snippet headLine()}
	{s.head(left, data.veryClose, 0, done)}{#if freshLeft && firstFresh}{' · '}<a
			class="fresh-link"
			href="#card-{firstFresh.key.replace(/ /g, '--')}"
			data-testid="fresh-link"
			onclick={(e) => {
				e.preventDefault();
				land(cardEl(firstFresh.key));
			}}>{s.freshCount(freshLeft)}</a
		>{/if}
{/snippet}

<!-- Without JavaScript the decision comes back with the page; with it, in the receipt and the toast. -->
{#if form?.message}
	<p class="flash" class:error={!form.ok} role="status" data-testid="flash">{form.message}</p>
{/if}

{#if !data.groups.length && !receipts.length}
	<p class="empty">{s.empty}</p>
{:else}
	{#if data.groups.length}
		<!-- The keyboard path, behind a small toggle (a wide screen with a keyboard). -->
		<details class="keys" data-testid="keys-hint">
			<summary>{s.keysToggle}</summary>
			<p>{s.keys}</p>
		</details>
	{/if}
	<ul class="cards" class:busy class:all={allShown} class:js={mounted}>
		{#each rows as row (row.kind === 'r' ? `r${row.r.id}` : `g${row.g.key}|${epoch[row.g.key] ?? 0}`)}
			{#if row.kind === 'r'}
				<li class="receipt" id="receipt-{row.r.id}" tabindex="-1" data-testid="receipt">
					<span class="tick-mark" aria-hidden="true">✓</span>
					<span class="visually-hidden">{s.receiptDone}</span>
					<span class="receipt-text">{row.r.text}{#if row.r.rest}<span class="receipt-rest"> · {s.receiptRest(row.r.rest)}</span>{/if}</span>
					{#if row.r.undo}
						{@const r = row.r}
						<button type="button" class="receipt-undo" onclick={() => undoReceipt(r)}>{t.app.undo}</button>
					{/if}
				</li>
			{:else}
				<GroupCard
					g={row.g}
					distinctHash={data.distinctHash}
					labelMax={data.labelMax}
					{decide}
					gone={gone.has(row.g.key)}
					fresh={isFresh(row.g)}
					later={row.i >= PHONE_FIRST}
				/>
			{/if}
		{/each}
	</ul>
	{#if mounted && !allShown && data.groups.length > PHONE_FIRST}
		<button class="btn phone-more" type="button" onclick={() => (allShown = true)}>{s.showRest(data.groups.length - PHONE_FIRST)}</button>
	{/if}
	<!-- The cards little alike, after the close ones: set aside all at once. -->
	{#if data.low.length}
		<details class="low" data-testid="low" class:gone={data.low.every((l) => gone.has(l.key))}>
			<summary><span>{s.low(data.low.length, data.lowPct)}</span> <span class="low-open">{s.lowOpen}</span></summary>
			<form method="POST" action="?/distinctLow" use:enhance={lowForm}>
				<input type="hidden" name="distinct" value={data.distinctHash} />
				<ul class="low-list">
					{#each data.low as l (l.key)}<li><input type="hidden" name="key" value={l.key} />{l.titles.join(' · ')}</li>{/each}
				</ul>
				<p class="help">{s.lowHelp}</p>
				<button class="btn" type="submit">{s.lowSave(data.low.length)}</button>
			</form>
		</details>
	{/if}
	{#if data.pages > 1}
		<nav class="pager" aria-label={s.page(data.page, data.pages)}>
			{#if data.page > 1}<a class="btn" href={pageHref(data.page - 1)}>{s.prev}</a>{/if}
			<span>{s.page(data.page, data.pages)}</span>
			{#if data.page < data.pages}<a class="btn" href={pageHref(data.page + 1)}>{s.next}</a>{/if}
		</nav>
	{/if}
{/if}

<style>
	.empty {
		color: var(--ink-soft);
	}
	.flash {
		padding: 0.6rem 1rem;
		background: var(--ok-bg);
		border-left: 4px solid var(--ok);
		margin: 0 0 1rem;
		max-width: 44rem;
	}
	.flash.error {
		background: var(--danger-bg);
		border-left-color: var(--danger);
	}
	/* « Toutes différentes »: one quiet line after the cards, the button behind it. */
	.low {
		max-width: 64rem;
		margin: 1rem 0;
		padding: 0.25rem 1rem;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: var(--radius);
	}
	.low summary {
		cursor: pointer;
		min-height: 44px;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 0.5rem;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.low-open {
		color: var(--link);
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	.low form {
		display: grid;
		justify-items: start;
		gap: 0.4rem;
		padding: 0 0 0.75rem;
	}
	.low-list {
		margin: 0;
		padding-left: 1.2rem;
		font-family: var(--serif);
	}
	.low .help {
		margin: 0;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.low .btn {
		min-height: 44px;
	}
	.cards {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 1rem;
		max-width: 64rem;
	}
	/* A card just folded away: no click lands on the one sliding into its place. */
	.cards.busy {
		pointer-events: none;
	}
	/* A phone: the first 5 cards, then « Voir les 5 suivantes » (all of them without JavaScript). */
	.phone-more {
		display: none;
		min-height: 44px;
		margin: 1rem 0 0;
	}
	@media (max-width: 40rem) {
		.cards.js:not(.all) > :global(li.later) {
			display: none;
		}
		.phone-more {
			display: inline-flex;
		}
	}
	.low.gone {
		display: none;
	}
	/* A decided card: one line where it stood, « ✓ Fèves au lard : 2 variantes · Annuler ». */
	.receipt {
		min-height: 44px;
		padding: 0.25rem 1rem;
		line-height: 1.4;
		border: 1px dashed var(--line);
		border-radius: var(--radius);
		color: var(--ink-soft);
		font-size: var(--step--1);
	}
	.receipt:focus {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	.tick-mark {
		margin-right: 0.4rem;
		color: var(--ok);
		font-weight: 700;
	}
	.receipt-text {
		color: var(--ink);
	}
	.receipt-rest {
		color: var(--ink-soft);
	}
	.receipt-undo {
		display: inline-flex;
		align-items: center;
		vertical-align: middle;
		min-height: 44px;
		margin-left: 0.4rem;
		padding: 0 0.25rem;
		border: 0;
		background: none;
		color: var(--link);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	.receipt-undo:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	.fresh-link {
		font-weight: 600;
	}
	/* The keyboard path: a small « Raccourcis clavier » toggle, a wide screen with a keyboard only. */
	.keys {
		display: none;
		max-width: 64rem;
		margin: 0 0 0.75rem;
		color: var(--ink-soft);
		font-size: 0.875rem;
	}
	@media (min-width: 56rem) and (hover: hover) and (pointer: fine) {
		.keys {
			display: block;
		}
	}
	.keys summary {
		cursor: pointer;
		width: fit-content;
		padding: 0.25rem 0;
	}
	.keys p {
		margin: 0.25rem 0 0;
	}
	.pager {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin: 1rem 0;
	}
	.pager .btn {
		min-height: 44px;
	}
</style>
