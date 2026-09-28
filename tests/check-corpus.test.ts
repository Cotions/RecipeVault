// The Phase 8 checker codes on the invented corpus (plan 03, Phase 8): how
// many warnings each new code gives on 320 cards written to the template, with
// the seed word lists, the seed tag vocabulary, the corpus's own families and
// the seed registry. Warnings are expected; an error is not. Counts are
// printed for the report; only "no error" and a few ceilings are asserted, so
// a list change that floods the paste box shows up here.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { parseNormalizeVocab } from '../src/lib/ingredients/normalize';
import { nameRows, Resolver, ruleRows } from '../src/lib/ingredients/resolve';
import { toTasteDiagnostics } from '../src/lib/ingredients/totaste';
import { seedEntries } from '../src/lib/server/seed';
import { seedVocab } from '../src/lib/server/vault';
import { seedCheckWords } from '../src/lib/server/vocab';
import { checkFile } from '../src/lib/vault/check';
import type { Diagnostic } from '../src/lib/vault/types';
import { seedTags, VOCAB_DOC } from './helpers/checkopts';

const DIR = 'tests/fixtures/corpus/recipes';
const NEW = ['W302', 'W304', 'W501', 'W502', 'W606', 'W607'];

describe('Phase 8 codes on the corpus', () => {
	const files = readdirSync(DIR).filter((f) => f.endsWith('.md')).sort();
	const texts = files.map((f) => readFileSync(join(DIR, f), 'utf8'));
	const words = seedCheckWords(VOCAB_DOC);
	const tags = seedTags();
	// Every family in the corpus, per file without the families only that file uses.
	const familyOf = texts.map((t) => checkFile(t).frontmatter?.family as string | undefined);
	const uses = new Map<string, number>();
	for (const f of familyOf) if (f) uses.set(f, (uses.get(f) ?? 0) + 1);
	const plurals = parseNormalizeVocab(parse(seedVocab(VOCAB_DOC)['normalize.yaml'])).plurals;
	const seed = seedEntries(readFileSync('docs/INGREDIENTS-SEED.yaml', 'utf8'));
	const resolver = new Resolver(nameRows(seed, plurals), plurals, [], ruleRows(seed));
	const auGout = new Set(seed.filter((e) => e.auGout).map((e) => e.slug));

	const results = texts.map((text, i) => {
		const own = familyOf[i];
		const families = [...uses].filter(([f, n]) => f !== own || n > 1).map(([f]) => f);
		const r = checkFile(text, { words, vocab: { tags, families } });
		const extra: Diagnostic[] = r.recipe ? toTasteDiagnostics(r.recipe, resolver, auGout) : [];
		return { file: files[i], diagnostics: [...r.diagnostics, ...extra] };
	});

	it('leaves the corpus error-free and counts each new code', () => {
		expect(results.filter((r) => r.diagnostics.some((d) => d.severity === 'error')).map((r) => r.file)).toEqual([]);
		const count = (code: string) => results.flatMap((r) => r.diagnostics).filter((d) => d.code === code);
		const lines = NEW.map((code) => {
			const ds = count(code);
			const recipes = new Set(results.filter((r) => r.diagnostics.some((d) => d.code === code)).map((r) => r.file)).size;
			const what = new Map<string, number>();
			for (const d of ds) {
				const k = d.message.match(/`([^`]+)`/)?.[1] ?? d.message;
				what.set(k, (what.get(k) ?? 0) + 1);
			}
			const top = [...what].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ×${n}`).join(', ');
			return `${code}: ${ds.length} warnings in ${recipes} of ${files.length} recipes${top ? ` — ${top}` : ''}`;
		});
		console.log(`Phase 8 codes on the corpus:\n  ${lines.join('\n  ')}`);
		// Ceilings: a word list that starts flagging product names floods the paste box.
		for (const code of NEW) expect(count(code).length, code).toBeLessThan(files.length / 4);
	});
});
