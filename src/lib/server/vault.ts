// Vault layout (docs/STORAGE.md): paths, creation, and the seed vocabularies.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { commitPaths, git } from './git';
import type { GitAuthor } from './config';
import { seedEntries, writeSeed } from './seed';

export const RECIPES = 'recipes';
export const INGREDIENTS = 'ingredients';
export const VOCAB = 'vocab';
export const MEDIA = 'media';
export const TRASH = '_trash';
export const CACHE = 'cache';

export interface VaultPaths {
	root: string;
	recipes: string;
	ingredients: string;
	vocab: string;
	media: string;
	trash: string;
	cache: string;
	index: string;
	pasteLog: string;
}

export function vaultPaths(root: string): VaultPaths {
	return {
		root,
		recipes: join(root, RECIPES),
		ingredients: join(root, INGREDIENTS),
		vocab: join(root, VOCAB),
		media: join(root, MEDIA),
		trash: join(root, TRASH),
		cache: join(root, CACHE),
		index: join(root, CACHE, 'index.db'),
		pasteLog: join(root, CACHE, 'paste-log.jsonl')
	};
}

/** `.gitignore` written into a new vault. Trashed media folders stay out of git too. */
export const VAULT_GITIGNORE = `# Written by RecipeVault — see docs/STORAGE.md in the app repository.
media/
_trash/*/
cache/
inbox/
.obsidian/workspace*.json
`;

/** The YAML code blocks of docs/VOCAB.md under a given `## ` heading. */
function yamlBlocksUnder(doc: string, heading: string): string {
	const lines = doc.replace(/\r\n?/g, '\n').split('\n');
	const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
	if (start === -1) throw new Error(`docs/VOCAB.md has no "## ${heading}" section`);
	const out: string[] = [];
	let inYaml = false;
	for (let i = start + 1; i < lines.length && !/^##\s/.test(lines[i]); i++) {
		if (!inYaml && /^```yaml\s*$/.test(lines[i])) inYaml = true;
		else if (inYaml && /^```\s*$/.test(lines[i])) inYaml = false;
		else if (inYaml) out.push(lines[i]);
	}
	return out.join('\n') + '\n';
}

export interface SeedVocab {
	'tags.yaml': string;
	'units.yaml': string;
	'families.yaml': string;
	'normalize.yaml': string;
	'allergens.yaml': string;
}

/** The seed vocabularies, copied from docs/VOCAB.md (the doc is the seed). */
export function seedVocab(vocabDoc: string): SeedVocab {
	const tags = yamlBlocksUnder(vocabDoc, 'Tags');
	const units = yamlBlocksUnder(vocabDoc, 'Units');
	const plurals = yamlBlocksUnder(vocabDoc, 'Plurals');
	const allergens = yamlBlocksUnder(vocabDoc, 'Allergens');
	// Validate before writing: a broken seed would break every later read.
	for (const [name, text] of [
		['tags', tags],
		['units', units],
		['plurals', plurals],
		['allergens', allergens]
	]) {
		const data = parse(text, { version: '1.2' });
		if (!data || typeof data !== 'object') throw new Error(`docs/VOCAB.md: the ${name} block is not a YAML mapping`);
	}
	return {
		'tags.yaml': `# Canonical tag: [aliases]. Seeded from docs/VOCAB.md; grows with the vault.\n${tags}`,
		'units.yaml': `# Canonical unit: [aliases]. Seeded from docs/VOCAB.md. The checker's list is\n# the authority for validation; this copy documents the vault.\n${units}`,
		'families.yaml': `# Canonical family slug: { fr: label, en: label }. Grows as families are created.\n{}\n`,
		'normalize.yaml': `# How ingredient names lose their plurals before registry lookup. Seeded from\n# docs/VOCAB.md ("Plurals"); an exact alias match always comes first.\n${plurals}`,
		'allergens.yaml': `# Allergen slug: { fr: label, en: label }. Seeded from docs/VOCAB.md ("Allergens").\n${allergens}`
	};
}

export class VaultInitError extends Error {}

/**
 * Create a vault: the layout, its .gitignore, the seed vocabularies, the seed
 * ingredient registry when given (docs/INGREDIENTS-SEED.yaml), a git
 * repository and a first commit. Refuses a non-empty directory unless all it
 * holds is `inbox/` (files waiting to be imported).
 */
export async function initVault(dir: string, vocabDoc: string, author: GitAuthor, seedText?: string): Promise<void> {
	if (existsSync(dir)) {
		const entries = readdirSync(dir).filter((e) => e !== 'inbox');
		if (entries.length)
			throw new VaultInitError(`${dir} is not empty (${entries.slice(0, 5).join(', ')}${entries.length > 5 ? ', …' : ''}); refusing to create a vault there.`);
	}
	const vocab = seedVocab(vocabDoc);
	const p = vaultPaths(dir);
	for (const d of [p.root, p.recipes, p.ingredients, p.vocab, p.media, p.trash, p.cache]) mkdirSync(d, { recursive: true });
	// git does not track empty folders; keep the text ones in the first commit.
	for (const d of [p.recipes, p.ingredients, p.trash]) writeFileSync(join(d, '.gitkeep'), '');
	writeFileSync(join(dir, '.gitignore'), VAULT_GITIGNORE);
	for (const [name, text] of Object.entries(vocab)) writeFileSync(join(p.vocab, name), text);
	if (seedText !== undefined) {
		const allergens = new Set(Object.keys((parse(vocab['allergens.yaml'], { version: '1.2' }) as object) ?? {}));
		writeSeed(dir, seedEntries(seedText, allergens));
	}
	await git(dir, ['init', '--quiet', '--initial-branch=main']);
	await commitPaths(dir, ['.gitignore', RECIPES, INGREDIENTS, VOCAB, TRASH], 'init: new vault', author);
}
