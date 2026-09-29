// W501 (tag not in the vault's tag vocabulary) and W502 (`family` near an
// existing family): vault-context warnings, fixed in the app (docs/VOCAB.md,
// "Tags" and "Families"). The vocabulary is passed as a check option by the
// server; the browser has none and skips them. The recipe page derives the
// same warnings from the index with `vocabDiagnostics` (plan 03, Q23).

import { stripMarkers } from '../markers';
import { editDistance, fold } from '../normalize';
import type { Diagnostic } from '../types';
import { fileSlug } from './batch';
import { severityOf, type RuleContext } from './context';

export interface VaultVocabOptions {
	/** vocab/tags.yaml: every folded canonical tag and alias → its canonical tag. */
	tags?: ReadonlyMap<string, string>;
	/** Every existing family slug: vocab/families.yaml plus the families in use. */
	families?: readonly string[];
	/**
	 * A family in use by one recipe only, and not in vocab/families.yaml: that
	 * recipe's slug. W502 on that recipe leaves it out — a recipe is not near
	 * its own family (VALIDATION.md, W502).
	 */
	soleUser?: ReadonlyMap<string, string>;
}

/**
 * A tag's canonical form, as the index stores it (`canonicalTag`), or
 * undefined when the vocabulary lacks it. Spaces and hyphens are the same
 * (as the pending key has them): `pâte-à-choux` finds the alias `pâte à choux`.
 */
export function tagFor(tags: ReadonlyMap<string, string>, tag: string): string | undefined {
	const key = fold(stripMarkers(tag));
	return tags.get(key) ?? tags.get(key.replace(/\s+/g, '-')) ?? tags.get(key.replace(/[\s-]+/g, ' '));
}

/** The closest canonical tag to an unknown one, within edit distance 2. */
export function suggestTag(tags: ReadonlyMap<string, string>, tag: string): string | undefined {
	const key = fold(stripMarkers(tag)).replace(/\s+/g, '-');
	let best: string | undefined;
	let bestD = Infinity;
	for (const [alias, canonical] of tags) {
		const d = editDistance(key, alias.replace(/\s+/g, '-'));
		if (d < bestD || (d === bestD && best !== undefined && canonical.localeCompare(best) < 0)) {
			bestD = d;
			best = canonical;
		}
	}
	// Two edits on a four-letter tag is a different word.
	return best !== undefined && bestD <= 2 && bestD < key.length / 2 ? best : undefined;
}

/** W501 / W502 for a recipe's `tags` and `family` values. */
export function vocabDiagnostics(values: { tags?: unknown; family?: unknown; slug?: string }, vocab: VaultVocabOptions): Diagnostic[] {
	const out: Diagnostic[] = [];
	const push = (code: string, path: string, message: string, fix: string) => out.push({ code, severity: severityOf(code), path, message, fix });
	if (vocab.tags && Array.isArray(values.tags)) {
		values.tags.forEach((t, i) => {
			if (typeof t !== 'string' || !stripMarkers(t).trim() || tagFor(vocab.tags!, t)) return;
			const near = suggestTag(vocab.tags!, t);
			push(
				'W501',
				`tags[${i}]`,
				`tag \`${t}\` is not in the vault's tag vocabulary (vocab/tags.yaml); it is kept, marked pending.`,
				near
					? `Closest known tag: \`${near}\`. Use it, or add \`${t}\` to vocab/tags.yaml as an alias or a new tag.`
					: `Add \`${t}\` to vocab/tags.yaml as a new tag or as an alias of an existing one.`
			);
		});
	}
	if (vocab.families && typeof values.family === 'string' && values.family.trim()) {
		const family = fold(values.family);
		const families = values.slug && vocab.soleUser ? vocab.families.filter((f) => vocab.soleUser!.get(f) !== values.slug) : vocab.families;
		const near = families
			.map((f) => ({ f, d: editDistance(family, fold(f)) }))
			.filter((x) => x.d > 0 && x.d <= 2)
			.sort((a, b) => a.d - b.d || a.f.localeCompare(b.f))
			.map((x) => x.f);
		if (near.length && !families.some((f) => fold(f) === family))
			push(
				'W502',
				'family',
				`\`family: ${values.family}\` is close to the existing ${near.length > 1 ? 'families' : 'family'} ${near.map((f) => `\`${f}\``).join(', ')} — a spelling drift would split one family in two.`,
				`If it is the same dish, use \`family: ${near[0]}\`; if it really is another family, keep it.`
			);
	}
	return out;
}

export function checkVaultVocab(ctx: RuleContext): void {
	const vocab = ctx.opts.vocab;
	if (!vocab) return;
	for (const d of vocabDiagnostics({ tags: ctx.fm.tags, family: ctx.fm.family, slug: fileSlug(ctx.fm) }, vocab)) ctx.report(d.code, d.path, d.message, d.fix);
}
