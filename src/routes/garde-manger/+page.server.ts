import { redirect } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { pantryQuery } from '$lib/server/index/pantry';
import { getResolver } from '$lib/server/index/resolve';
import { loadVocab } from '$lib/server/vocab';
import { lookupKey } from '$lib/ingredients/normalize';
import { TIERS, type Tier } from '$lib/ingredients/pantry';
import type { PageServerLoad } from './$types';

/** Results shown per tier (Q19 A), and when "voir plus" opened it. */
const CAP = 20;
const CAP_MORE = 300;
const LISTS = ['have', 'must', 'avoid'] as const;

const list = (v: string | null) => [...new Set((v ?? '').split(',').map((s) => s.trim()).filter(Boolean))];

export const load: PageServerLoad = ({ url }) => {
	const app = getApp();
	const db = app.ctx.db;
	const p = url.searchParams;
	const vocab = () => loadVocab(app.ctx.paths.vocab);
	const lists = Object.fromEntries(LISTS.map((k) => [k, list(p.get(k))])) as Record<(typeof LISTS)[number], string[]>;
	let allergens = list(p.get('allergenes'));
	let assume = p.get('essentiels') !== 'non';
	let unknown: string | undefined;

	// The GET form: a typed name to add, the checkboxes. Canonicalized into the URL, then redirected.
	const typed = p.get('ajout')?.trim();
	if (typed || p.has('form')) {
		if (typed) {
			const where = (LISTS as readonly string[]).includes(p.get('ou') ?? '') ? (p.get('ou') as (typeof LISTS)[number]) : 'have';
			// « farine, lait, œufs » typed in one go: each name added; the ones not found stay in the box.
			// A name that itself holds a comma is tried whole first.
			const missed: string[] = [];
			const names = findSlug(typed) ? [typed] : typed.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
			for (const name of names) {
				const slug = findSlug(name);
				if (slug) {
					for (const k of LISTS) lists[k] = lists[k].filter((s) => s !== slug);
					lists[where].push(slug);
				} else missed.push(name);
			}
			if (missed.length) unknown = missed.join(', ');
		}
		if (p.has('form')) {
			allergens = p.getAll('allergene');
			assume = p.get('essentiels') === 'oui';
		}
		if (!unknown) redirect(303, canonical(lists, allergens, assume));
	}

	function findSlug(text: string): string | undefined {
		const bySlugOrName = db.prepare('SELECT slug FROM registry WHERE slug = ? OR name = ? LIMIT 1').pluck().get(text, text) as string | undefined;
		if (bySlugOrName) return bySlugOrName;
		const key = lookupKey(text);
		const resolver = getResolver(db, vocab);
		for (const lang of ['fr', 'en']) {
			const r = resolver.resolveKey(key, lang);
			if (r.item) return r.item;
		}
		return undefined;
	}

	const entries = db.prepare('SELECT slug, name FROM registry ORDER BY name').all() as { slug: string; name: string }[];
	const names = new Map(entries.map((e) => [e.slug, e.name]));
	const aliases = db.prepare('SELECT DISTINCT name FROM ingredient_names ORDER BY name').pluck().all() as string[];
	const allergenList = [...vocab().allergens].map(([slug, l]) => ({ slug, label: l.fr ?? slug }));

	const t0 = performance.now();
	const results = lists.have.length || lists.must.length ? pantryQuery(db, { have: lists.have, must: lists.must, avoid: lists.avoid, allergens, assumeStaples: assume }) : [];
	const ms = performance.now() - t0;
	const more = p.get('voir');
	const tiers = TIERS.map((tier: Tier) => {
		const all = results.filter((r) => r.tier === tier);
		const shown = all.slice(0, more === tier ? CAP_MORE : CAP);
		return { tier, total: all.length, results: shown };
	});
	const named = (s: string) => ({ slug: s, name: names.get(s) ?? s });
	return {
		lists: Object.fromEntries(LISTS.map((k) => [k, lists[k].map(named)])) as Record<(typeof LISTS)[number], { slug: string; name: string }[]>,
		allergens,
		assume,
		unknown,
		/** The canonical query string of this pantry (no `voir`): chips and "voir plus" build on it. */
		qs: canonical(lists, allergens, assume).replace(/^\/garde-manger\??/, ''),
		tiers,
		/** Display names of every slug a result mentions. */
		names: Object.fromEntries(
			[...new Set(tiers.flatMap((t) => t.results.flatMap((r) => [...r.missing.flat(), ...r.swaps.flatMap((s) => [s.missing, s.with])])))].map((s) => [s, names.get(s) ?? s])
		),
		aliases,
		allergenList,
		ms
	};
};

/** The URL of a pantry state; empty lists are left out, staples only when off. */
function canonical(lists: Record<string, string[]>, allergens: string[], assume: boolean): string {
	const q = new URLSearchParams();
	for (const k of LISTS) if (lists[k].length) q.set(k, lists[k].join(','));
	if (allergens.length) q.set('allergenes', allergens.join(','));
	if (!assume) q.set('essentiels', 'non');
	const s = q.toString().replace(/%2C/g, ',');
	return `/garde-manger${s ? `?${s}` : ''}`;
}
