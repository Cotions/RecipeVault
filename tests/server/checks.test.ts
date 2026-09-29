// Plan 03, Phase 8: the checker codes that need vault data, on the server —
// the word lists travel with the paste page (W302 / W304 / W607), the tag and
// family vocabulary (W501 / W502) and the registry (W606).

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../../src/lib/server/app';
import { syncVault } from '../../src/lib/server/index/sync';
import { loadRecipePage } from '../../src/lib/server/pages';
import { serverCheck } from '../../src/lib/server/paste';
import { save } from '../../src/lib/server/save';
import { writeMissingVocab } from '../../src/lib/server/seed';
import { loadCheckWords } from '../../src/lib/server/vocab';
import { checkBatch } from '../../src/lib/vault/check';
import { fixtureVault, VOCAB_DOC, type TempVault } from '../helpers/vault';

let v: TempVault;
beforeEach(async () => {
	v = await fixtureVault();
});
afterEach(() => v.cleanup());

const app = () => ({ ctx: v.ctx }) as App;

const recipe = (items: string, extra = '') => `---
schema: 3
title: Recette de la cabane
lang: fr
${extra}ingredients:
  - items:
${items}
extracted_by: ai
---

## Préparation

1. Mélanger.
`;

const only = (codes: string[]) => (ds: { code: string; path: string | null; message: string; fix?: string }[]) =>
	ds.filter((d) => codes.includes(d.code)).map((d) => ({ code: d.code, path: d.path, message: d.message, fix: d.fix }));

describe('name-word lists', () => {
	it('a new vault gets them from docs/VOCAB.md, and an older one gains them without overwriting', () => {
		for (const f of ['participles.yaml', 'descriptors.yaml', 'brands.yaml']) expect(existsSync(join(v.ctx.paths.vocab, f)), f).toBe(true);
		rmSync(join(v.ctx.paths.vocab, 'brands.yaml'));
		writeFileSync(join(v.ctx.paths.vocab, 'participles.yaml'), 'words: [broyé]\n');
		expect(writeMissingVocab(v.dir, VOCAB_DOC)).toEqual(['vocab/brands.yaml']);
		expect(readFileSync(join(v.ctx.paths.vocab, 'participles.yaml'), 'utf8')).toBe('words: [broyé]\n');
		expect(loadCheckWords(v.ctx.paths.vocab).participles?.words).toEqual([['broye']]);
	});

	it('the browser check with the page’s lists gives what /api/check gives (W302, W304, W607)', () => {
		const texts = [
			recipe(`      - { qty: 1, unit: piece, name: gros oignon haché }
      - { qty: 1, unit: lb, name: porc haché }
      - { qty: 1, unit: cup, name: ketchup Heinz, or: [sauce chili Heinz] }
      - { qty: 1, unit: cup, name: gruyère râpé }`)
		];
		const pick = only(['W302', 'W304', 'W607']);
		const server = pick(serverCheck(app(), texts)[0].diagnostics);
		// What src/routes/ajouter/+page.server.ts hands the page, through JSON as SvelteKit would.
		const words = JSON.parse(JSON.stringify(loadCheckWords(v.ctx.paths.vocab)));
		const browser = pick(checkBatch(texts.map((text, i) => ({ name: `recipe ${i + 1}`, text })), { words }).files[0].diagnostics);
		expect(server.map((d) => [d.code, d.path])).toEqual([
			['W302', 'ingredients[0].items[0].name'],
			['W304', 'ingredients[0].items[0].name'],
			['W607', 'ingredients[0].items[2].name'],
			['W607', 'ingredients[0].items[2].or[0]'],
			['W302', 'ingredients[0].items[3].name']
		]);
		expect(browser).toEqual(server);
	});

	it('follow the vault’s own lists: an edited file changes the check', () => {
		const text = recipe('      - { qty: 1, unit: cup, name: ananas broyé }');
		expect(only(['W302'])(serverCheck(app(), [text])[0].diagnostics)).toEqual([]);
		writeFileSync(join(v.ctx.paths.vocab, 'participles.yaml'), 'words: { fr: [broyé] }\n');
		expect(only(['W302'])(serverCheck(app(), [text])[0].diagnostics).map((d) => d.code)).toEqual(['W302']);
	});
});

describe('W501 / W502', () => {
	it('in the paste check: an unknown tag, a family near an existing one', () => {
		const text = recipe('      - { qty: 1, unit: cup, name: farine }', 'family: lasagne\nvariant: de la cabane\ntags: [dessert, desert]\n');
		expect(only(['W501', 'W502'])(serverCheck(app(), [text])[0].diagnostics).map((d) => [d.code, d.path])).toEqual([
			['W502', 'family'],
			['W501', 'tags[1]']
		]);
		// An existing family is not a drift.
		const same = recipe('      - { qty: 1, unit: cup, name: farine }', 'family: lasagna\nvariant: de la cabane\n');
		expect(only(['W502'])(serverCheck(app(), [same])[0].diagnostics)).toEqual([]);
	});

	it('in the save result, as warnings: the recipe is saved', async () => {
		const r = await save(v.ctx, [{ text: recipe('      - { qty: 1, unit: cup, name: farine }', 'tags: [desert]\n') }]);
		expect(r.files[0].status).toBe('saved');
		expect(r.files[0].diagnostics.map((d) => d.code)).toContain('W501');
	});

	it('on the recipe page, re-derived when the vocabulary changes, with no recipe file read', () => {
		expect(loadRecipePage(app(), 'tarte-au-sucre')!.vocab.map((d) => [d.code, d.path])).toEqual([['W501', 'tags[1]']]);
		const tags = join(v.ctx.paths.vocab, 'tags.yaml');
		writeFileSync(tags, readFileSync(tags, 'utf8') + 'cabane-a-sucre:   [sugar-shack]\n');
		const r = syncVault(v.ctx.db, v.ctx.paths);
		expect(r.indexed).toBe(0);
		expect(loadRecipePage(app(), 'tarte-au-sucre')!.vocab).toEqual([]);
	});

	it('W502 on the page: a family only this recipe uses, next to one others use', () => {
		const f = join(v.dir, 'recipes/lasagna-courgettes.md');
		writeFileSync(f, readFileSync(f, 'utf8').replace('family: lasagna', 'family: lasagnas'));
		syncVault(v.ctx.db, v.ctx.paths);
		expect(loadRecipePage(app(), 'lasagna-courgettes')!.vocab.map((d) => [d.code, d.path])).toEqual([['W502', 'family']]);
		// The recipes of the family it drifted from are not flagged: theirs exists.
		expect(loadRecipePage(app(), 'lasagna-bolognaise')!.vocab).toEqual([]);
	});

	it('W502 when the recipe is pasted again over itself, and in the save result, as on its page', async () => {
		const f = join(v.dir, 'recipes/lasagna-courgettes.md');
		writeFileSync(f, readFileSync(f, 'utf8').replace('family: lasagna', 'family: lasagnas'));
		syncVault(v.ctx.db, v.ctx.paths);
		const text = readFileSync(f, 'utf8');
		expect(only(['W502'])(serverCheck(app(), [text])[0].diagnostics).map((d) => [d.code, d.path])).toEqual([['W502', 'family']]);
		const hash = v.ctx.db.prepare('SELECT file_hash FROM recipes WHERE slug = ?').pluck().get('lasagna-courgettes') as string;
		const r = await save(v.ctx, [{ text: text.replace('## Préparation', '## Préparation\n'), overwrite: hash }]);
		expect(r.files[0].diagnostics.map((d) => d.code)).toContain('W502');
		// Another recipe using that family is near it too: a family two recipes share is theirs.
		expect(only(['W502'])(serverCheck(app(), [text.replace(/^slug: .*\n/m, '').replace(/^title: .*$/m, 'title: Autre lasagne')])[0].diagnostics)).toEqual([]);
	});
});

describe('W606', () => {
	it('to_taste on an entry the registry does not mark au_gout; not on salt, not on an unresolved name', () => {
		const text = recipe(`      - { name: sel, to_taste: true }
      - { name: farine, to_taste: true }
      - { name: poudre de perlimpinpin, to_taste: true }`);
		const ds = only(['W606'])(serverCheck(app(), [text])[0].diagnostics);
		expect(ds.map((d) => [d.code, d.path])).toEqual([['W606', 'ingredients[0].items[1].to_taste']]);
	});

	it('not on an item: override naming no registry entry: that is W307', () => {
		const text = recipe(`      - { name: sel de mer, item: sel-mer-invente, to_taste: true }
      - { name: farine fine, item: farine, to_taste: true }`);
		const ds = serverCheck(app(), [text])[0].diagnostics;
		expect(only(['W606', 'W307'])(ds).map((d) => [d.code, d.path])).toEqual([
			['W307', 'ingredients[0].items[0].item'],
			['W606', 'ingredients[0].items[1].to_taste']
		]);
	});

	it('is an `ai` code that reaches the fix-request block through the server check', async () => {
		const { aiDiagnostics } = await import('../../src/lib/vault/fixblock');
		const text = recipe('      - { name: farine, to_taste: true }');
		expect(aiDiagnostics(serverCheck(app(), [text])[0].diagnostics).map((d) => d.code)).toContain('W606');
	});

	it('follows the registry: marking the entry au_gout clears it', () => {
		const text = recipe('      - { name: farine, to_taste: true }');
		expect(only(['W606'])(serverCheck(app(), [text])[0].diagnostics)).toHaveLength(1);
		const f = join(v.dir, 'ingredients/farine.md');
		writeFileSync(f, readFileSync(f, 'utf8').replace(/^category: (.*)$/m, 'category: $1\nau_gout: true'));
		syncVault(v.ctx.db, v.ctx.paths);
		expect(only(['W606'])(serverCheck(app(), [text])[0].diagnostics)).toEqual([]);
	});
});
