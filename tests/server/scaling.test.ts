// Plan 05, Phase 1: vocab/scaling.yaml and vocab/unit-labels.yaml in a vault —
// written by `vault init`, added by `vault ingredients seed`, never over what a
// vault already has; loaded with the recipe and kitchen pages.

import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../../src/lib/server/app';
import { loadRecipePage } from '../../src/lib/server/pages';
import { save } from '../../src/lib/server/save';
import { seedVault, writeMissingUnitLabels } from '../../src/lib/server/seed';
import { seedVocab } from '../../src/lib/server/vault';
import { loadScaling, loadUnitWords } from '../../src/lib/server/vocab';
import { parseScaling } from '../../src/lib/render/scale';
import { parse } from 'yaml';
import { recipe, tempVault, VOCAB_DOC, type TempVault } from '../helpers/vault';

let v: TempVault;
beforeEach(async () => {
	v = await tempVault();
});
afterEach(() => v.cleanup());

describe('scaling rules and unit words in a vault', () => {
	it('a new vault holds both files, exactly the seed blocks', () => {
		const seed = seedVocab(VOCAB_DOC);
		expect(v.read('vocab/scaling.yaml')).toBe(seed['scaling.yaml']);
		expect(v.read('vocab/unit-labels.yaml')).toBe(seed['unit-labels.yaml']);
		expect(loadScaling(v.ctx.paths.vocab)).toEqual(parseScaling(parse(seed['scaling.yaml'], { version: '1.2' })));
		expect(loadUnitWords(v.ctx.paths.vocab).cup).toEqual({ fr: ['tasse', 'tasses'], en: ['cup', 'cups'] });
		expect(v.git('ls-files', 'vocab').split('\n')).toEqual(expect.arrayContaining(['vocab/scaling.yaml', 'vocab/unit-labels.yaml']));
	});

	it('an older vault gains both from `vault ingredients seed`, in one commit', async () => {
		rmSync(join(v.dir, 'vocab/scaling.yaml'));
		rmSync(join(v.dir, 'vocab/unit-labels.yaml'));
		v.git('commit', '-qam', 'older vault');
		expect(loadScaling(v.ctx.paths.vocab)).toBeNull();
		expect(loadUnitWords(v.ctx.paths.vocab)).toEqual({});
		const r = await seedVault(v.ctx, '{}\n', VOCAB_DOC);
		expect(v.git('show', '--name-only', '--format=', r.commit!).trim().split('\n').sort()).toEqual(['vocab/scaling.yaml', 'vocab/unit-labels.yaml']);
		expect(loadScaling(v.ctx.paths.vocab)).not.toBeNull();
	});

	it('never over a scaling file the vault has', async () => {
		writeFileSync(join(v.dir, 'vocab/scaling.yaml'), 'tolerance: 0.2\n');
		v.git('commit', '-qam', 'own rules');
		await seedVault(v.ctx, '{}\n', VOCAB_DOC);
		expect(v.read('vocab/scaling.yaml')).toBe('tolerance: 0.2\n');
	});

	it('adds only the units and languages the vault’s words lack', () => {
		writeFileSync(join(v.dir, 'vocab/unit-labels.yaml'), '# à moi\ntbsp: { fr: c. à soupe }\ncup: { en: mug }\n');
		expect(writeMissingUnitLabels(v.dir, VOCAB_DOC)).toEqual(['vocab/unit-labels.yaml']);
		const w = loadUnitWords(v.ctx.paths.vocab);
		expect(w.tbsp).toEqual({ fr: ['c. à soupe', 'c. à soupe'], en: ['tbsp', 'tbsp'] });
		expect(w.cup).toEqual({ fr: ['tasse', 'tasses'], en: ['mug', 'mug'] });
		expect(w.can).toEqual({ fr: ['boîte', 'boîtes'], en: ['can', 'cans'] });
		expect(v.read('vocab/unit-labels.yaml').startsWith('# à moi\ntbsp: { fr: c. à soupe, en: tbsp }\n')).toBe(true);
		expect(writeMissingUnitLabels(v.dir, VOCAB_DOC)).toEqual([]);
		// A file that does not read is left alone.
		writeFileSync(join(v.dir, 'vocab/unit-labels.yaml'), 'tbsp: { fr: \n');
		expect(writeMissingUnitLabels(v.dir, VOCAB_DOC)).toEqual([]);
		rmSync(join(v.dir, 'vocab/unit-labels.yaml'));
		expect(writeMissingUnitLabels(v.dir, VOCAB_DOC)).toEqual(['vocab/unit-labels.yaml']);
		expect(existsSync(join(v.dir, 'vocab/unit-labels.yaml'))).toBe(true);
	});

	it('the recipe page receives the rules; a broken file gives null', async () => {
		await save(v.ctx, [{ text: recipe('Galette inventée') }]);
		expect(loadRecipePage({ ctx: v.ctx } as App, 'galette-inventee')!.scaling?.fractions.cup).toHaveLength(5);
		writeFileSync(join(v.dir, 'vocab/scaling.yaml'), 'tolerance: [\n');
		expect(loadRecipePage({ ctx: v.ctx } as App, 'galette-inventee')!.scaling).toBeNull();
	});
});
