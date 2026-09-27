// Cross-file rules: E103 (slug collision), W306 (unknown sub-recipe), E213
// (sub-recipe cycle), W503 / W608 (near-identical / identical titles).

import { recipeRef } from '../build';
import { stripMarkers } from '../markers';
import { editDistance, fold } from '../normalize';
import { SLUG_RE, slugify } from '../slug';
import type { Diagnostic } from '../types';
import { isMap, severityOf } from './context';

/** What batch rules need to know about a recipe already in the vault. */
export interface VaultEntry {
	slug: string;
	title?: string;
	/** Slugs this recipe uses as sub-recipes. */
	refs: string[];
}

/** What batch rules need to know about a file in the batch. */
export interface BatchItem {
	name: string;
	frontmatter?: Record<string, unknown>;
	diagnostics: Diagnostic[];
}

interface Ref {
	slug: string;
	path: string;
}

/** The slug a file will be saved under: its own, or derived from the title. */
export function fileSlug(fm: Record<string, unknown>): string | undefined {
	if (typeof fm.slug === 'string' && SLUG_RE.test(fm.slug)) return fm.slug;
	if (fm.slug === undefined || fm.slug === null) {
		if (typeof fm.title === 'string') return slugify(fm.title) || undefined;
	}
	return undefined;
}

/** Every `recipe:` reference in the ingredients, `or` entries included. */
export function fileRefs(fm: Record<string, unknown>): Ref[] {
	const refs: Ref[] = [];
	const visit = (item: unknown, path: string) => {
		if (!isMap(item)) return;
		const slug = recipeRef(item.recipe);
		if (slug) refs.push({ slug, path: `${path}.recipe` });
		if (Array.isArray(item.or)) item.or.forEach((o, k) => visit(o, `${path}.or[${k}]`));
	};
	if (Array.isArray(fm.ingredients)) {
		fm.ingredients.forEach((g, gi) => {
			if (isMap(g) && Array.isArray(g.items)) g.items.forEach((it, ii) => visit(it, `ingredients[${gi}].items[${ii}]`));
		});
	}
	return refs;
}

/** An index entry for a vault file, or undefined when it does not parse. */
export function vaultEntryFor(fm: Record<string, unknown>): VaultEntry | undefined {
	const slug = fileSlug(fm);
	if (!slug) return undefined;
	const entry: VaultEntry = { slug, refs: fileRefs(fm).map((r) => r.slug) };
	if (typeof fm.title === 'string') entry.title = fm.title;
	return entry;
}

const normTitle = (t: string) => fold(stripMarkers(t));

function report(item: BatchItem, code: string, path: string | null, message: string, fix?: string) {
	const d: Diagnostic = { code, severity: severityOf(code), path, message, file: item.name };
	if (fix) d.fix = fix;
	item.diagnostics.push(d);
}

export function checkBatchRules(items: BatchItem[], vault: VaultEntry[]): void {
	const slugs = items.map((it) => (it.frontmatter ? fileSlug(it.frontmatter) : undefined));
	const vaultBySlug = new Map(vault.map((v) => [v.slug, v]));

	// E103 — the same slug twice in the batch, or already in the vault.
	items.forEach((item, i) => {
		const slug = slugs[i];
		if (!slug) return;
		const others = items.filter((_, j) => j !== i && slugs[j] === slug).map((o) => o.name);
		const inVault = vaultBySlug.has(slug);
		if (!others.length && !inVault) return;
		const where = [others.length ? `also used by ${others.join(', ')}` : '', inVault ? 'already in the vault' : '']
			.filter(Boolean)
			.join('; ');
		report(
			item,
			'E103',
			'slug',
			`\`slug: ${slug}\` is ${where}.`,
			`If this is a different recipe, give it its own slug (e.g. \`${slug}-<what makes it different>\`); if it is the same recipe, do not send it again.`
		);
	});

	// The sub-recipe graph: vault first, batch files on top.
	const graph = new Map<string, Set<string>>();
	for (const v of vault) graph.set(v.slug, new Set(v.refs));
	const refsOf = items.map((it) => (it.frontmatter ? fileRefs(it.frontmatter) : []));
	items.forEach((_, i) => {
		const slug = slugs[i];
		if (!slug) return;
		const set = graph.get(slug) ?? new Set<string>();
		for (const r of refsOf[i]) set.add(r.slug);
		graph.set(slug, set);
	});
	const known = new Set([...vaultBySlug.keys(), ...slugs.filter((s): s is string => !!s)]);

	items.forEach((item, i) => {
		const slug = slugs[i];
		for (const ref of refsOf[i]) {
			// W306 — pointing at a recipe not saved yet: allowed, flagged.
			if (!known.has(ref.slug)) {
				report(item, 'W306', ref.path, `\`recipe: ${ref.slug}\` points at a recipe not in the vault yet.`, 'Fine if that recipe will be added later; otherwise check the slug.');
				continue;
			}
			// E213 — a path from the referenced recipe back to this one.
			if (!slug) continue;
			const back = findPath(graph, ref.slug, slug);
			if (back) {
				report(
					item,
					'E213',
					ref.path,
					`sub-recipe cycle: ${[slug, ...back].join(' → ')}.`,
					'A recipe cannot use itself, directly or through other recipes. Remove `recipe:` from one of the entries in the cycle.'
				);
			}
		}
	});

	// W608 / W503 — same or near-identical title in the batch or the vault.
	const titles = items.map((it) => (typeof it.frontmatter?.title === 'string' ? normTitle(it.frontmatter.title) : undefined));
	items.forEach((item, i) => {
		const t = titles[i];
		if (!t) return;
		const same: string[] = [];
		const near: string[] = [];
		items.forEach((o, j) => {
			const u = titles[j];
			if (j === i || !u) return;
			if (u === t) same.push(o.name);
			else if (editDistance(t, u) <= 2) near.push(o.name);
		});
		for (const v of vault) {
			if (!v.title || v.slug === slugs[i]) continue;
			const u = normTitle(v.title);
			if (u === t) same.push(`vault recipe ${v.slug}`);
			else if (editDistance(t, u) <= 2) near.push(`vault recipe ${v.slug}`);
		}
		if (same.length)
			report(item, 'W608', 'title', `same title as ${same.join(', ')}.`, 'If these are versions of one dish, the app can make them members of one family.');
		if (near.length)
			report(item, 'W503', 'title', `near-identical title to ${near.join(', ')} — possible duplicate.`, 'Check it is not the same recipe pasted twice.');
	});
}

/** A path of slugs from `from` to `to` in the sub-recipe graph, or undefined. */
function findPath(graph: Map<string, Set<string>>, from: string, to: string): string[] | undefined {
	const prev = new Map<string, string | null>([[from, null]]);
	const queue = [from];
	while (queue.length) {
		const cur = queue.shift()!;
		if (cur === to) {
			const path: string[] = [];
			for (let n: string | null = cur; n !== null; n = prev.get(n) ?? null) path.unshift(n);
			return path;
		}
		for (const next of graph.get(cur) ?? []) {
			if (!prev.has(next)) {
				prev.set(next, cur);
				queue.push(next);
			}
		}
	}
	return undefined;
}
