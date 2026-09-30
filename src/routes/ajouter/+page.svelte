<script lang="ts">
	// The paste box: the owner's main tool, built for speed. Paste, see it
	// valid, Ctrl+Enter, next. Live checks run in the browser; the server
	// re-checks with the vault (collisions, sub-recipes, same titles) and is the
	// only judge on save.
	import { onMount, tick, untrack } from 'svelte';
	import templateDoc from '../../../docs/AI-TEMPLATE.md?raw';
	import { t } from '$lib/i18n/fr';
	import RecipeView from '$lib/components/RecipeView.svelte';
	import Marked from '$lib/components/Marked.svelte';
	import DiagnosticItem from '$lib/components/DiagnosticItem.svelte';
	import { checkBatch, checkFile, hasErrors } from '$lib/vault/check';
	import { splitPaste } from '$lib/vault/fences';
	import { aiErrors, renderFixBlock } from '$lib/vault/fixblock';
	import { bodyText } from '$lib/vault/parse';
	import { extractPrompt } from '$lib/vault/prompt';
	import { fileSlug } from '$lib/vault/rules/batch';
	import { parseRecipe } from '$lib/vault/parse';
	import { slugify } from '$lib/vault/slug';
	import { fold } from '$lib/vault/normalize';
	import { stripMarkers } from '$lib/vault/markers';
	import type { Diagnostic } from '$lib/vault/types';
	import type { ServerCheckFile } from '$lib/server/paste';
	import type { SaveResult } from '$lib/server/save';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const PROMPT = extractPrompt(templateDoc);

	let text = $state('');
	let box: HTMLTextAreaElement | undefined = $state();
	let server = $state<{ for: string; files: ServerCheckFile[] } | null>(null);
	let saving = $state(false);
	let toast = $state<{ message: string; links?: { slug: string; title: string }[]; note?: string; error?: boolean } | null>(null);
	let savedTitles = $state<string[]>([]);
	let importUrl = $state('');
	let importing = $state(false);
	/** Files whose replace was refused because the vault recipe changed, by file key. */
	let staleFiles = $state<Set<string>>(new Set());
	/** Bumped to run the server check again on the same text (after a save). */
	let recheck = $state(0);

	interface Choice {
		mode?: 'replace' | 'suffix';
		/** For 'replace': the hash of the vault file the person chose to replace. */
		target?: string;
		family?: boolean;
		familySlug?: string;
		variant?: string;
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
					if (seq === checkSeq) server = { for: key, files: body.files };
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
			const mode = modeOf(choices[key], col);
			// Two new files with one slug (docs/DATA-FLOW.md): the first saves under
			// it, only the later ones wait for a choice. Without the server's
			// answer yet, a local E103 can only be such a clash inside the paste.
			const firstFree = key.endsWith('#0') && !mode && (s ? !!col && !col.existing && !col.inTrash : true);
			let diagnostics = s ? s.diagnostics : local.files[i].diagnostics;
			if (firstFree) diagnostics = diagnostics.filter((d) => d.code !== 'E103');
			const parsed = parseRecipe(f);
			const fm = parsed.frontmatter;
			// A batch error (E103 between two pasted files) withholds the batch's
			// recipe; the file's own is enough here, as every error left still blocks.
			const recipe = local.files[i].recipe ?? checkFile(f).recipe;
			const title = recipe?.title ?? (typeof fm?.title === 'string' ? fm.title : t.add.recipeN(i + 1));
			// E103 is settled by a choice here, not by the AI.
			const blocking = diagnostics.filter((d) => d.severity === 'error' && !(d.code === 'E103' && mode));
			return {
				index: i,
				key,
				text: f,
				title,
				diagnostics,
				ok: blocking.length === 0 && !!recipe,
				recipe,
				server: s,
				mode,
				firstFree,
				parsed
			};
		})
	);

	const needAi = $derived(views.filter((v) => aiErrors(v.diagnostics).length > 0));
	const canSave = $derived(views.length > 0 && views.some((v) => v.ok) && !saving);

	// --- actions ----------------------------------------------------------------

	async function copy(textToCopy: string) {
		await navigator.clipboard.writeText(textToCopy);
	}

	function flash(message: string, extra: Partial<NonNullable<typeof toast>> = {}) {
		toast = { message, ...extra };
		setTimeout(() => (toast = null), extra.links ? 8000 : 4000);
	}

	async function copyPrompt() {
		await copy(PROMPT);
		flash(t.add.promptCopied);
	}

	async function copyFixBlock() {
		const failed = needAi.map((v) => ({ text: v.text, diagnostics: v.diagnostics }));
		const passed = [...savedTitles, ...views.filter((v) => !needAi.includes(v)).map((v) => v.title)];
		await copy(renderFixBlock(failed, passed, { spec: PROMPT }));
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
	function keepOnly(indices: number[], stale: Set<string>) {
		const left = indices.map((i) => files[i]);
		const oldKeys = indices.map((i) => keys[i]);
		const newKeys = keysOf(left);
		text = left.length === 0 ? '' : left.length === 1 && !split.files.length ? left[0] : left.map((f) => '```markdown\n' + f.trimEnd() + '\n```').join('\n\n') + '\n';
		const next: typeof choices = {};
		const nextStale = new Set<string>();
		oldKeys.forEach((old, i) => {
			if (choices[old]) next[newKeys[i]] = choices[old];
			if (stale.has(old)) nextStale.add(newKeys[i]);
		});
		choices = next;
		staleFiles = nextStale;
	}

	async function saveAll() {
		if (!canSave) return;
		saving = true;
		const sending = views.filter((v) => v.ok);
		const payload = sending.map((v) => {
			const c = choices[v.key] ?? {};
			const f: { text: string; slug?: string; overwrite?: string; family?: { family: string; variant: string } } = { text: v.text };
			const col = v.server?.collision;
			if (v.mode === 'replace' && col?.existing) f.overwrite = col.existing.hash;
			if (v.mode === 'suffix' && col) f.slug = col.suggested;
			if (c.family && c.familySlug && slugify(c.familySlug) && c.variant?.trim()) f.family = { family: slugify(c.familySlug), variant: c.variant.trim() };
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
			const stale = new Set<string>();
			result.files.forEach((r, k) => {
				if (r.status === 'stale') stale.add(sending[k].key);
			});
			savedTitles = [...savedTitles, ...saved.map((s) => s.title)];
			const savedIdx = new Set(result.files.flatMap((r, k) => (r.status === 'saved' ? [sending[k].index] : [])));
			keepOnly(
				files.map((_, i) => i).filter((i) => !savedIdx.has(i)),
				stale
			);
			const note = refused ? t.add.notSaved(refused) : undefined;
			if (result.indexError) flash(t.add.indexError, { links: saved, note, error: true });
			else if (saved.length) flash(t.add.saved(saved.length), { links: saved, note });
			else if (note) flash(note, { error: true });
			// The server judged again: check again, so a collision or an error it
			// found shows here with its choice.
			recheck++;
			await tick();
			box?.focus();
		} catch (e) {
			flash(`${t.add.error} ${(e as Error).message}`, { error: true });
		} finally {
			saving = false;
		}
	}

	async function doImport(e: SubmitEvent) {
		e.preventDefault();
		if (!importUrl.trim()) return;
		importing = true;
		try {
			const res = await fetch('/api/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: importUrl }) });
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				flash(body.error ?? body.message ?? res.statusText, { error: true });
				return;
			}
			text = '```markdown\n' + body.markdown + '```\n';
			choices = {};
			staleFiles = new Set();
			importUrl = '';
			flash(t.add.imported);
			await tick();
			box?.focus();
		} finally {
			importing = false;
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			saveAll();
		}
	}

	function setChoice(key: string, patch: Choice) {
		choices = { ...choices, [key]: { ...choices[key], ...patch } };
	}

	const group = (ds: Diagnostic[], sev: string) => ds.filter((d) => d.severity === sev);

	onMount(() => box?.focus());
</script>

<svelte:head><title>{t.add.title}</title></svelte:head>

<div class="head">
	<h1>{t.add.title}</h1>
	<button class="btn" type="button" onclick={copyPrompt}>{t.add.copyPrompt}</button>
</div>

<form class="import" onsubmit={doImport}>
	<label for="import-url">{t.add.importLabel}</label>
	<div class="row">
		<input id="import-url" type="url" placeholder={t.add.importPlaceholder} bind:value={importUrl} />
		<button class="btn" type="submit" disabled={importing || !importUrl.trim()}>{importing ? t.add.importing : t.add.import}</button>
	</div>
</form>

<div class="paste">
	<label for="paste">{t.add.paste}</label>
	<p class="intro" id="paste-help">{t.add.intro}</p>
	<textarea
		id="paste"
		bind:this={box}
		bind:value={text}
		onkeydown={onKey}
		placeholder={t.add.placeholder}
		spellcheck="false"
		aria-describedby="paste-help"
		rows="14"
	></textarea>
	<div class="savebar">
		<button class="btn primary" type="button" onclick={saveAll} disabled={!canSave}>
			{saving ? t.add.saving : t.add.save} <kbd>{t.add.saveHint}</kbd>
		</button>
		{#if needAi.length}
			<button class="btn danger" type="button" onclick={copyFixBlock}>{t.add.fixBlock}</button>
		{/if}
		<span class="found">{views.length ? t.add.files(views.length) : t.add.none}</span>
	</div>
</div>

{#if split.outside && split.files.length}
	<details class="outside">
		<summary>{t.add.outside}</summary>
		<pre>{split.outside}</pre>
	</details>
{/if}

{#each views as v (v.index)}
	{@const col = v.server?.collision}
	{@const sameTitle =
		v.diagnostics.some((d) => d.code === 'W608') ||
		(!!col?.existing && fold(stripMarkers(col.existing.title)) === fold(stripMarkers(v.title)))}
	{@const close = v.mode === 'replace' ? [] : (v.server?.close ?? [])}
	<section class="file" class:bad={!v.ok} aria-label={v.title}>
		<header>
			<h2><Marked text={v.title} /></h2>
			<span class="state" class:okay={v.ok}>{v.ok ? t.add.valid : t.add.invalid}</span>
		</header>

		{#if staleFiles.has(v.key)}
			<p class="warn">{t.add.stale}</p>
		{/if}

		{#if col && !v.firstFree}
			<div class="choice">
				{#if col.inTrash}
					<p>{t.add.collisionTrash(v.server?.slug ?? '')}</p>
				{:else}
					<p>{t.add.collision(v.server?.slug ?? '')}{#if col.existing}{' — '}<a href="/r/{v.server?.slug}" target="_blank"><Marked text={col.existing.title} /></a>{/if}</p>
				{/if}
				<div class="options" role="radiogroup">
					{#if col.existing && !col.inTrash}
						<label
								><input
									type="radio"
									name="choice-{v.index}"
									checked={v.mode === 'replace'}
									onchange={() => setChoice(v.key, { mode: 'replace', target: col.existing?.hash })}
								/> {t.add.replace}</label
							>
					{/if}
					<label
							><input type="radio" name="choice-{v.index}" checked={v.mode === 'suffix'} onchange={() => setChoice(v.key, { mode: 'suffix', target: undefined })} />
							{t.add.saveAs(col.suggested)}</label
						>
				</div>
			</div>
		{/if}

		{#if (sameTitle || close.length) && v.mode !== 'replace'}
			<div class="choice">
				{#if close.length}
					<!-- W505 (plan 05, Phase 6): nearly the same ingredients as a vault recipe. -->
					<p data-testid="close-recipes">
						{t.add.close}
						{#each close as c, i (c.slug)}{i ? ', ' : ' '}<a href="/r/{c.slug}" target="_blank"><Marked text={c.title} /></a>{/each}.
					</p>
				{/if}
				<label class="check">
					<input
						type="checkbox"
						checked={!!choices[v.key]?.family}
						onchange={(e) =>
							setChoice(v.key, {
								family: e.currentTarget.checked,
								familySlug: choices[v.key]?.familySlug ?? ((sameTitle ? undefined : close[0]?.family) || slugify(v.title))
							})}
					/>
					{sameTitle ? t.add.sameTitle : t.add.closeFamily}
				</label>
				{#if choices[v.key]?.family}
					<div class="family-fields">
						<label>{t.add.family} <input type="text" value={choices[v.key]?.familySlug} oninput={(e) => setChoice(v.key, { familySlug: e.currentTarget.value })} /></label>
						<label>{t.add.variant} <input type="text" value={choices[v.key]?.variant ?? ''} oninput={(e) => setChoice(v.key, { variant: e.currentTarget.value })} /></label>
					</div>
				{/if}
			</div>
		{/if}

		{#each [['error', t.add.errors], ['warning', t.add.warnings], ['info', t.add.infos]] as [sev, label] (sev)}
			{@const list = group(v.diagnostics, sev)}
			{#if list.length}
				<details class="diag {sev}" open={sev === 'error'}>
					<summary>{label} ({list.length})</summary>
					<ul>
						{#each list as d, k (k)}
							<DiagnosticItem {d} file={v.parsed} who />
						{/each}
					</ul>
				</details>
			{/if}
		{/each}

		{#if v.recipe && !hasErrors(local.files[v.index].diagnostics)}
			<details class="preview" open={views.length === 1}>
				<summary>{t.add.preview}</summary>
				<RecipeView recipe={v.recipe} body={bodyText(v.text)} titles={v.server?.titles ?? {}} links={false} />
			</details>
		{/if}
	</section>
{/each}

{#if toast}
	<div class="toast" class:error={toast.error} role="status">
		{toast.message}
		{#if toast.links}
			{#each toast.links as l, i (l.slug)}{i ? ', ' : ' '}<a href="/r/{l.slug}"><Marked text={l.title} /></a>{/each}
		{/if}
		{#if toast.note}<br />{toast.note}{/if}
	</div>
{/if}

<style>
	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}
	h1 {
		font-size: var(--step-3);
	}
	.import {
		margin-top: 1rem;
		max-width: 48rem;
	}
	.import label,
	.paste > label {
		display: block;
		font-weight: 700;
		margin-bottom: 0.25rem;
	}
	.row {
		display: flex;
		gap: 0.5rem;
	}
	.row input {
		flex: 1;
		min-width: 0;
	}
	.paste {
		margin-top: 1.25rem;
	}
	.intro {
		margin: 0 0 0.4rem;
		color: var(--ink-soft);
		font-size: var(--step--1);
	}
	textarea {
		display: block;
		width: 100%;
		min-height: 16rem;
		resize: vertical;
		font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
		font-size: 0.9rem;
		line-height: 1.45;
		border-width: 2px;
		border-color: var(--ink);
		border-top: 3px solid var(--rule-red);
	}
	.savebar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
		margin-top: 0.6rem;
		position: sticky;
		bottom: 0;
		background: var(--paper);
		padding: 0.5rem 0;
		z-index: 5;
	}
	.found {
		color: var(--ink-soft);
		margin-left: auto;
	}
	.outside {
		margin-top: 1rem;
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
	.file {
		margin-top: 1.5rem;
		background: var(--card);
		border-top: 3px solid var(--ok);
		padding: 1rem;
	}
	.file.bad {
		border-top-color: var(--rule-red);
	}
	.file header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 1rem;
	}
	.file h2 {
		font-size: var(--step-2);
	}
	.state {
		font-weight: 700;
		color: var(--rule-red);
		white-space: nowrap;
	}
	.state.okay {
		color: var(--ok);
	}
	.warn {
		background: #fbeceb;
		padding: 0.5rem 0.75rem;
		border-left: 4px solid var(--rule-red);
	}
	.choice {
		margin-top: 0.75rem;
		padding: 0.6rem 0.8rem;
		background: #f2f5f9;
		border-left: 4px solid var(--link);
	}
	.choice p {
		margin: 0 0 0.4rem;
	}
	.options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.5rem;
	}
	.options label,
	.check {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		cursor: pointer;
	}
	.family-fields {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		margin-top: 0.5rem;
	}
	.family-fields label {
		display: flex;
		flex-direction: column;
		font-size: var(--step--1);
		font-weight: 600;
	}
	.diag {
		margin-top: 0.75rem;
	}
	.diag summary {
		cursor: pointer;
		font-weight: 700;
	}
	.diag.error summary {
		color: var(--rule-red);
	}
	.diag.info summary {
		color: var(--ink-soft);
	}
	.diag ul {
		list-style: none;
		padding: 0;
		margin: 0.35rem 0 0;
	}
	.preview {
		margin-top: 1rem;
	}
	.preview summary {
		cursor: pointer;
		font-weight: 700;
		color: var(--link);
		margin-bottom: 0.5rem;
	}
	.toast.error {
		background: var(--rule-red);
	}
</style>
