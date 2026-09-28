// Written ingredient name → lookup key (docs/INGREDIENTS.md, "Resolution" 1).
// Generic on purpose (plan 03, decision 1): no word or dialect is special-cased
// here. Plural rules are data (vocab/normalize.yaml, plan 03 Q2). Browser-safe.

import { stripMarkers } from '../vault/markers';
import { fold } from '../vault/normalize';

/**
 * The lookup key of a written name: markers stripped, folded (NFC, lowercase,
 * accents and ligatures, whitespace), apostrophe and hyphen variants unified,
 * no space before `%` (`crème 35 %` and `crème 35%` are one key). `brand`,
 * `note` and `prep` are never part of it: callers pass `name` only.
 */
export function lookupKey(name: string): string {
	return fold(
		stripMarkers(name)
			.normalize('NFC')
			.replace(/[‘’ʼ`´′]/g, "'")
			.replace(/[‐‑‒–—―−]/g, '-')
	)
		.replace(/\s*'\s*/g, "'")
		.replace(/\s*-\s*/g, '-')
		.replace(/(\d)\s+%/g, '$1%');
}

/** Per language: suffixes stripped from a word, tried in order, and the shortest word they apply to. */
export interface PluralRule {
	suffixes: string[];
	minLength: number;
}

export type PluralRules = Partial<Record<string, PluralRule>>;

/** `vocab/normalize.yaml`. */
export interface NormalizeVocab {
	plurals: PluralRules;
}

export const EMPTY_NORMALIZE: NormalizeVocab = { plurals: {} };

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Read vocab/normalize.yaml's data; anything malformed is left out (never a failed sync). */
export function parseNormalizeVocab(data: unknown): NormalizeVocab {
	const plurals: PluralRules = {};
	const p = isMap(data) ? data.plurals : undefined;
	if (isMap(p)) {
		for (const [lang, rule] of Object.entries(p)) {
			if (!isMap(rule) || !Array.isArray(rule.suffixes)) continue;
			const suffixes = rule.suffixes.filter((s): s is string => typeof s === 'string' && s.length > 0).map((s) => fold(s));
			const min = typeof rule.min_length === 'number' && rule.min_length > 0 ? rule.min_length : 1;
			if (suffixes.length) plurals[lang] = { suffixes, minLength: min };
		}
	}
	return { plurals };
}

/**
 * The singular form of a key under one language's rules: each word at least
 * `minLength` long loses the first suffix it ends with. Words holding a digit
 * are left alone (`15%`). Returns the key unchanged when no rule applies.
 */
export function singularKey(key: string, rule: PluralRule | undefined): string {
	if (!rule) return key;
	return key
		.split(' ')
		.map((w) => {
			if (w.length < rule.minLength || /\d/.test(w)) return w;
			// Hyphenated compounds inflect on each part (`choux-fleurs`).
			return w
				.split('-')
				.map((part) => {
					if (part.length < rule.minLength) return part;
					const s = rule.suffixes.find((x) => part.endsWith(x) && part.length > x.length);
					return s ? part.slice(0, -s.length) : part;
				})
				.join('-');
		})
		.join(' ');
}
