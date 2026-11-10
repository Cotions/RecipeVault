// W501's lookup (src/lib/vault/rules/vaultvocab.ts): a tag that differs from a
// known one by accents, case or spaces only is that tag (no W501, and the
// paste preview names it by the vault's label); a near miss is suggested, so
// the paste box offers it preselected. Invented vocabulary.
import { describe, expect, it } from 'vitest';
import { suggestTag, tagFor, vocabDiagnostics } from '../../src/lib/vault/rules/vaultvocab';
import { fold } from '../../src/lib/vault/normalize';

// As loadVocab builds it: every folded canonical tag and alias → its canonical tag.
const tags = new Map<string, string>(
	[
		['quebecois', 'quebecois'],
		['québécoise', 'quebecois'],
		['pate-a-choux', 'pate-a-choux'],
		['pâte à choux', 'pate-a-choux'],
		['dessert', 'dessert']
	].map(([alias, canonical]) => [fold(alias), canonical])
);

describe('tag lookup', () => {
	it('accents, case and spaces aside, a known tag is that tag: no W501', () => {
		for (const written of ['Quebecois', 'QUÉBÉCOIS', 'québécois', 'Québécoise', 'Pâte à choux', 'pate-a-choux', 'PATE A CHOUX'])
			expect(tagFor(tags, written), written).toBeDefined();
		expect(vocabDiagnostics({ tags: ['Quebecois', 'Pâte À Choux', 'DESSERT'] }, { tags })).toEqual([]);
	});

	it('a near miss is suggested (the quick fix preselects it); a different word is not', () => {
		expect(suggestTag(tags, 'Quebecoi')).toBe('quebecois');
		expect(suggestTag(tags, 'Désert')).toBe('dessert');
		expect(suggestTag(tags, 'erable')).toBeUndefined();
		const [d] = vocabDiagnostics({ tags: ['Quebecoi'] }, { tags });
		expect([d.code, d.path]).toEqual(['W501', 'tags[0]']);
		expect(d.fix).toContain('`quebecois`');
	});
});
