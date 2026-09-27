<script lang="ts">
	// The paste box: the owner's main tool, built for speed. Paste, see it
	// valid, Ctrl+Enter, next. Live checks run in the browser; the server
	// re-checks with the vault (collisions, sub-recipes, same titles) and is the
	// only judge on save.
	import { onMount, tick } from 'svelte';
	import templateDoc from '../../../docs/AI-TEMPLATE.md?raw';
	import { t } from '$lib/i18n/fr';
	import RecipeView from '$lib/components/RecipeView.svelte';
	import Marked from '$lib/components/Marked.svelte';
	import { checkBatch, hasErrors } from '$lib/vault/check';
	import { splitPaste } from '$lib/vault/fences';
	import { aiErrors, renderFixBlock } from '$lib/vault/fixblock';
	import { fixerOf } from '$lib/vault/codes';
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

	const PROMPT = extractPrompt(templateDoc);

	let text = $state('');
	let box: HTMLTextAreaElement | undefined = $state();
	let server = $state<{ for: string; files: ServerCheckFile[] } | null>(null);
	let saving = $state(false);
	let toast = $state<{ message: string; links?: { slug: string; title: string }[]; error?: boolean } | null>(null);
	let savedTitles = $state<string[]>([]);
	let importUrl = $state('');
	let importing = $state(false);
	let staleFiles = $state<Set<number>>(new Set());

	/** Per file (by position): what to do on a collision, and the family offer. */
	let choices = $state<Record<number, { mode?: 'replace' | 'suffix'; family?: boolean; familySlug?: string; variant?: string }>>({});

	// --- live check in the browser --------------------------------------------

	const split = $derived(splitPaste(text));
	const files = $derived(text.trim() ? (split.files.length ? split.files : [text]) : []);
	const local = $derived(checkBatch(files.map((f, i) => ({ name: t.add.recipeN(i + 1), text: f }))));

	let checkTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const current = files;
		const key = current.join('\u0000');
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
				if (res.ok) server = { for: key, files: (await res.json()).files };
			} catch {
				// offline: the browser's own check still shows
			}
		}, 350);
	});

	const serverFresh = $derived(server && server.for === files.join('\u0000') ? server.files : null);

	interface FileView {
		index: number;
		text: string;
		title: string;
		diagnostics: Diagnostic[];
		ok: boolean;
		recipe: (typeof local.files)[number]['recipe'];
		server?: ServerCheckFile;
	}

	const views = $derived<FileView[]>(
		files.map((f, i) => {
			const s = serverFresh?.[i];
			const diagnostics = s ? s.diagnostics : local.files[i].diagnostics;
			const fm = parseRecipe(f).frontmatter;
			const title = local.files[i].recipe?.title ?? (typeof fm?.title === 'string' ? fm.title : t.add.recipeN(i + 1));
			// E103 is settled by a choice here, not by the AI.
			const blocking = diagnostics.filter((d) => d.severity === 'error' && !(d.code === 'E103' && choices[i]?.mode));
			return { index: i, text: f, title, diagnostics, ok: blocking.length === 0 && !!local.files[i].recipe, recipe: local.files[i].recipe, server: s };
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

	/** Rebuild the box from the files left to deal with. */
	function keepOnly(indices: number[]) {
		const left = indices.map((i) => files[i]);
		text = left.length === 0 ? '' : left.length === 1 && !split.files.length ? left[0] : left.map((f) => '```markdown\n' + f.trimEnd() + '\n```').join('\n\n') + '\n';
		const next: typeof choices = {};
		indices.forEach((old, i) => {
			if (choices[old]) next[i] = choices[old];
		});
		choices = next;
	}

	async function saveAll() {
		if (!canSave) return;
		saving = true;
		const sending = views.filter((v) => v.ok);
		const payload = sending.map((v) => {
			const c = choices[v.index] ?? {};
			const f: { text: string; slug?: string; overwrite?: string; family?: { family: string; variant: string } } = { text: v.text };
			const col = v.server?.collision;
			if (c.mode === 'replace' && col?.existing) f.overwrite = col.existing.hash;
			if (c.mode === 'suffix' && col) f.slug = col.suggested;
			if (c.family && c.familySlug && slugify(c.familySlug) && c.variant?.trim()) f.family = { family: slugify(c.familySlug), variant: c.variant.trim() };
			return f;
		});
		try {
			const res = await fetch('/api/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: payload }) });
			if (!res.ok) {
				const msg = (await res.json().catch(() => null))?.message ?? res.statusText;
				flash(`${t.add.error} ${msg}`, { error: true });
				return;
			}
			const result: SaveResult = await res.json();
			const saved = result.files.flatMap((r) => (r.status === 'saved' ? [{ slug: r.slug, title: r.title }] : []));
			const stale = new Set<number>();
			result.files.forEach((r, k) => {
				if (r.status === 'stale') stale.add(sending[k].index);
			});
			staleFiles = stale;
			savedTitles = [...savedTitles, ...saved.map((s) => s.title)];
			const savedIdx = new Set(result.files.flatMap((r, k) => (r.status === 'saved' ? [sending[k].index] : [])));
			keepOnly(files.map((_, i) => i).filter((i) => !savedIdx.has(i)));
			if (saved.length) flash(t.add.saved(saved.length), { links: saved });
			if (result.indexError) flash(t.add.indexError, { links: saved, error: true });
			server = null;
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

	function setChoice(i: number, patch: (typeof choices)[number]) {
		choices = { ...choices, [i]: { ...choices[i], ...patch } };
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
	<section class="file" class:bad={!v.ok} aria-label={v.title}>
		<header>
			<h2><Marked text={v.title} /></h2>
			<span class="state" class:okay={v.ok}>{v.ok ? t.add.valid : t.add.invalid}</span>
		</header>

		{#if staleFiles.has(v.index)}
			<p class="warn">{t.add.stale}</p>
		{/if}

		{#if col}
			<div class="choice">
				{#if col.inTrash}
					<p>{t.add.collisionTrash(v.server?.slug ?? '')}</p>
				{:else}
					<p>{t.add.collision(v.server?.slug ?? '')}{#if col.existing}{' — '}<a href="/r/{v.server?.slug}" target="_blank"><Marked text={col.existing.title} /></a>{/if}</p>
				{/if}
				<div class="options" role="radiogroup">
					{#if col.existing && !col.inTrash}
						<label><input type="radio" name="choice-{v.index}" checked={choices[v.index]?.mode === 'replace'} onchange={() => setChoice(v.index, { mode: 'replace' })} /> {t.add.replace}</label>
					{/if}
					<label><input type="radio" name="choice-{v.index}" checked={choices[v.index]?.mode === 'suffix'} onchange={() => setChoice(v.index, { mode: 'suffix' })} /> {t.add.saveAs(col.suggested)}</label>
				</div>
			</div>
		{/if}

		{#if sameTitle && choices[v.index]?.mode !== 'replace'}
			<div class="choice">
				<label class="check">
					<input
						type="checkbox"
						checked={!!choices[v.index]?.family}
						onchange={(e) => setChoice(v.index, { family: e.currentTarget.checked, familySlug: choices[v.index]?.familySlug ?? slugify(v.title) })}
					/>
					{t.add.sameTitle}
				</label>
				{#if choices[v.index]?.family}
					<div class="family-fields">
						<label>{t.add.family} <input type="text" value={choices[v.index]?.familySlug} oninput={(e) => setChoice(v.index, { familySlug: e.currentTarget.value })} /></label>
						<label>{t.add.variant} <input type="text" value={choices[v.index]?.variant ?? ''} oninput={(e) => setChoice(v.index, { variant: e.currentTarget.value })} /></label>
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
							<li>
								<code class="code">{d.code}</code>
								{#if d.path}<code class="path">{d.path}</code>{/if}
								<span>{d.message}</span>
								{#if d.fix}<span class="fix">{d.fix}</span>{/if}
								{#if fixerOf(d.code) === 'app' && sev !== 'info'}<span class="who">{t.add.appOnly}</span>{/if}
							</li>
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
	.diag li {
		padding: 0.4rem 0;
		border-bottom: 1px solid var(--rule-blue);
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.5rem;
		align-items: baseline;
	}
	.code {
		font-weight: 700;
	}
	.diag.error .code {
		color: var(--rule-red);
	}
	.path {
		color: var(--ink-soft);
		font-size: 0.85em;
	}
	.fix {
		flex-basis: 100%;
		color: var(--ink-soft);
		font-size: var(--step--1);
	}
	.who {
		flex-basis: 100%;
		font-size: var(--step--1);
		color: var(--link);
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
