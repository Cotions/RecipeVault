// Scale fixture: write N invented recipes (some using an earlier one as a
// sub-recipe), ~1000 registry entries and ~3000 price rows into a new
// temporary vault, then (with --bench) time the index against the plan's targets.
//
//   npx tsx scripts/gen-vault.ts [N=5000] [--dir /tmp/x] [--bench]
//
// Everything is random combinations of invented words — no real recipe.

import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { openVault } from '../src/lib/server/context';
import { browse } from '../src/lib/server/index/query';
import { syncVault } from '../src/lib/server/index/sync';
import { getResolver, reresolve } from '../src/lib/server/index/resolve';
import { serializeIngredient } from '../src/lib/ingredients/registry';
import { lookupKey } from '../src/lib/ingredients/normalize';
import { loadVocab } from '../src/lib/server/vocab';
import { queueCount, resolveQueue } from '../src/lib/server/queue';
import { costOfRecipe } from '../src/lib/server/cost';
import { ingredientView } from '../src/lib/server/ingredient';
import { ingredientIndex, INDEX_SORTS } from '../src/lib/server/ingredients';
import { appendPrice } from '../src/lib/server/prices';
import { PRICE_HEADER } from '../src/lib/ingredients/prices';
import { loadConversions } from '../src/lib/server/vocab';
import { initVault } from '../src/lib/server/vault';
import { commitPaths } from '../src/lib/server/git';

const args = process.argv.slice(2);
const n = Number(args.find((a) => /^\d+$/.test(a)) ?? 5000);
/** Registry size: the seed, plus invented entries up to this many. */
const REGISTRY = 1000;
/** Rows in prices.csv (plan 03, "Speed targets"). */
const PRICE_ROWS = 3000;
/** Share of recipes using an earlier one as a sub-recipe. */
const SUB_SHARE = 0.1;
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
	const items = some(ING, 4 + Math.floor(rand() * 8)).map((name) => {
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
		`tags: [${some(TAGS, 2 + Math.floor(rand() * 3)).join(', ')}]`,
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
const seeded = readdirSync(join(dir, 'ingredients')).length;
for (let k = seeded; k < REGISTRY; k++) {
	const name = `${word()} ${word()}`;
	const slug = `inv-${k}-${lookupKey(name).replace(/[^a-z0-9]+/g, '-')}`;
	writeFileSync(
		join(dir, 'ingredients', `${slug}.md`),
		serializeIngredient({ slug, category: 'epicerie', names: { fr: [name, `${name}s`], en: [] }, staple: false, auGout: false, weights: {}, substitutes: [], allergens: [], body: '' })
	);
}
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
const slugs = readdirSync(join(dir, 'ingredients')).map((f) => f.replace(/\.md$/, ''));
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
	const f = join(dir, 'ingredients', 'sucre.md');
	let alias = 0;
	time(
		'one alias edit: registry sync + re-resolve',
		() => {
			writeFileSync(f, readFileSync(f, 'utf8').replace(/^ {2}fr: \[/m, `  fr: [sucre ${++alias}, `));
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
	// A real vault has every file committed: git's first look at 6000 untracked files is not what an append costs.
	await commitPaths(dir, ['recipes', 'ingredients', 'prices.csv'], 'scale fixture', { name: 'Scale Test', email: 'scale@example.invalid' });
	const appends: number[] = [];
	for (let k = 0; k < 5; k++) {
		const t = performance.now();
		await appendPrice(ctx, { ingredient: 'farine-tout-usage', amount: 4.99 + k, packQty: 2.5, packUnit: 'kg', shop: 'Magasin 1' });
		appends.push(performance.now() - t);
	}
	const sorted = [...appends].sort((a, b) => a - b);
	console.log(`${'append one price and commit'.padEnd(34)} ${sorted[2].toFixed(1)} ms (median of 5; ${appends.map((a) => a.toFixed(0)).join(', ')})`);
	ctx.db.close();
}
