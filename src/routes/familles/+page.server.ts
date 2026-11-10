import { fail } from '@sveltejs/kit';
import { getApp, writeContext } from '$lib/server/app';
import { DuplicateError, groupingScores, groupVersions, joinFamily } from '$lib/server/duplicates';
import { HistoryError, undoCommit } from '$lib/server/history';
import { familiesFile, FamilyLabelError, LABEL_MAX, setFamilyLabel } from '$lib/server/families';
import { COURSE_TAGS, families, familyNames } from '$lib/server/index/query';
import { variantShown } from '$lib/form';
import { stripMarkers } from '$lib/vault/markers';
import { t } from '$lib/i18n';
import type { Actions, PageServerLoad } from './$types';

interface Row {
	slug: string;
	title: string;
	family: string | null;
	variant: string | null;
	author: string | null;
	source_type: string | null;
	source_title: string | null;
	file_hash: string;
}

const recipe = (slug: string) =>
	getApp().ctx.db.prepare('SELECT slug, title, family, variant, author, source_type, source_title, file_hash FROM recipes WHERE slug = ?').get(slug) as Row | undefined;

// The groups of variants. `?grouper=<slug>` (« Grouper avec… » in a recipe's
// ⋯ menu, for the owner): that recipe joins a group, or makes one with another
// recipe (docs/DATA-FLOW.md, "Grouping variants").
export const load: PageServerLoad = ({ url, locals }) => {
	const slug = url.searchParams.get('grouper');
	const r = slug && locals.user?.markdown ? recipe(slug) : undefined;
	const names = r?.family ? familyNames(getApp().ctx.db) : {};
	const list = withFacts(families(getApp().ctx.db));
	return {
		families: list,
		labelMax: LABEL_MAX,
		// « Renommer » on each line (the owner): the families file as she saw it, the stale-write guard.
		labelsHash: locals.user?.markdown ? familiesFile(getApp().ctx).hash : '',
		grouping: r
			? { slug: r.slug, title: stripMarkers(r.title), family: r.family, familyName: r.family ? (names[r.family] ?? r.family) : null, hash: r.file_hash, variant: r.variant, author: r.author ? stripMarkers(r.author).trim() : '', origin: originOf(r) }
			: null,
		// The recipes to search, with who each is from: two cards of one title tell apart by it, not by a slug.
		recipes: r ? others(r.slug) : [],
		...(r ? likeness(r.slug, r.family, list) : { scores: {}, suggestion: null }),
		overlap: r ? overlap(r.slug) : null
	};
};

/**
 * Before « Grouper » (usability round 5: a leek tourte went into the meat
 * tourtières with no word): how many of the recipe's ingredients each other
 * recipe, and each group (any of its recipes), has too. An ingredient is its
 * registry entry, else its name's lookup key; staples (`staple: true`: salt,
 * flour) are left out of both counts, since every recipe shares them.
 * `of`: the recipe's own count; `shared` by option value (`r:<slug>`,
 * `f:<family>`), zeros left out. Under SHARED_LOW of `of` the preview warns
 * (docs/DATA-FLOW.md, "Grouping variants").
 */
const SHARED_LOW = 0.3;
function overlap(slug: string): { of: number; shared: Record<string, number>; low: number } {
	const db = getApp().ctx.db;
	const rows = db
		.prepare(
			`SELECT DISTINCT i.slug, coalesce(i.item, i.key) AS ing, r.family FROM ingredients i JOIN recipes r ON r.slug = i.slug
			 LEFT JOIN registry g ON g.slug = i.item
			 WHERE i.recipe IS NULL AND coalesce(g.staple, 0) = 0`
		)
		.all() as { slug: string; ing: string; family: string | null }[];
	const mine = new Set(rows.filter((x) => x.slug === slug).map((x) => x.ing));
	const by = new Map<string, Set<string>>();
	for (const x of rows) {
		if (x.slug === slug || !mine.has(x.ing)) continue;
		for (const k of [`r:${x.slug}`, ...(x.family ? [`f:${x.family}`] : [])]) (by.get(k) ?? by.set(k, new Set()).get(k)!).add(x.ing);
	}
	return { of: mine.size, shared: Object.fromEntries([...by].map(([k, v]) => [k, v.size])), low: SHARED_LOW };
}

/**
 * How like the recipe being grouped each recipe and group is
 * (duplicates.ts groupingScores; a group: its closest recipe), what the search
 * ranks by, and the one offered before she types: the closest group or
 * recipe at SUGGEST or more, the group when that recipe is in one
 * (« Suggestion : Pâté chinois · 3 variantes · Grouper »; usability round 4).
 */
const SUGGEST = 0.6;
function likeness(slug: string, own: string | null, list: { slug: string; name: string; count: number }[]) {
	const db = getApp().ctx.db;
	const by = groupingScores(getApp().ctx, slug);
	const familyOf = db.prepare('SELECT slug, family FROM recipes WHERE family IS NOT NULL').all() as { slug: string; family: string }[];
	const inFamily = new Map(familyOf.map((x) => [x.slug, x.family]));
	const scores: Record<string, number> = {};
	for (const [s, x] of by) {
		if (inFamily.get(s) === own && own) continue;
		scores[`r:${s}`] = x;
		const f = inFamily.get(s);
		if (f && (scores[`f:${f}`] ?? 0) < x) scores[`f:${f}`] = x;
	}
	const best = Object.entries(scores)
		.filter(([, x]) => x >= SUGGEST)
		// A group before a recipe on a tie: she joins it.
		.sort((a, b) => b[1] - a[1] || Number(b[0].startsWith('f:')) - Number(a[0].startsWith('f:')))[0];
	let suggestion: { value: string; label: string; count?: number } | null = null;
	if (best) {
		const [kind, id] = [best[0].slice(0, 2), best[0].slice(2)];
		const fam = kind === 'f:' ? id : inFamily.get(id);
		const f = fam ? list.find((x) => x.slug === fam) : undefined;
		if (f) suggestion = { value: `f:${f.slug}`, label: f.name, count: f.count };
		else {
			const title = db.prepare('SELECT title FROM recipes WHERE slug = ?').pluck().get(id) as string | undefined;
			if (title) suggestion = { value: `r:${id}`, label: stripMarkers(title) };
		}
	}
	return { scores, suggestion };
}

/**
 * What each group's line says under its name (usability round 3): the
 * shortest and longest total time, the course most of its recipes have
 * (COURSE_TAGS, the first in that order on a tie), and what tells its
 * recipes apart — each one's variant as she reads it (lib/form/family.ts).
 */
function withFacts<T extends { slug: string }>(list: T[]) {
	const db = getApp().ctx.db;
	const rows = db
		.prepare(
			`SELECT r.family, r.title, r.variant, r.total_s, r.author, r.source_type, r.source_title,
			   (SELECT t.tag FROM tags t JOIN json_each(?) c ON c.value = t.tag WHERE t.slug = r.slug ORDER BY c.key LIMIT 1) AS course
			 FROM recipes r WHERE r.family IS NOT NULL ORDER BY r.title_sort`
		)
		.all(JSON.stringify(COURSE_TAGS)) as {
		family: string;
		title: string;
		variant: string | null;
		total_s: number | null;
		author: string | null;
		source_type: string | null;
		source_title: string | null;
		course: string | null;
	}[];
	const by = new Map<string, typeof rows>();
	for (const r of rows) by.set(r.family, [...(by.get(r.family) ?? []), r]);
	return list.map((f) => {
		const rs = by.get(f.slug) ?? [];
		const times = rs.map((r) => r.total_s).filter((x): x is number => !!x);
		const courses = new Map<string, number>();
		for (const r of rs) if (r.course) courses.set(r.course, (courses.get(r.course) ?? 0) + 1);
		const course = [...courses].sort((a, b) => b[1] - a[1] || COURSE_TAGS.indexOf(a[0]) - COURSE_TAGS.indexOf(b[0]))[0]?.[0] ?? null;
		const labels = [
			...new Set(
				rs.flatMap((r) =>
					r.variant ? [variantShown(stripMarkers(r.variant), { author: r.author, source_type: r.source_type, source_title: r.source_title, title: stripMarkers(r.title) })] : []
				)
			)
		];
		return { ...f, minTime: times.length ? Math.min(...times) : null, maxTime: times.length ? Math.max(...times) : null, course, labels };
	});
}

/** What a variant's label is read from (lib/form/family.ts variantShown, variantPrefill). */
const originOf = (r: { title: string; author: string | null; source_type: string | null; source_title: string | null }) => ({
	author: r.author,
	source_type: r.source_type,
	source_title: r.source_title,
	title: stripMarkers(r.title)
});

function others(slug: string): {
	slug: string;
	title: string;
	source: string;
	author: string;
	origin: ReturnType<typeof originOf>;
	family: string | null;
	familyName: string | null;
	variant: string | null;
}[] {
	const db = getApp().ctx.db;
	const names = familyNames(db);
	const rows = db.prepare('SELECT slug, title, author, source_type, source_title, family, variant FROM recipes WHERE slug != ? ORDER BY title_sort').all(slug) as {
		slug: string;
		title: string;
		author: string | null;
		source_type: string | null;
		source_title: string | null;
		family: string | null;
		variant: string | null;
	}[];
	return rows.map((x) => ({
		slug: x.slug,
		title: stripMarkers(x.title),
		source: [x.author, x.source_title].filter(Boolean).map((y) => stripMarkers(y!)).join(', '),
		author: x.author ? stripMarkers(x.author).trim() : '',
		origin: originOf(x),
		family: x.family,
		familyName: x.family ? (names[x.family] ?? x.family) : null,
		variant: x.variant
	}));
}

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

async function run(fn: () => Promise<{ message: string; family: string; undo?: Record<string, string> }>) {
	try {
		return { ok: true, ...(await fn()) };
	} catch (e) {
		if (e instanceof DuplicateError) return fail(409, { ok: false, message: e.message });
		if (e instanceof HistoryError) return fail(409, { ok: false, message: t.duplicates.undoRefused });
		throw e;
	}
}

export const actions: Actions = {
	/** « Renommer » on a group's line: its French label in vocab/families.yaml (docs/VOCAB.md, "Labels"). */
	label: async ({ request, locals }) => {
		const f = await request.formData();
		const label = str(f, 'label');
		try {
			await setFamilyLabel(writeContext(locals.user), str(f, 'family'), label, str(f, 'hash'));
		} catch (e) {
			if (e instanceof FamilyLabelError) return fail(409, { ok: false, message: e.message });
			throw e;
		}
		return { ok: true, message: t.families.labelSaved };
	},
	/** Into an existing group. */
	join: async ({ request, locals }) => {
		const f = await request.formData();
		const r = recipe(str(f, 'slug'));
		const family = str(f, 'family');
		return run(async () => {
			if (!r) throw new DuplicateError(t.error.recipeGone);
			const done = await joinFamily(writeContext(locals.user), { slug: r.slug, hash: str(f, 'hash') || r.file_hash, variant: str(f, 'variant'), family });
			const name = familyNames(getApp().ctx.db)[family] ?? family;
			return { message: t.families.joined(stripMarkers(r.title), name), family, undo: done.commit ? { commit: done.commit, slug: r.slug, family } : undefined };
		});
	},
	/** With another recipe: one group of the two (the group one of them is in, else a new one). */
	pair: async ({ request, locals }) => {
		const f = await request.formData();
		const [a, b] = [recipe(str(f, 'slug')), recipe(str(f, 'other'))];
		return run(async () => {
			if (!a || !b) throw new DuplicateError(t.error.recipeGone);
			const label = str(f, 'label');
			const r = await groupVersions(writeContext(locals.user), {
				members: [
					{ slug: a.slug, hash: str(f, 'hash') || a.file_hash, variant: str(f, 'variant') },
					{ slug: b.slug, hash: b.file_hash, variant: str(f, 'otherVariant') }
				],
				family: a.family ?? b.family ?? '',
				label
			});
			const name = familyNames(getApp().ctx.db)[r.family] ?? (label || r.family);
			return {
				message: t.duplicates.versionsDone(2, name),
				family: r.family,
				undo: r.commit ? { commit: r.commit, slug: r.edited[0] ?? a.slug, family: r.family, grouped: a.slug } : undefined
			};
		});
	},
	undo: async ({ request, locals }) => {
		const f = await request.formData();
		try {
			const slug = str(f, 'slug');
			await undoCommit(writeContext(locals.user), str(f, 'commit'), { slug });
			// The group page stays when the group still has recipes; a group the grouping made is gone (its page a 404).
			const family = str(f, 'family');
			const left = !!family && !!getApp().ctx.db.prepare('SELECT 1 FROM recipes WHERE family = ? LIMIT 1').get(family);
			const title = recipe(str(f, 'grouped') || slug)?.title;
			return { ok: true, message: title ? t.families.ungrouped(stripMarkers(title)) : t.app.undone, left, slug };
		} catch (e) {
			if (e instanceof HistoryError) return fail(409, { ok: false, message: t.duplicates.undoRefused });
			throw e;
		}
	}
};
