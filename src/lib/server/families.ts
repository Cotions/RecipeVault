// Family display labels (docs/VOCAB.md, "Families"): `vocab/families.yaml`
// maps a family slug to its labels, `{ fr: …, en: … }`. The recipe files hold
// only the slug (`family: lasagna`); the label is what every page shows.
// Written like a recipe: stale-write guard by hash, atomic write, one git
// commit, the index's families rows refreshed, push in the background. A
// failed commit puts the file back.

import { isMap, isScalar, parseDocument, type Document } from 'yaml';
import { normalizeText } from '../vault/normalize';
import { t } from '../i18n';
import { committed, type VaultContext } from './context';
import { FileWriteError, readVaultFile, writeAndCommit } from './files';
import { refreshFamilies } from './index/build';
import { VOCAB } from './vault';
import { loadVocab } from './vocab';

export const FAMILIES_FILE = `${VOCAB}/families.yaml`;
export const LABEL_MAX = 80;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class FamilyLabelError extends Error {}

/** The families vocabulary as on disk: text and hash ('' when the file is absent). */
export function familiesFile(ctx: VaultContext): { text: string; hash: string } {
	return readVaultFile(ctx, FAMILIES_FILE);
}

/** A label as stored: NFC, one line, spaces collapsed. Empty means "no label". */
export function cleanLabel(label: string): string {
	return normalizeText(label).replace(/\s+/g, ' ').trim();
}

/**
 * `text` (the families file) with the French label of `slug` set, or removed
 * when `label` is empty — an entry left with no label is dropped. Comments and
 * other entries are kept; the top level is written in block style, each entry
 * in flow style (`lasagna: { fr: Lasagnes }`), like the seed. `file` names
 * the file in errors: tag labels (`vocab/tag-labels.yaml`) share the shape.
 */
export function withLabel(text: string, slug: string, label: string, file = FAMILIES_FILE): string {
	// Typed as a plain Document: nodes are added below.
	const doc = parseDocument(text, { version: '1.2' }) as unknown as Document;
	if (doc.errors.length) throw new FamilyLabelError(t.error.yaml(file));
	if (doc.contents === null || (isScalar(doc.contents) && (doc.contents.value === null || doc.contents.value === '')))
		doc.contents = doc.createNode({});
	const root = doc.contents;
	if (!isMap(root)) throw new FamilyLabelError(t.families.refused.notNames(file));
	root.flow = false;
	const entry = root.get(slug, true);
	if (isMap(entry)) {
		if (label) entry.set('fr', label);
		else entry.delete('fr');
		if (!entry.items.length) root.delete(slug);
	} else if (label) {
		const node = doc.createNode({ fr: label });
		node.flow = true;
		root.set(slug, node);
	} else {
		root.delete(slug);
	}
	return doc.toString({ lineWidth: 0 });
}

/**
 * Set (or clear, with an empty label) the French display label of a family.
 * `expectedHash` is the hash of the families file the person saw; the write
 * is refused when it changed since.
 */
export function setFamilyLabel(ctx: VaultContext, slug: string, label: string, expectedHash: string): Promise<{ commit?: string }> {
	return ctx.lock.run(async () => {
		if (!SLUG_RE.test(slug)) throw new FamilyLabelError(t.families.refused.slug);
		const clean = cleanLabel(label);
		if (clean.length > LABEL_MAX) throw new FamilyLabelError(t.error.labelTooLong(LABEL_MAX));
		const cur = familiesFile(ctx);
		if (cur.hash !== expectedHash) throw new FamilyLabelError(t.families.refused.changed);
		const next = withLabel(cur.text, slug, clean);
		if (next === cur.text) return {};

		let commit: string | undefined;
		try {
			const message = clean ? `family: ${slug} → ${clean}` : `family: ${slug} (label removed)`;
			commit = await writeAndCommit(ctx, [{ rel: FAMILIES_FILE, text: next }], message);
		} catch (e) {
			if (!(e instanceof FileWriteError)) throw e;
			throw new FamilyLabelError(
				e.stage === 'write' ? t.error.write(e.message) : t.families.refused.commit(e.message)
			);
		}
		try {
			refreshFamilies(ctx.db, loadVocab(ctx.paths.vocab));
		} catch (e) {
			ctx.log(`recipevault: index update failed after commit (vault sync will recover): ${(e as Error).message}`);
		}
		committed(ctx);
		return { commit };
	});
}
