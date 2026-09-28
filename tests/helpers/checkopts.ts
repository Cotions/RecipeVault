// Check options from the seed vocabularies of docs/VOCAB.md, as a new vault
// gets them: the name-word lists (W302 / W304 / W607) and the tag vocabulary
// (W501). Families (W502) are the caller's.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedVocab } from '../../src/lib/server/vault';
import { loadVocab, seedCheckWords } from '../../src/lib/server/vocab';
import type { CheckOptions } from '../../src/lib/vault/check';

export const VOCAB_DOC = readFileSync('docs/VOCAB.md', 'utf8');

/** vocab/tags.yaml of a new vault, read the way the server reads it. */
export function seedTags(): ReadonlyMap<string, string> {
	const dir = mkdtempSync(join(tmpdir(), 'rv-vocab-'));
	try {
		for (const [name, text] of Object.entries(seedVocab(VOCAB_DOC))) writeFileSync(join(dir, name), text);
		return loadVocab(dir).tags;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

export function seedCheckOptions(families: string[] = []): CheckOptions {
	return { words: seedCheckWords(VOCAB_DOC), vocab: { tags: seedTags(), families } };
}
