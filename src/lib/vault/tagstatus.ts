// Whether a tag someone typed is in the vault's vocabulary, already waiting
// as pending, or new (docs/VOCAB.md, "Tags"; plan 04, Q11 B). Browser-safe:
// the form gets the vocabulary as plain data (`tagVocabulary` on the server)
// and asks this while she types.

import { stripMarkers } from './markers';
import { fold } from './normalize';
import { suggestTag, tagFor } from './rules/vaultvocab';

export type TagStatus =
	/** In vocab/tags.yaml, as a canonical tag or an alias of one. */
	| { status: 'known'; canonical: string }
	/** Not in the vocabulary, but already written in some recipe: waiting on /etiquettes. */
	| { status: 'pending'; tag: string; suggestion?: string }
	/** Not in the vocabulary and in no recipe yet: saving it makes it pending. */
	| { status: 'new'; tag: string; suggestion?: string }
	/** Nothing but blanks or markers. */
	| { status: 'empty' };

/** A tag as the index keys an unknown one: folded, spaces as hyphens (`canonicalTag`). */
export function pendingKey(tag: string): string {
	return fold(stripMarkers(tag)).replace(/\s+/g, '-');
}

/**
 * Classify a typed tag. `tags` maps every folded canonical tag and alias to
 * its canonical tag (the vault's `vocab/tags.yaml`); `pending` holds the keys
 * of the tags currently pending in the index. `suggestion` is the closest
 * canonical tag within two edits (the one W501 offers).
 */
export function classifyTag(tags: ReadonlyMap<string, string>, pending: ReadonlySet<string>, tag: string): TagStatus {
	const key = pendingKey(tag);
	if (!key) return { status: 'empty' };
	const canonical = tagFor(tags, tag);
	if (canonical) return { status: 'known', canonical };
	const suggestion = suggestTag(tags, tag);
	return { status: pending.has(key) ? 'pending' : 'new', tag: key, ...(suggestion ? { suggestion } : {}) };
}
