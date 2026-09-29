// The live vocabularies in the vault's vocab/ folder (docs/VOCAB.md): tag
// aliases and labels, family labels, the plural rules, the allergen list and the unit
// conversion factors. Read at index time; a missing or broken file
// means an empty vocabulary, never a failed sync.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { fold } from '../vault/normalize';
import { tagFor } from '../vault/rules/vaultvocab';
import { parseWordList, type CheckWords } from '../vault/words';
import { seedVocab } from './vault';
import { parseNormalizeVocab, type NormalizeVocab } from '../ingredients/normalize';
import { parseConversions, type Conversions } from '../ingredients/units';

export interface VaultVocab {
	/** Folded alias or canonical tag → canonical tag. */
	tags: Map<string, string>;
	families: Map<string, { fr?: string; en?: string }>;
	/** vocab/tag-labels.yaml: canonical tag → display labels (a tag without one shows its slug). */
	tagLabels: Map<string, { fr?: string; en?: string }>;
	/** vocab/normalize.yaml: plural rules for ingredient lookup keys. */
	normalize: NormalizeVocab;
	/** vocab/allergens.yaml: allergen slug → labels. */
	allergens: Map<string, { fr?: string; en?: string }>;
	/** vocab/conversions.yaml: unit factors for cost. */
	conversions: Conversions;
}

function readYaml(file: string): unknown {
	try {
		return parse(readFileSync(file, 'utf8'), { version: '1.2' });
	} catch {
		return undefined;
	}
}

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function loadVocab(vocabDir: string): VaultVocab {
	const tags = new Map<string, string>();
	const t = readYaml(join(vocabDir, 'tags.yaml'));
	if (isMap(t)) {
		for (const [canonical, aliases] of Object.entries(t)) {
			tags.set(fold(canonical), canonical);
			if (Array.isArray(aliases))
				for (const a of aliases) if (typeof a === 'string' && !tags.has(fold(a))) tags.set(fold(a), canonical);
		}
	}
	return {
		tags,
		families: labelMap(readYaml(join(vocabDir, 'families.yaml'))),
		tagLabels: labelMap(readYaml(join(vocabDir, 'tag-labels.yaml'))),
		normalize: parseNormalizeVocab(readYaml(join(vocabDir, 'normalize.yaml'))),
		allergens: labelMap(readYaml(join(vocabDir, 'allergens.yaml'))),
		conversions: loadConversions(vocabDir)
	};
}

/** vocab/conversions.yaml alone; missing or broken: no conversions (same-unit prices still work). */
export function loadConversions(vocabDir: string): Conversions {
	return parseConversions(readYaml(join(vocabDir, 'conversions.yaml')));
}

/**
 * The word lists of W302 / W304 / W607 (vocab/participles.yaml,
 * descriptors.yaml, brands.yaml). A missing or broken file turns its check off.
 * Plain data: the paste page gets the same object, so its live check agrees
 * with the server's.
 */
export function loadCheckWords(vocabDir: string): CheckWords {
	return checkWords((file) => readYaml(join(vocabDir, file)));
}

/** The seed word lists of docs/VOCAB.md, for a check outside any vault (`vault check` on loose files, tests). */
export function seedCheckWords(vocabDoc: string): CheckWords {
	const seed = seedVocab(vocabDoc);
	return checkWords((file) => parse(seed[file], { version: '1.2' }));
}

type WordFile = 'participles.yaml' | 'descriptors.yaml' | 'brands.yaml';

function checkWords(read: (file: WordFile) => unknown): CheckWords {
	const out: CheckWords = {};
	const participles = parseWordList(read('participles.yaml'));
	const descriptors = parseWordList(read('descriptors.yaml'));
	const brands = parseWordList(read('brands.yaml'));
	if (participles) out.participles = participles;
	if (descriptors) out.descriptors = descriptors;
	if (brands) out.brands = brands;
	return out;
}

/** `slug: { fr: label, en: label }` → a map; malformed entries get no labels. */
function labelMap(data: unknown): Map<string, { fr?: string; en?: string }> {
	const out = new Map<string, { fr?: string; en?: string }>();
	if (!isMap(data)) return out;
	for (const [slug, labels] of Object.entries(data)) {
		const l = isMap(labels) ? labels : {};
		out.set(slug, {
			fr: typeof l.fr === 'string' ? l.fr : undefined,
			en: typeof l.en === 'string' ? l.en : undefined
		});
	}
	return out;
}

/** A tag as the index stores it: canonical when known, else folded and pending. */
export function canonicalTag(vocab: VaultVocab, tag: string): { tag: string; pending: boolean } {
	const key = fold(tag);
	const canonical = tagFor(vocab.tags, tag);
	return canonical ? { tag: canonical, pending: false } : { tag: key.replace(/\s+/g, '-'), pending: true };
}
