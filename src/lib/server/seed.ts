// The seed registry (docs/INGREDIENTS-SEED.yaml, plan 03 Q5): written into a
// new vault by `vault init`, added to an existing one by `vault ingredients
// seed` without touching an entry already there.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMap, isNode, isScalar, isSeq, parse, parseDocument, stringify, type Document } from 'yaml';
import { parseIngredient, REGISTRY_KEYS, serializeIngredient } from '../ingredients/registry';
import type { RegistryEntry } from '../ingredients/types';
import { committed, type VaultContext } from './context';
import { commitPaths } from './git';
import { ingredientPath } from './registry';
import { seedVocab, VOCAB, type SeedVocab } from './vault';

export class SeedError extends Error {}

/**
 * Every entry of the seed file, checked like an ingredient file (the seed must
 * not bring a broken entry into a vault). Throws on any error.
 */
export function seedEntries(seedText: string, allergens?: ReadonlySet<string>): RegistryEntry[] {
	const data = parse(seedText, { version: '1.2' }) as Record<string, Record<string, unknown>>;
	if (!data || typeof data !== 'object') throw new SeedError('the seed is not a mapping of slug → entry.');
	const out: RegistryEntry[] = [];
	for (const [slug, fields] of Object.entries(data)) {
		const { notes, ...fm } = fields ?? {};
		const front = Object.fromEntries(
			[['slug', slug], ...Object.entries(fm)].sort(
				(a, b) => (REGISTRY_KEYS as readonly string[]).indexOf(a[0] as string) - (REGISTRY_KEYS as readonly string[]).indexOf(b[0] as string)
			)
		);
		const text = `---\n${stringify(front, { version: '1.2' })}---\n\n${typeof notes === 'string' ? notes : ''}\n`;
		const { entry, diagnostics } = parseIngredient(text, { fileStem: slug, allergens });
		const bad = diagnostics.filter((d) => d.severity === 'error' || d.code === 'W809' || d.code === 'W811');
		if (!entry || bad.length) throw new SeedError(`seed entry ${slug}: ${bad.map((d) => `${d.code} ${d.path ?? ''} ${d.message}`).join('; ')}`);
		out.push(entry);
	}
	return out;
}

/** Write the seed entries missing from `ingredientsDir`. Returns the relative paths written. */
export function writeSeed(root: string, entries: RegistryEntry[]): string[] {
	const written: string[] = [];
	mkdirSync(join(root, 'ingredients'), { recursive: true });
	for (const e of entries) {
		const rel = ingredientPath(e.slug);
		const abs = join(root, rel);
		if (existsSync(abs)) continue;
		writeFileSync(abs, serializeIngredient(e));
		written.push(rel);
	}
	return written;
}

/** vocab files an older vault may lack (plural rules, allergens, unit conversions, name-word lists, scaling rules): written when absent, never overwritten. */
export function writeMissingVocab(root: string, vocabDoc: string): string[] {
	const seed = seedVocab(vocabDoc);
	const written: string[] = [];
	for (const name of ['normalize.yaml', 'allergens.yaml', 'conversions.yaml', 'participles.yaml', 'descriptors.yaml', 'brands.yaml', 'scaling.yaml'] as (keyof SeedVocab)[]) {
		const rel = `${VOCAB}/${name}`;
		const abs = join(root, rel);
		if (existsSync(abs)) continue;
		mkdirSync(join(root, VOCAB), { recursive: true });
		writeFileSync(abs, seed[name]);
		written.push(rel);
	}
	return written;
}

/**
 * The seed tag labels (docs/VOCAB.md, "Tag labels") an older vault lacks: the
 * whole seed file when `vocab/tag-labels.yaml` is absent, else a label added
 * only to a tag that has none — a label already there is never rewritten, and
 * a file that does not read as YAML is left alone. Returns the path when written.
 */
export function writeMissingTagLabels(root: string, vocabDoc: string): string[] {
	const rel = `${VOCAB}/tag-labels.yaml`;
	const abs = join(root, rel);
	const seed = seedVocab(vocabDoc)['tag-labels.yaml'];
	if (!existsSync(abs)) {
		mkdirSync(join(root, VOCAB), { recursive: true });
		writeFileSync(abs, seed);
		return [rel];
	}
	const text = readFileSync(abs, 'utf8');
	// Typed as a plain Document: nodes are added below (the shape `withLabel` in families.ts writes).
	const doc = parseDocument(text, { version: '1.2' }) as unknown as Document;
	if (doc.errors.length) return [];
	if (doc.contents === null || (isScalar(doc.contents) && (doc.contents.value === null || doc.contents.value === ''))) doc.contents = doc.createNode({});
	const map = doc.contents;
	if (!isMap(map)) return [];
	let added = 0;
	for (const [tag, labels] of Object.entries((parse(seed, { version: '1.2' }) ?? {}) as Record<string, { fr?: string }>)) {
		const had = map.get(tag, true);
		if (!labels?.fr || (isMap(had) && had.get('fr'))) continue;
		if (isMap(had)) had.set('fr', labels.fr);
		else {
			const node = doc.createNode({ fr: labels.fr });
			node.flow = true;
			map.set(tag, node);
		}
		added++;
	}
	if (!added) return [];
	map.flow = false;
	const next = doc.toString({ lineWidth: 0 });
	if (next === text) return [];
	writeFileSync(abs, next);
	return [rel];
}

/**
 * The seed unit words (docs/VOCAB.md, "Unit labels") an older vault lacks: the
 * whole seed file when `vocab/unit-labels.yaml` is absent, else the units, and
 * the languages of a unit, its copy has no word for — a word already there is
 * never rewritten, and a file that does not read as YAML is left alone.
 * Returns the path when written.
 */
export function writeMissingUnitLabels(root: string, vocabDoc: string): string[] {
	const rel = `${VOCAB}/unit-labels.yaml`;
	const abs = join(root, rel);
	const seed = seedVocab(vocabDoc)['unit-labels.yaml'];
	if (!existsSync(abs)) {
		mkdirSync(join(root, VOCAB), { recursive: true });
		writeFileSync(abs, seed);
		return [rel];
	}
	const text = readFileSync(abs, 'utf8');
	const doc = parseDocument(text, { version: '1.2' }) as unknown as Document;
	if (doc.errors.length) return [];
	if (doc.contents === null || (isScalar(doc.contents) && (doc.contents.value === null || doc.contents.value === ''))) doc.contents = doc.createNode({});
	const map = doc.contents;
	if (!isMap(map)) return [];
	let added = 0;
	for (const [unit, words] of Object.entries((parse(seed, { version: '1.2' }) ?? {}) as Record<string, Record<string, unknown>>)) {
		const had = map.get(unit, true);
		if (isMap(had)) {
			for (const [lang, w] of Object.entries(words ?? {})) {
				if (had.get(lang) !== undefined && had.get(lang) !== null) continue;
				had.set(lang, doc.createNode(w, { flow: true }));
				added++;
			}
		} else if (had === undefined || had === null || (isScalar(had) && (had.value === null || had.value === ''))) {
			const node = doc.createNode(words, { flow: true });
			node.flow = true;
			map.set(unit, node);
			added++;
		}
	}
	if (!added) return [];
	map.flow = false;
	const next = doc.toString({ lineWidth: 0 });
	if (next === text) return [];
	writeFileSync(abs, next);
	return [rel];
}

/**
 * The ladder rungs added to the seed after vaults were first given
 * `vocab/scaling.yaml` (docs/VOCAB.md, "Scaling"), by the unit they step down
 * from: a quart and a pint shown in cups (owner, 2026-09-30).
 */
export const LADDER_ADDED = ['qt', 'pint'] as const;

/**
 * Those rungs, added to a vault's `vocab/scaling.yaml` that has a `ladder` and
 * no rung down into that unit yet. A file without a ladder, one that does not
 * read, or a rung the vault already has are left alone; nothing else is
 * touched. Returns the path when written. (A missing file is
 * `writeMissingVocab`'s: the whole seed.)
 */
export function writeMissingLadder(root: string, vocabDoc: string): string[] {
	const rel = `${VOCAB}/scaling.yaml`;
	const abs = join(root, rel);
	if (!existsSync(abs)) return [];
	const text = readFileSync(abs, 'utf8');
	const doc = parseDocument(text, { version: '1.2' }) as unknown as Document;
	if (doc.errors.length || !isMap(doc.contents)) return [];
	const ladder = doc.contents.get('ladder', true);
	if (!isSeq(ladder)) return [];
	const has = new Set(ladder.items.map((r) => (isMap(r) ? r.get('into') : undefined)));
	const seedText = seedVocab(vocabDoc)['scaling.yaml'];
	const seed = (parse(seedText, { version: '1.2' }) as { ladder?: Record<string, unknown>[] })?.ladder ?? [];
	const rungs = LADDER_ADDED.filter((into) => !has.has(into) && seed.some((r) => r.into === into));
	if (!rungs.length) return [];
	const last = ladder.items.at(-1);
	let next: string;
	if (!ladder.flow && last && isNode(last) && last.range) {
		// As lines after the last rung, the way the seed writes them: the rest of the file stays byte for byte.
		const end = last.range[1];
		const lineStart = text.lastIndexOf('\n', end - 1) + 1;
		const indent = /^[ \t]*/.exec(text.slice(lineStart))![0];
		const lines = rungs.map((into) => `${indent}- ${stringify(seed.find((r) => r.into === into), { version: '1.2', collectionStyle: 'flow' }).trim()}`);
		const eol = text.indexOf('\n', end);
		const at = eol === -1 ? text.length : eol;
		next = text.slice(0, at) + lines.map((l) => `\n${l}`).join('') + text.slice(at);
	} else {
		for (const into of rungs) ladder.items.push(doc.createNode(seed.find((r) => r.into === into), { flow: true }));
		next = doc.toString({ lineWidth: 0 });
	}
	if (next === text) return [];
	writeFileSync(abs, next);
	return [rel];
}

/**
 * `vault ingredients seed`: add the missing seed entries and vocab files to a
 * vault, in one commit `ingredients: seed (N entries)`. Holds the lock.
 */
export function seedVault(ctx: VaultContext, seedText: string, vocabDoc: string): Promise<{ added: string[]; vocab: string[]; commit?: string }> {
	return ctx.lock.run(async () => {
		const vocab = [
			...writeMissingVocab(ctx.paths.root, vocabDoc),
			...writeMissingLadder(ctx.paths.root, vocabDoc),
			...writeMissingTagLabels(ctx.paths.root, vocabDoc),
			...writeMissingUnitLabels(ctx.paths.root, vocabDoc)
		];
		const allergens = new Set(Object.keys(parse(seedVocab(vocabDoc)['allergens.yaml'], { version: '1.2' }) ?? {}));
		const added = writeSeed(ctx.paths.root, seedEntries(seedText, allergens));
		const paths = [...vocab, ...added];
		if (!paths.length) return { added, vocab };
		const commit = await commitPaths(ctx.paths.root, paths, `ingredients: seed (${added.length} entries)`, ctx.author);
		committed(ctx);
		return { added, vocab, commit };
	});
}
