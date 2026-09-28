// The seed registry (docs/INGREDIENTS-SEED.yaml, plan 03 Q5): written into a
// new vault by `vault init`, added to an existing one by `vault ingredients
// seed` without touching an entry already there.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { parseIngredient, REGISTRY_KEYS, serializeIngredient } from '../ingredients/registry';
import type { RegistryEntry } from '../ingredients/types';
import type { VaultContext } from './context';
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

/** vocab files an older vault may lack (plural rules, allergens, unit conversions, name-word lists): written when absent, never overwritten. */
export function writeMissingVocab(root: string, vocabDoc: string): string[] {
	const seed = seedVocab(vocabDoc);
	const written: string[] = [];
	for (const name of ['normalize.yaml', 'allergens.yaml', 'conversions.yaml', 'participles.yaml', 'descriptors.yaml', 'brands.yaml'] as (keyof SeedVocab)[]) {
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
 * `vault ingredients seed`: add the missing seed entries and vocab files to a
 * vault, in one commit `ingredients: seed (N entries)`. Holds the lock.
 */
export function seedVault(ctx: VaultContext, seedText: string, vocabDoc: string): Promise<{ added: string[]; commit?: string }> {
	return ctx.lock.run(async () => {
		const vocab = writeMissingVocab(ctx.paths.root, vocabDoc);
		const allergens = new Set(Object.keys(parse(seedVocab(vocabDoc)['allergens.yaml'], { version: '1.2' }) ?? {}));
		const added = writeSeed(ctx.paths.root, seedEntries(seedText, allergens));
		const paths = [...vocab, ...added];
		if (!paths.length) return { added };
		const commit = await commitPaths(ctx.paths.root, paths, `ingredients: seed (${added.length} entries)`, ctx.author);
		ctx.pusher.schedule();
		return { added, commit };
	});
}
