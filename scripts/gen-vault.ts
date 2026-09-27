// Scale fixture: write N invented recipes into a new temporary vault, then
// (with --bench) time the index against the plan's targets.
//
//   npx tsx scripts/gen-vault.ts [N=5000] [--dir /tmp/x] [--bench]
//
// Everything is random combinations of invented words — no real recipe.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { openVault } from '../src/lib/server/context';
import { browse } from '../src/lib/server/index/query';
import { syncVault } from '../src/lib/server/index/sync';
import { initVault } from '../src/lib/server/vault';

const args = process.argv.slice(2);
const n = Number(args.find((a) => /^\d+$/.test(a)) ?? 5000);
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

function recipe(i: number): { slug: string; text: string } {
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
		`servings: ${2 + Math.floor(rand() * 10)}`,
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

await initVault(dir, readFileSync('docs/VOCAB.md', 'utf8'), { name: 'Scale Test', email: 'scale@example.invalid' });
const seen = new Set<string>();
for (let i = 1; i <= n; i++) {
	const r = recipe(i);
	if (seen.has(r.slug)) continue;
	seen.add(r.slug);
	writeFileSync(join(dir, 'recipes', `${r.slug}.md`), r.text);
}
console.log(`${seen.size} recipes written to ${dir}`);

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
	ctx.db.close();
}
