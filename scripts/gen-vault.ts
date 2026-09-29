// Scale fixture: write N invented recipes (some using an earlier one as a
// sub-recipe), ~1000 registry entries and ~3000 price rows into a new
// temporary vault, then (with --bench) time the index against the plans'
// targets: plan 02's index, plan 03's ingredient paths, plan 04's write path
// (form, save, undo, photo, history over a ~20 000-commit vault, pending tags,
// sign-in, sessions).
//
//   npx tsx scripts/gen-vault.ts [N=5000] [--dir /tmp/x] [--bench]
//
// Everything is random combinations of invented words — no real recipe.

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import type { Cookies } from '@sveltejs/kit';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { openVault } from '../src/lib/server/context';
import { browse } from '../src/lib/server/index/query';
import { syncVault } from '../src/lib/server/index/sync';
import { getResolver, reresolve } from '../src/lib/server/index/resolve';
import { serializeIngredient } from '../src/lib/ingredients/registry';
import { CATEGORIES, type RegistryEntry } from '../src/lib/ingredients/types';
import { lookupKey } from '../src/lib/ingredients/normalize';
import { loadVocab } from '../src/lib/server/vocab';
import { linkKey, queueCount, resolveQueue } from '../src/lib/server/queue';
import { syncRegistry } from '../src/lib/server/registry';
import { costOfRecipe } from '../src/lib/server/cost';
import { ingredientView } from '../src/lib/server/ingredient';
import { pantryQuery } from '../src/lib/server/index/pantry';
import { ingredientIndex, INDEX_SORTS } from '../src/lib/server/ingredients';
import { appendPrice } from '../src/lib/server/prices';
import { PRICE_HEADER } from '../src/lib/ingredients/prices';
import { loadConversions } from '../src/lib/server/vocab';
import { initVault } from '../src/lib/server/vault';
import { commitPaths, git } from '../src/lib/server/git';
import { withAuthor } from '../src/lib/server/context';
import type { App } from '../src/lib/server/app';
import { formCheck, formSave, nameResolves, openForm, subRecipeCandidates, suggestAuthors, suggestNames } from '../src/lib/server/formsave';
import { formPageData } from '../src/lib/server/formpage';
import { recipeHistory, restoreVersion, undoCommit } from '../src/lib/server/history';
import { catchUpCommits, followPath } from '../src/lib/server/index/commits';
import { addPhoto, derivedCopy } from '../src/lib/server/photos';
import { currentFile } from '../src/lib/server/save';
import { acceptTag, canonicalTags, pendingTags, tagsVersion } from '../src/lib/server/tags';
import { addUser, decoyHash, UserStore } from '../src/lib/server/users';
import { SessionStore } from '../src/lib/server/sessions';
import { currentUser, signIn, startSession, Throttle, type Auth } from '../src/lib/server/auth';
import { loadCheckWords } from '../src/lib/server/vocab';
import { checkFile, hasErrors } from '../src/lib/vault/check';
import { emptyForm, ensureSection, nameHint, newItem, type FormRecipe, type MethodSection, type StepRow } from '../src/lib/form';

const args = process.argv.slice(2);
const n = Number(args.find((a) => /^\d+$/.test(a)) ?? 5000);
/** Registry size: the seed, plus invented entries up to this many. */
const REGISTRY = 1000;
/** Rows in prices.csv (plan 03, "Speed targets"). */
const PRICE_ROWS = 3000;
/** Share of recipes using an earlier one as a sub-recipe. */
const SUB_SHARE = 0.1;
/** Share of ingredient lines naming an invented registry entry (one of its aliases). */
const INVENTED_SHARE = 0.3;
/** Share of ingredient lines naming something no entry has (plan 03: ~10 % unresolvable, with the bare seed words). */
const UNKNOWN_SHARE = 0.05;
const dirArg = args.indexOf('--dir');
const dir = dirArg >= 0 ? args[dirArg + 1] : join(mkdtempSync(join(tmpdir(), 'rv-scale-')), 'vault');
const bench = args.includes('--bench');

// Deterministic PRNG so runs are comparable.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const some = <T>(xs: readonly T[], k: number): T[] => [...new Set(Array.from({ length: k }, () => pick(xs)))];

const DISHES = ['Tarte', 'Pouding', 'Gratin', 'Soupe', 'Ragoût', 'Pain', 'Gâteau', 'Salade', 'Sauce', 'Biscuits', 'Casserole', 'Pâté', 'Muffins', 'Carrés', 'Galettes', 'Bouilli', 'Croustade', 'Tourte'];
const WITH = ['aux pommes', 'au sucre', 'aux légumes', 'au poulet', 'au bœuf', 'aux carottes', 'au fromage', 'à l’érable', 'aux bleuets', 'aux fraises', 'au chocolat', 'aux fèves', 'au jambon', 'aux patates', 'au riz', 'aux noix', 'à la crème', 'au saumon'];
const STYLE = ['de grand-mère', 'du dimanche', 'rapide', 'des fêtes', 'express', 'd’automne', 'de campagne', 'à l’ancienne', 'du chalet', 'facile', ''];
const FAMILIES = ['tarte', 'pouding', 'gratin', 'soupe', 'ragout', 'pain', 'gateau', 'salade'];
const TAGS = ['dessert', 'plat-principal', 'soupe', 'four', 'mijote', 'quebecois', 'vegetarien', 'boeuf', 'volaille', 'legumes', 'chocolat', 'petit-dejeuner', 'rapide', 'fetes'];
const SEASONS = ['printemps', 'ete', 'automne', 'hiver'];
const ING = ['farine', 'sucre', 'cassonade', 'beurre', 'lait', 'œufs', 'sel', 'poivre', 'oignon', 'ail', 'carottes', 'céleri', 'patates', 'bœuf haché', 'poulet', 'crème 35 %', 'fromage cheddar', 'pommes', 'bleuets', 'sirop d’érable', 'poudre à pâte', 'vanille', 'cannelle', 'tomates', 'riz', 'noix', 'chocolat', 'jambon', 'fèves', 'saumon', 'persil', 'moutarde'];
const UNITS = ['cup', 'tbsp', 'tsp', 'g', 'ml', 'lb', 'piece'];
const QTYS = [1, 2, 3, '1/2', '1/4', '2/3', '1 1/2', 250, 500];
const VERBS = ['Mélanger', 'Ajouter', 'Cuire', 'Verser', 'Battre', 'Incorporer', 'Faire revenir', 'Laisser reposer', 'Servir'];

function recipe(i: number, earlier: readonly string[]): { slug: string; text: string } {
	const title = `${pick(DISHES)} ${pick(WITH)} ${pick(STYLE)}`.trim() + ` ${i}`;
	const slug = title
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.replace(/œ/g, 'oe')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	const fam = rand() < 0.3 ? pick(FAMILIES) : undefined;
	const items = some(ING, 4 + Math.floor(rand() * 8)).map((common) => {
		// Most lines use the common names (the seed resolves most of them), some an
		// invented registry entry under one of its aliases, a few a name no entry has.
		const r = rand();
		const name = r < INVENTED_SHARE ? pick(invented) : r < INVENTED_SHARE + UNKNOWN_SHARE ? pick(unknown) : common;
		const q = pick(QTYS);
		return `      - { qty: ${typeof q === 'string' ? `"${q}"` : q}, unit: ${pick(UNITS)}, name: ${name} }`;
	});
	// An earlier recipe only: chains, never cycles. Scaled by its `yield` object
	// (a piece of it); `servings` alone would leave "a piece" ambiguous (Q16 A).
	if (earlier.length && rand() < SUB_SHARE) items.push(`      - { qty: 2, unit: piece, name: base maison, recipe: ${pick(earlier)} }`);
	const steps = Array.from({ length: 3 + Math.floor(rand() * 5) }, (_, k) => `${k + 1}. ${pick(VERBS)} ${some(ING, 2).join(' et ')} pendant ${5 + Math.floor(rand() * 40)} min.`);
	const text = [
		'---',
		'schema: 3',
		`title: ${title}`,
		`slug: ${slug}`,
		'lang: fr',
		...(fam ? [`family: ${fam}`, `variant: v${i}`] : []),
		'source:',
		`  type: ${pick(['family', 'book', 'magazine', 'website'])}`,
		`  author: Auteur ${1 + Math.floor(rand() * 40)}`,
		'times:',
		`  prep: ${5 + Math.floor(rand() * 40)}m`,
		`  cook: ${Math.floor(rand() * 3)}h${10 + Math.floor(rand() * 40)}m`,
		...((n) => [`servings: ${n}`, `yield: { qty: ${n}, unit: piece }`])(2 + Math.floor(rand() * 10)),
		// Every 50th recipe also carries one of 20 invented tags no vocabulary has
		// (pending, for /etiquettes); by index, so the random draws stay as they were.
		`tags: [${[...some(TAGS, 2 + Math.floor(rand() * 3)), ...(i % 50 === 0 ? [`essai-${(i / 50) % 20}`] : [])].join(', ')}]`,
		`season: [${some(SEASONS, 1).join(', ')}]`,
		`rating: ${1 + Math.floor(rand() * 5)}`,
		'ingredients:',
		'  - items:',
		...items,
		`status: ${pick(['draft', 'needs-review', 'verified'])}`,
		`added: 2026-0${1 + Math.floor(rand() * 9)}-1${Math.floor(rand() * 9)}`,
		'extracted_by: ai',
		'---',
		'',
		'## Préparation',
		'',
		...steps,
		''
	].join('\n');
	return { slug, text };
}

await initVault(dir, readFileSync('docs/VOCAB.md', 'utf8'), { name: 'Scale Test', email: 'scale@example.invalid' }, readFileSync('docs/INGREDIENTS-SEED.yaml', 'utf8'));
// Invented registry entries up to REGISTRY, with invented names (syllables).
const SYL = ['ba', 'lo', 'mi', 'ter', 'qua', 'ron', 'vel', 'si', 'du', 'pan', 'gor', 'nel', 'fi', 'tou', 'bri'];
const word = () => Array.from({ length: 2 + Math.floor(rand() * 2) }, () => pick(SYL)).join('');
const entryFiles = () => readdirSync(join(dir, 'ingredients')).filter((f) => f.endsWith('.md'));
const seeded = entryFiles().length;
/** Aliases of the invented entries, as recipes write them. */
const invented: string[] = [];
const inventedSlugs: string[] = [];
const ALLERGENS = ['oeuf', 'lait', 'noix', 'gluten', 'soya'];
for (let k = seeded; k < REGISTRY; k++) {
	const name = `${word()} ${word()}`;
	const slug = `inv-${k}-${lookupKey(name).replace(/[^a-z0-9]+/g, '-')}`;
	const en = rand() < 0.3 ? [`${word()} ${name.split(' ')[0]}`] : [];
	const entry: RegistryEntry = {
		slug,
		category: pick(CATEGORIES),
		names: { fr: [name, `${name}s`], en },
		staple: rand() < 0.05,
		auGout: false,
		weights: rand() < 0.1 ? { piece: 20 + Math.floor(rand() * 200) } : {},
		substitutes: inventedSlugs.length && rand() < 0.1 ? [pick(inventedSlugs)] : [],
		allergens: rand() < 0.05 ? [pick(ALLERGENS)] : [],
		body: ''
	};
	if (rand() < 0.2) entry.density = Number((0.3 + rand()).toFixed(2));
	if (rand() < 0.5) entry.defaultUnit = pick(['g', 'ml', 'piece'] as const);
	writeFileSync(join(dir, 'ingredients', `${slug}.md`), serializeIngredient(entry));
	inventedSlugs.push(slug);
	invented.push(name, `${name}s`, ...en);
}
// Names no entry has: a different syllable set, so no alias or plural matches.
const UNK = ['zu', 'kra', 'plo', 'wen', 'yig', 'hax'];
const unknown = Array.from({ length: 150 }, () => `${pick(UNK)}${pick(UNK)}${pick(UNK)} ${pick(UNK)}${pick(UNK)}`);
const seen = new Set<string>();
const written: string[] = [];
for (let i = 1; i <= n; i++) {
	const r = recipe(i, written);
	if (seen.has(r.slug)) continue;
	seen.add(r.slug);
	written.push(r.slug);
	writeFileSync(join(dir, 'recipes', `${r.slug}.md`), r.text);
}
// Invented prices: random entries, packs and dates, a few in another currency.
const slugs = entryFiles().map((f) => f.replace(/\.md$/, ''));
const PACKS = [
	[400, 'g'],
	[1, 'kg'],
	[2, 'lb'],
	[1, 'l'],
	[500, 'ml'],
	[12, 'piece'],
	[1, 'can']
] as const;
const priceLines = Array.from({ length: PRICE_ROWS }, () => {
	const [q, u] = pick(PACKS);
	const date = `202${4 + Math.floor(rand() * 3)}-0${1 + Math.floor(rand() * 9)}-1${Math.floor(rand() * 9)}`;
	return `${date},${pick(slugs)},${(0.5 + rand() * 15).toFixed(2)},${rand() < 0.02 ? 'USD' : 'CAD'},${q},${u},Magasin ${1 + Math.floor(rand() * 6)},`;
});
writeFileSync(join(dir, 'prices.csv'), [PRICE_HEADER, ...priceLines, ''].join('\n'));
console.log(`${seen.size} recipes, ${slugs.length} registry entries, ${PRICE_ROWS} price rows written to ${dir}`);

if (bench) {
	const ctx = openVault({ root: dir, author: { name: 'x', email: 'x@x' }, log: () => {} });
	const time = (label: string, fn: () => unknown, runs = 1) => {
		fn(); // warm
		const t0 = performance.now();
		for (let i = 0; i < runs; i++) fn();
		const ms = (performance.now() - t0) / runs;
		console.log(`${label.padEnd(34)} ${ms.toFixed(1)} ms`);
		return ms;
	};
	const t0 = performance.now();
	const first = syncVault(ctx.db, ctx.paths, { force: true });
	console.log(`${'first full sync'.padEnd(34)} ${(performance.now() - t0).toFixed(0)} ms (${first.indexed} indexed, ${first.problems.length} problems)`);
	const t1 = performance.now();
	syncVault(ctx.db, ctx.paths, { force: true });
	console.log(`${'sync --force'.padEnd(34)} ${(performance.now() - t1).toFixed(0)} ms`);
	const t2 = performance.now();
	syncVault(ctx.db, ctx.paths);
	console.log(`${'no-op sync'.padEnd(34)} ${(performance.now() - t2).toFixed(0)} ms`);
	time('FTS query "tarte pomm"', () => browse(ctx.db, { q: 'tarte pomm' }, { withFacets: false }), 50);
	time('FTS query "creme" + facets', () => browse(ctx.db, { q: 'creme' }), 20);
	time('browse page 1 by title', () => browse(ctx.db, { sort: 'title' }, { withFacets: false }), 50);
	time('browse page 1 by title + facets', () => browse(ctx.db, { sort: 'title' }), 20);
	time('browse filtered + facets', () => browse(ctx.db, { tags: ['dessert'], season: 'hiver', sort: 'time', page: 3 }), 20);
	// Plan 03, Phase 2: resolution.
	const vocab = loadVocab(ctx.paths.vocab);
	time('re-resolve every row (direct)', () => ctx.db.transaction(() => reresolve(ctx.db, getResolver(ctx.db, vocab)))(), 5);
	// One alias edit, as a queue action or the watcher does it: reload the
	// registry (one file changed) and re-resolve, with no recipe file read.
	const f = join(dir, 'ingredients', 'sucre.md');
	let alias = 0;
	const addAlias = () => writeFileSync(f, readFileSync(f, 'utf8').replace(/^ {2}fr: \[/m, `  fr: [sucre ${++alias}, `));
	time(
		'one alias edit: registry reload + re-resolve',
		() => {
			addAlias();
			const v = loadVocab(ctx.paths.vocab);
			ctx.db.transaction(() => {
				if (syncRegistry(ctx.db, ctx.paths, v).changed) reresolve(ctx.db, getResolver(ctx.db, v));
			})();
		},
		5
	);
	// The same edit picked up by `vault sync` (CLI, startup): every recipe file is hashed too.
	time(
		'one alias edit: through vault sync',
		() => {
			addAlias();
			syncVault(ctx.db, ctx.paths);
		},
		5
	);
	const resolver = getResolver(ctx.db, vocab);
	const names = ['sucre brun', 'farine de ble', 'oignons verts', 'piments', 'fromage fort', 'bouillon de poulet maison', 'patattes', 'cassonnade'];
	let i = 0;
	time('fuzzy candidates for one name', () => resolver.candidates(lookupKey(names[i++ % names.length])), 400);
	time('resolve queue page (30 rows)', () => resolveQueue(ctx.db, vocab, { limit: 30 }), 20);
	time('queue count (nav, every page)', () => queueCount(ctx.db), 50);
	const rows = ctx.db.prepare('SELECT resolution, count(*) AS n FROM ingredients GROUP BY resolution ORDER BY n DESC').all() as { resolution: string; n: number }[];
	console.log(`${'ingredient rows'.padEnd(34)} ${rows.map((r) => `${r.resolution} ${r.n}`).join(', ')}`);
	// Plan 03, Phases 4 and 5: the ingredient index, cost, price entry.
	const sorts = INDEX_SORTS.map((sort) => time(`ingredient index, sort ${sort}`, () => ingredientIndex(ctx.db, { sort }), 20));
	console.log(`${'ingredient index page (worst sort)'.padEnd(34)} ${Math.max(...sorts).toFixed(1)} ms (${ingredientIndex(ctx.db, {}).length} rows)`);
	// The recipe with the deepest sub-recipe chain.
	const depthOf = (slug: string, d = 0): number => {
		const subs = ctx.db.prepare('SELECT recipe FROM ingredients WHERE slug = ? AND recipe IS NOT NULL').pluck().all(slug) as string[];
		return subs.length && d < 20 ? Math.max(...subs.map((s) => depthOf(s, d + 1))) : d;
	};
	const withSubs = ctx.db.prepare('SELECT DISTINCT slug FROM ingredients WHERE recipe IS NOT NULL').pluck().all() as string[];
	const deepest = withSubs.map((s) => [s, depthOf(s)] as const).sort((a, b) => b[1] - a[1])[0];
	if (deepest) {
		const c = costOfRecipe(ctx.db, deepest[0], loadConversions(ctx.paths.vocab))!;
		time(`cost of one recipe (depth ${deepest[1]}, ${c.lines.length} lines)`, () => costOfRecipe(ctx.db, deepest[0], loadConversions(ctx.paths.vocab)), 50);
	}
	time('cost of one recipe, no sub-recipe', () => costOfRecipe(ctx.db, written[0], loadConversions(ctx.paths.vocab)), 50);
	// Plan 03, Phase 6: the ingredient view, for the most used entry (the worst case).
	const top = ctx.db.prepare('SELECT item FROM ingredients WHERE item IS NOT NULL GROUP BY item ORDER BY count(*) DESC LIMIT 1').pluck().get() as string;
	const uses = ingredientView(ctx.db, top, vocab)!.uses.length;
	time(`ingredient view (${top}, ${uses} recipes)`, () => ingredientView(ctx.db, top, loadVocab(ctx.paths.vocab)), 20);
	// Plan 03, Phase 7: pantry search. The first query builds the model from the index; the next reuse it.
	const pick = ctx.db.prepare('SELECT item FROM ingredients WHERE item IS NOT NULL GROUP BY item ORDER BY count(*) DESC LIMIT 8').pluck().all() as string[];
	const tp = performance.now();
	const found = pantryQuery(ctx.db, { have: pick.slice(0, 3) }).length;
	console.log(`${'pantry model build + first query'.padEnd(34)} ${(performance.now() - tp).toFixed(1)} ms (${found} results)`);
	time('pantry query, 3 picked', () => pantryQuery(ctx.db, { have: pick.slice(0, 3) }), 50);
	time('pantry query, 8 picked + avoid', () => pantryQuery(ctx.db, { have: pick, avoid: ['noix-de-grenoble'], allergens: ['arachides'] }), 50);
	// A real vault has every file committed: git's first look at 6000 untracked files is not what an append costs.
	await commitPaths(dir, ['recipes', 'ingredients', 'prices.csv'], 'scale fixture', { name: 'Scale Test', email: 'scale@example.invalid' });
	// A queue click end to end: "Relier" on the top rows (write, commit, reload, re-resolve).
	const links: number[] = [];
	for (const row of resolveQueue(ctx.db, vocab, { limit: 5 }).rows) {
		const t = performance.now();
		await linkKey(ctx, row.key, inventedSlugs[links.length]);
		links.push(performance.now() - t);
	}
	const lsorted = [...links].sort((a, b) => a - b);
	console.log(`${'queue "Relier", commit included'.padEnd(34)} ${lsorted[Math.floor(lsorted.length / 2)].toFixed(1)} ms (median of ${links.length}; ${links.map((a) => a.toFixed(0)).join(', ')})`);
	const appends: number[] = [];
	for (let k = 0; k < 5; k++) {
		const t = performance.now();
		await appendPrice(ctx, { ingredient: 'farine-tout-usage', amount: 4.99 + k, packQty: 2.5, packUnit: 'kg', shop: 'Magasin 1' });
		appends.push(performance.now() - t);
	}
	const sorted = [...appends].sort((a, b) => a - b);
	console.log(`${'append one price and commit'.padEnd(34)} ${sorted[2].toFixed(1)} ms (median of 5; ${appends.map((a) => a.toFixed(0)).join(', ')})`);
	await benchWritePath(ctx);
	ctx.db.close();
}

// ---------------------------------------------------------------------------
// Plan 04: the write path.

function median(xs: number[]): number {
	return [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
}
function show(label: string, xs: number[], extra = ''): void {
	console.log(`${label.padEnd(34)} ${median(xs).toFixed(1)} ms (median of ${xs.length}; ${xs.map((a) => a.toFixed(0)).join(', ')})${extra ? ` ${extra}` : ''}`);
}
async function timeAsync(label: string, fn: (k: number) => Promise<unknown>, runs: number, extra = ''): Promise<number[]> {
	const xs: number[] = [];
	for (let k = 0; k < runs; k++) {
		const t = performance.now();
		await fn(k);
		xs.push(performance.now() - t);
	}
	show(label, xs, extra);
	return xs;
}

/** The recipe the form, history and photo benches use: 50-odd lines, groups, sub-headings, a marker. Invented. */
// Functions, not consts: the bench runs from top-level code above them.
function benchSlug(): string {
	return 'banc-d-essai-tourte';
}
function benchRecipe(): string {
	return `---
schema: 3
title: Tourte de la cabane d'essai
slug: ${benchSlug()}
lang: fr
family: tourte
variant: de la cabane
source:
  type: family
  author: Tante Inventée
times:
  prep: 45m
  cook: 1h15m
  rest: 20m
oven: { temp: 375, unit: F }
servings: 8
tags: [plat-principal, four, fetes]
season: [hiver]
rating: 4
ingredients:
  - group: Pâte
    items:
      - { qty: "2 1/2", unit: cup, name: farine }
      - { qty: 1, unit: tsp, name: sel }
      - { qty: 1, unit: cup, name: beurre, prep: froid }
      - { qty: "1/2", unit: cup, name: eau, note: glacée }
  - group: Garniture
    items:
      - { qty: 1, unit: lb, name: bœuf haché }
      - { qty: 1, unit: lb, name: poulet, prep: en dés }
      - { qty: 1, unit: piece, name: oignon, prep: haché }
      - { qty: 2, unit: piece, name: patates, note: "moyennes [?]" }
      - { qty: "1/2", unit: tsp, name: cannelle }
      - { qty: "1/4", unit: tsp, name: moutarde }
      - { name: poivre, to_taste: true }
status: draft
added: 2026-01-10
extracted_by: ai
---

## Préparation

### Pâte

1. Mélanger la farine et le sel.
2. Couper le beurre dans la farine.
3. Ajouter l'eau et former une boule.

### Garniture

4. Faire revenir le bœuf, le poulet et l'oignon pendant 15 min.
5. Ajouter les patates et les épices.
6. Cuire 30 min à feu doux.

### Montage

7. Foncer une assiette à tarte avec la moitié de la pâte.
8. Verser la garniture et couvrir.
9. Cuire au four 45 min.

## Notes

Se congèle bien.
`;
}

/** One of the bench recipe's 49 edits, by kind in turn: rating, an ingredient, a step, the title, the notes. */
function benchEdit(text: string, k: number): string {
	switch (k % 5) {
		case 0:
			return text.replace(/^rating: \d$/m, (m) => `rating: ${(Number(m.slice(-1)) % 5) + 1}`);
		case 1:
			return text.replace(/^status:/m, `      - { qty: 1, unit: tsp, name: épice ${k} }\nstatus:`);
		case 2:
			return text.replace(/^9\. .*$/m, `9. Cuire au four ${40 + k} min.`);
		case 3:
			return text.replace(/^title: .*$/m, `title: Tourte de la cabane d'essai ${k}`);
		default:
			return text.replace(/(## Notes\n\n).*/, `$1Se congèle bien (essai ${k}).`);
	}
}

/**
 * Grow the vault's history to ~`total` commits with `git fast-import`: every
 * commit changes one recipe's rating, except `versions - 1` commits spread
 * evenly through them that edit the bench recipe (added in the first one).
 */
function growHistory(dir: string, slugs: string[], total: number, versions: number): void {
	const branch = execFileSync('git', ['symbolic-ref', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
	const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
	const texts = new Map<string, string>();
	const textOf = (slug: string) => texts.get(slug) ?? readFileSync(join(dir, 'recipes', `${slug}.md`), 'utf8');
	const people = [
		['Cuisinière Test', 'cuisiniere@recipevault.invalid'],
		['Propriétaire Test', 'proprio@recipevault.invalid']
	];
	const every = Math.floor(total / versions);
	const chunks: Buffer[] = [];
	const data = (s: string) => {
		const b = Buffer.from(s);
		chunks.push(Buffer.from(`data ${b.length}\n`), b, Buffer.from('\n'));
	};
	let ts = Date.UTC(2020, 0, 1) / 1000;
	let benchEdits = 0;
	for (let c = 0; c < total; c++) {
		let slug: string;
		let text: string;
		let verb = 'edit';
		if (c === 0) {
			slug = benchSlug();
			text = benchRecipe();
			verb = 'add';
		} else if (c % every === 0 && benchEdits < versions - 1) {
			slug = benchSlug();
			text = benchEdit(textOf(slug), benchEdits++);
		} else {
			slug = slugs[Math.floor(rand() * slugs.length)];
			text = textOf(slug).replace(/^rating: \d$/m, (m) => `rating: ${(Number(m.slice(-1)) % 5) + 1}`);
		}
		texts.set(slug, text);
		const [name, email] = people[c % 2];
		ts += 3600 + Math.floor(rand() * 7200);
		const title = /^title: (.*)$/m.exec(text)![1];
		chunks.push(Buffer.from(`commit ${branch}\nauthor ${name} <${email}> ${ts} -0400\ncommitter ${name} <${email}> ${ts} -0400\n`));
		data(`${verb}: ${title}`);
		if (c === 0) chunks.push(Buffer.from(`from ${head}\n`));
		chunks.push(Buffer.from(`M 100644 inline recipes/${slug}.md\n`));
		data(text);
		chunks.push(Buffer.from('\n'));
	}
	if (benchEdits !== versions - 1) throw new Error(`bench recipe got ${benchEdits + 1} versions, not ${versions}`);
	execFileSync('git', ['fast-import', '--quiet'], { cwd: dir, input: Buffer.concat(chunks), maxBuffer: 1 << 30 });
	execFileSync('git', ['reset', '--hard', '--quiet'], { cwd: dir });
}

async function benchWritePath(ctx: ReturnType<typeof openVault>): Promise<void> {
	console.log('\n— plan 04: the write path —');
	const person = { name: 'Cuisinière Test', email: 'cuisiniere@recipevault.invalid' };
	const her = withAuthor(ctx, person);
	const app = { ctx } as App;
	const time = (label: string, fn: () => unknown, runs = 1) => {
		fn(); // warm
		const t0 = performance.now();
		for (let i = 0; i < runs; i++) fn();
		const ms = (performance.now() - t0) / runs;
		console.log(`${label.padEnd(34)} ${ms < 1 ? ms.toFixed(3) : ms.toFixed(1)} ms`);
		return ms;
	};
	const BENCH_SLUG = benchSlug();
	const headOf = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();

	// History first: the form, the save and the photo are timed in a vault with ~20 000 commits.
	const HISTORY = 20_000;
	const tg = performance.now();
	growHistory(dir, written, HISTORY, 50);
	syncVault(ctx.db, ctx.paths);
	const commits = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
	console.log(`${'history grown (fast-import + sync)'.padEnd(34)} ${((performance.now() - tg) / 1000).toFixed(1)} s (${commits} commits)`);
	const bench = checkFile(readFileSync(join(dir, 'recipes', `${BENCH_SLUG}.md`), 'utf8'));
	if (!bench.recipe || hasErrors(bench.diagnostics)) throw new Error(`bench recipe does not pass the checker: ${bench.diagnostics.map((d) => d.code).join(', ')}`);
	const lines = readFileSync(join(dir, 'recipes', `${BENCH_SLUG}.md`), 'utf8').split('\n').length;

	// The commit index (cache/index.db): read once from git (the first start after an upgrade, or
	// after cache/ is deleted), then only the new commits.
	await catchUpCommits(ctx.db, dir);
	ctx.db.prepare("DELETE FROM meta WHERE key = 'commits_head'").run(); // as after cache/ is deleted
	const tc = performance.now();
	const full = await catchUpCommits(ctx.db, dir);
	console.log(`${'commit index: full read'.padEnd(34)} ${((performance.now() - tc) / 1000).toFixed(1)} s (${full.mode}, ${full.commits} commits)`);
	await timeAsync('commit index: caught up (no-op)', () => catchUpCommits(ctx.db, dir), 5);
	const gitLog = async (label: string, args: string[], slug: string) => {
		const t = performance.now();
		// One path: git 2.43 uses Bloom filters for a single pathspec only.
		const out = await git(dir, ['log', ...args, '--format=%H', '--', `recipes/${slug}.md`]);
		console.log(`${label.padEnd(34)} ${(performance.now() - t).toFixed(1)} ms`);
		return out.trim().split('\n');
	};
	// A few ordinary recipes (a handful of versions each): --follow's cost varied with the path.
	const others = written.slice(1, 4);
	// The index lists what `git log --follow` lists (the page's own cut aside: none of these was copied or re-created).
	for (const s of [BENCH_SLUG, ...others]) {
		const byGit = await gitLog(`  git log --follow (${s.slice(0, 12)}…)`, ['--follow', '-M'], s);
		const byIndex = followPath(ctx.db, `recipes/${s}.md`).map((e) => e.commit);
		if (byIndex.join() !== byGit.join()) throw new Error(`commit index and git log --follow differ for ${s}`);
	}
	// The history page (its load: the commit index, every version's text, summaries, today's checker).
	const versions = (await recipeHistory(ctx, BENCH_SLUG)).versions.length;
	await timeAsync('history page, bench recipe', () => recipeHistory(ctx, BENCH_SLUG), 5, `(${versions} versions, ${commits} commits)`);
	for (const s of others) {
		const n = (await recipeHistory(ctx, s)).versions.length;
		await timeAsync(`history page, ${n}-version recipe`, () => recipeHistory(ctx, s), 3);
	}

	// Open the edit form: the page's server load.
	openForm(ctx, BENCH_SLUG);
	const cold = performance.now();
	formPageData(app, openForm(ctx, BENCH_SLUG) as never, { slug: BENCH_SLUG, hash: '' });
	console.log(`${'open edit form, stats not cached'.padEnd(34)} ${(performance.now() - cold).toFixed(1)} ms`);
	time(`open edit form (${lines}-line recipe)`, () => {
		const o = openForm(ctx, BENCH_SLUG);
		if (!('form' in o)) throw new Error('bench recipe did not open');
		return formPageData(app, o.form, { slug: BENCH_SLUG, hash: o.hash });
	}, 20);
	time('open new-recipe form', () => formPageData(app, null), 20);

	// Suggestions for one keystroke: what GET /api/suggest?kind=name runs.
	const typed = ['f', 'fa', 'far', 'fari', 'farin', 'farine', 'b', 'be', 'beu', 'beur', 'c', 'ca', 'cas', 'po', 'pom', 'ba', 'bal', 'zu'];
	let q = 0;
	time('suggest names, one keystroke', () => {
		const s = typed[q++ % typed.length];
		return [suggestNames(ctx, s, 'fr'), nameResolves(ctx, s, 'fr')];
	}, 200);
	time('suggest authors, one keystroke', () => suggestAuthors(ctx, typed[q++ % typed.length]), 200);
	time('suggest sub-recipes (E213 walk)', () => subRecipeCandidates(ctx, 'tar', BENCH_SLUG), 50);

	// Hints while typing: the browser's name-word check (same code, run here).
	const words = loadCheckWords(ctx.paths.vocab);
	const names = ['oignons hachés', 'gros œufs', 'farine tout usage', 'beurre doux fondu', 'carottes râpées finement', 'sucre', 'petites patates', 'crème 35 %'];
	let h = 0;
	time('name hint, one field (browser)', () => nameHint(names[h++ % names.length], words), 2000);
	const opened = openForm(ctx, BENCH_SLUG) as { form: FormRecipe; hash: string };
	time('form check, whole form (debounced)', () => formCheck(ctx, opened.form, { slug: BENCH_SLUG, hash: opened.hash }), 10);

	// Saves. Unchanged first: no write, no commit.
	const before = headOf();
	const t0 = performance.now();
	const same = await formSave(her, { form: opened.form, base: { slug: BENCH_SLUG, hash: opened.hash } });
	const tu = performance.now() - t0;
	console.log(`${'unchanged form save'.padEnd(34)} ${tu.toFixed(1)} ms (${same.status}; ${headOf() === before ? 'no commit' : 'COMMITTED'})`);
	if (same.status !== 'unchanged' || headOf() !== before) throw new Error('an unchanged form save wrote something');
	const saved: string[] = [];
	await timeAsync('form save, edit (one step)', async (k) => {
		const o = openForm(ctx, BENCH_SLUG) as { form: FormRecipe; hash: string };
		const m = o.form.sections.find((s) => s.kind === 'method') as MethodSection;
		const step = m.rows.filter((r) => r.type === 'step')[1];
		step.text = `${step.text.replace(/ \(banc \d+\)$/, '')} (banc ${k})`;
		const r = await formSave(her, { form: o.form, base: { slug: BENCH_SLUG, hash: o.hash } });
		if (r.status !== 'saved') throw new Error(`form save: ${r.status}`);
		saved.push(r.commit!);
	}, 5);
	await timeAsync('form save, new recipe', async (k) => {
		const f = emptyForm({ lang: 'fr', ovenUnit: 'F' });
		f.title = `Galettes du banc d'essai ${k}`;
		Object.assign(f.groups[0].items[0], { qty: '1 1/2', unit: 'cup', name: 'farine' });
		f.groups[0].items.push({ ...newItem(), qty: '1/2', unit: 'cup', name: 'sucre' });
		(ensureSection(f, 'method').rows[0] as StepRow).text = 'Mélanger et cuire 12 min.';
		const r = await formSave(her, { form: f });
		if (r.status !== 'saved' || !r.created) throw new Error(`new recipe: ${r.status}`);
	}, 5);

	// Undo (the toast) and restore (the history page), same path as a save.
	let last = saved[saved.length - 1];
	await timeAsync('undo the last save', async () => {
		const r = await undoCommit(her, last, { slug: BENCH_SLUG });
		last = r.commit!; // the next undo undoes this one (a redo)
	}, 5);
	// The commit index after a commit (in the background after an app commit; the next read otherwise).
	const appended: number[] = [];
	for (let k = 0; k < 3; k++) {
		const rel = `recipes/${written[10 + k]}.md`;
		writeFileSync(join(dir, rel), readFileSync(join(dir, rel), 'utf8').replace(/^rating: \d$/m, (m) => `rating: ${(Number(m.slice(-1)) % 5) + 1}`));
		await commitPaths(dir, [rel], `edit: banc ${k}`, person);
		const t = performance.now();
		const r = await catchUpCommits(ctx.db, dir);
		appended.push(performance.now() - t);
		if (r.mode !== 'append' || r.commits !== 1) throw new Error(`commit index: ${r.mode} ${r.commits}`);
	}
	syncVault(ctx.db, ctx.paths);
	show('commit index: catch up one commit', appended);
	// "Revenir à cette version" as the route runs it (restoreVersion finds the version in the commit index).
	const restores: number[] = [];
	for (let k = 0; k < 3; k++) {
		const hist = await recipeHistory(ctx, BENCH_SLUG);
		const v = hist.versions.filter((x) => x.restorable)[2];
		const t = performance.now();
		await restoreVersion(her, BENCH_SLUG, v.commit, hist.hash!);
		restores.push(performance.now() - t);
	}
	show('restore a version 3 back', restores);

	// Photo: a 12 MP JPEG (noise, so it is as heavy as a phone's).
	const jpeg = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 180, g: 120, b: 60 }, noise: { type: 'gaussian', mean: 128, sigma: 40 } } })
		.jpeg({ quality: 90 })
		.toBuffer();
	const mb = (jpeg.length / 1024 / 1024).toFixed(1);
	let file = '';
	await timeAsync('photo upload: store + both copies', async () => {
		const cur = currentFile(ctx, BENCH_SLUG)!;
		file = (await addPhoto(her, BENCH_SLUG, cur.hash, jpeg)).file;
	}, 3, `(12 MP JPEG, ${mb} MB)`);
	const tt: number[] = [];
	const td: number[] = [];
	for (let k = 0; k < 3; k++) {
		rmSync(join(ctx.paths.cache, 'img', BENCH_SLUG), { recursive: true, force: true });
		let t = performance.now();
		await derivedCopy(ctx.paths, BENCH_SLUG, file, 'thumb');
		tt.push(performance.now() - t);
		t = performance.now();
		await derivedCopy(ctx.paths, BENCH_SLUG, file, 'display');
		td.push(performance.now() - t);
	}
	show('derived thumb on demand', tt);
	show('derived display on demand', td);

	// /etiquettes: the page's load, then one "Nouvelle étiquette" (one commit, the index retags).
	const pend = pendingTags(ctx);
	time('/etiquettes page', () => [pendingTags(ctx), canonicalTags(ctx), tagsVersion(ctx)], 20);
	console.log(`${'  pending tags'.padEnd(34)} ${pend.length} (${pend.map((p) => `${p.tag} ${p.recipes.length}`).join(', ')})`);
	await timeAsync('accept one pending tag + commit', async (k) => {
		const p = pendingTags(her).find((x) => x.tag.startsWith('essai-'))!;
		await acceptTag(her, p.tag, `Essai ${k}`, tagsVersion(her));
	}, 3);
	const big = pendingTags(her).sort((a, b) => b.recipes.length - a.recipes.length)[0];
	if (big) await timeAsync(`accept the biggest (${big.tag}, ${big.recipes.length})`, () => acceptTag(her, big.tag, big.label, tagsVersion(her)), 1);

	// For the report: the same log without --follow, before and after a commit-graph with changed-path Bloom filters,
	// which --follow cannot use. Last, as it changes the bench vault.
	for (const s of [BENCH_SLUG, ...others]) await gitLog(`  git log, no --follow (${s.slice(0, 12)}…)`, [], s);
	execFileSync('git', ['commit-graph', 'write', '--reachable', '--changed-paths'], { cwd: dir, stdio: 'ignore' });
	for (const s of [BENCH_SLUG, ...others]) {
		await gitLog(`  + Bloom, --follow (${s.slice(0, 12)}…)`, ['--follow', '-M'], s);
		await gitLog(`  + Bloom, no --follow (${s.slice(0, 12)}…)`, [], s);
	}

	// Sign in and the session lookup every request makes.
	const home = mkdtempSync(join(tmpdir(), 'rv-auth-'));
	const usersFile = join(home, 'users.json');
	await addUser(usersFile, { login: 'cuisiniere', name: 'Cuisinière Test', password: 'mot-de-passe-inventé' });
	const auth: Auth = { users: new UserStore(usersFile), sessions: new SessionStore(join(home, 'sessions.db')), throttle: new Throttle() };
	await decoyHash();
	await timeAsync('sign in (argon2id verify)', async () => {
		const r = await signIn(auth, 'cuisiniere', 'mot-de-passe-inventé', '10.0.0.1');
		if (!r.ok) throw new Error('sign in failed');
	}, 5);
	await timeAsync('sign in, unknown login (decoy)', () => signIn(auth, `inconnu${Math.random()}`, 'mot-de-passe-inventé', '10.0.0.2'), 5);
	let token = '';
	const jar = { get: () => token, set: (_n: string, v: string) => (token = v), delete: () => (token = '') } as unknown as Cookies;
	const headers = new Headers();
	startSession(auth, jar, headers, 'cuisiniere', true);
	for (let k = 0; k < 20; k++) auth.sessions.create('cuisiniere', 'x', true); // a few other devices
	time('session lookup per request', () => {
		if (!currentUser(auth, jar, headers)) throw new Error('no session');
	}, 5000);
	auth.sessions.close();
	rmSync(home, { recursive: true, force: true });
}
