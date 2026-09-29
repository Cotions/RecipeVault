// Pending tags and how they are settled (plan 04, Phase 8; Q11 B;
// docs/VOCAB.md, "Tags"). A tag not in `vocab/tags.yaml` is kept in the file as
// written and indexed folded with `pending = 1`. On /etiquettes a person
// settles it, one git commit each:
//
// - "Nouvelle étiquette": a new canonical tag in `vocab/tags.yaml` (plus the
//   written forms as aliases when the slug alone would not match them) and its
//   French label in `vocab/tag-labels.yaml`. No recipe file changes.
// - "C'est comme…": the written forms become aliases of an existing canonical
//   tag. No recipe file changes: the index maps them (the file keeps what was
//   written, VOCAB.md).
// - "Retirer": the tag is taken out of every recipe that holds it, all in one
//   commit. The only action that rewrites recipes; asked for explicitly.
//
// Vocabulary writes are hash-guarded on both vocab files and edit
// `vocab/tags.yaml` as text, one line, so comments and the seed's alignment
// stay; the result is parsed back and checked before anything is written.

import { isMap, isSeq, parse, parseDocument, type Document, type YAMLMap } from 'yaml';
import { checkFile, hasErrors } from '../vault/check';
import { stripMarkers } from '../vault/markers';
import { fold } from '../vault/normalize';
import { suggestTag, tagFor } from '../vault/rules/vaultvocab';
import { serialize } from '../vault/serialize';
import { pendingKey } from '../vault/tagstatus';
import type { Recipe } from '../vault/types';
import { tagLabel } from '../i18n/fr';
import { committed, type VaultContext } from './context';
import { cleanLabel, FamilyLabelError, LABEL_MAX, withLabel } from './families';
import { FileWriteError, readVaultFile, writeAndCommit, type FileWrite } from './files';
import { refreshFamilies, retag } from './index/build';
import type { DB } from './index/db';
import { indexText, recipePath, tagsHash } from './index/sync';
import { currentFile, localDate } from './save';
import { VOCAB } from './vault';
import { loadVocab } from './vocab';

export const TAGS_FILE = `${VOCAB}/tags.yaml`;
export const TAG_LABELS_FILE = `${VOCAB}/tag-labels.yaml`;
export { LABEL_MAX };

export class TagError extends Error {}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------------------------------------------------------------- reading

export interface PendingTag {
	/** The key the index stores (folded, hyphenated): what /etiquettes posts back. */
	tag: string;
	/** As written in the recipes (markers stripped), most used first. */
	forms: string[];
	recipes: { slug: string; title: string; hash: string; broken: boolean }[];
	/** Closest canonical tag within two edits (W501's suggestion). */
	suggestion?: string;
	/** The canonical slug "Nouvelle étiquette" would add ('' when none can be made: no Latin letter or digit). */
	slug: string;
	/** The French label offered for it: the most used form, capitalized. */
	label: string;
}

/** Number of distinct pending tags: the nav's "Étiquettes (N)". */
export function pendingTagCount(db: DB): number {
	return db.prepare('SELECT count(DISTINCT tag) FROM tags WHERE pending = 1').pluck().get() as number;
}

/** A canonical slug from a pending key: ASCII letters and digits, hyphenated. */
export function tagSlug(key: string): string {
	return key
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Every pending tag with its recipes, most used first. */
export function pendingTags(ctx: VaultContext): PendingTag[] {
	const vocab = loadVocab(ctx.paths.vocab);
	const rows = ctx.db
		.prepare(
			`SELECT t.tag, r.slug, r.title, r.file_hash, r.data_json, r.broken_json IS NOT NULL AS broken
			 FROM tags t JOIN recipes r ON r.slug = t.slug WHERE t.pending = 1 ORDER BY t.tag, r.title`
		)
		.all() as { tag: string; slug: string; title: string; file_hash: string; data_json: string; broken: number }[];
	const byTag = new Map<string, { forms: Map<string, number>; recipes: PendingTag['recipes'] }>();
	for (const r of rows) {
		const entry = byTag.get(r.tag) ?? { forms: new Map<string, number>(), recipes: [] as PendingTag['recipes'] };
		byTag.set(r.tag, entry);
		entry.recipes.push({ slug: r.slug, title: r.title, hash: r.file_hash, broken: !!r.broken });
		for (const t of (JSON.parse(r.data_json) as Recipe).tags) {
			const form = stripMarkers(t).replace(/\s+/g, ' ').trim();
			if (pendingKey(form) === r.tag) entry.forms.set(form, (entry.forms.get(form) ?? 0) + 1);
		}
	}
	return [...byTag]
		.map(([tag, e]) => {
			const forms = [...e.forms].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([f]) => f);
			const suggestion = suggestTag(vocab.tags, tag);
			return {
				tag,
				forms: forms.length ? forms : [tag],
				recipes: e.recipes,
				...(suggestion ? { suggestion } : {}),
				slug: tagSlug(tag),
				label: capitalize((forms[0] ?? tag.replace(/-/g, ' ')).toLocaleLowerCase('fr'))
			};
		})
		.sort((a, b) => b.recipes.length - a.recipes.length || a.tag.localeCompare(b.tag));
}

/** The two vocab files a tag write changes, as one version string for the hash guard. */
export function tagsVersion(ctx: VaultContext): string {
	return `${readVaultFile(ctx, TAGS_FILE).hash}:${readVaultFile(ctx, TAG_LABELS_FILE).hash}`;
}

/** Canonical tags of vocab/tags.yaml with their French display label, by label. */
export function canonicalTags(ctx: VaultContext): { tag: string; label: string }[] {
	const vocab = loadVocab(ctx.paths.vocab);
	return [...new Set(vocab.tags.values())]
		.map((tag) => ({ tag, label: tagLabel(tag, vocab.tagLabels.get(tag)?.fr) }))
		.sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}

/** French labels of the vocabulary's tags, for pages that show tags (reads vocab/tag-labels.yaml alone: every page asks). */
export function tagLabels(ctx: VaultContext): Record<string, string> {
	const out: Record<string, string> = {};
	let data: unknown;
	try {
		data = parse(readVaultFile(ctx, TAG_LABELS_FILE).text, { version: '1.2' });
	} catch {
		return out;
	}
	if (typeof data !== 'object' || data === null) return out;
	for (const [tag, l] of Object.entries(data as Record<string, unknown>)) {
		const fr = typeof l === 'object' && l !== null ? (l as { fr?: unknown }).fr : undefined;
		if (typeof fr === 'string' && fr) out[tag] = fr;
	}
	return out;
}

/**
 * Everything the form's tag field needs, as plain JSON for the browser:
 * `tags` (folded alias or canonical → canonical; `new Map(tags)` feeds
 * `classifyTag` in `$lib/vault/tagstatus`), the canonical tags with labels
 * for the autocomplete, and the keys pending in the index.
 */
export function tagVocabulary(ctx: VaultContext): {
	tags: [string, string][];
	canonical: { tag: string; label: string; aliases: string[] }[];
	pending: string[];
} {
	const vocab = loadVocab(ctx.paths.vocab);
	const aliases = new Map<string, string[]>();
	for (const [alias, canonical] of vocab.tags) if (alias !== canonical) aliases.set(canonical, [...(aliases.get(canonical) ?? []), alias]);
	return {
		tags: [...vocab.tags],
		canonical: canonicalTags(ctx).map((c) => ({ ...c, aliases: aliases.get(c.tag) ?? [] })),
		pending: ctx.db.prepare('SELECT DISTINCT tag FROM tags WHERE pending = 1 ORDER BY tag').pluck().all() as string[]
	};
}

// ----------------------------------------------------- vocab/tags.yaml text

/** A YAML flow scalar for an alias: plain when it reads back as itself, else double-quoted. */
function flowScalar(s: string, plain: boolean): string {
	return plain && /^[\p{L}\p{N}][\p{L}\p{N} '’.-]*$/u.test(s) ? s : JSON.stringify(s);
}

function readTags(text: string): Record<string, unknown> {
	if (!text.trim()) return {};
	const doc = parseDocument(text, { version: '1.2' });
	if (doc.errors.length) throw new TagError(`${TAGS_FILE} ne se lit pas (YAML) ; corrigez-le d’abord.`);
	const data = doc.toJS() ?? {};
	if (typeof data !== 'object' || Array.isArray(data)) throw new TagError(`${TAGS_FILE} n’est pas une liste d’étiquettes ; corrigez-le d’abord.`);
	return data as Record<string, unknown>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function reads(text: string, expected: Record<string, unknown>): boolean {
	try {
		return same(parse(text, { version: '1.2' }) ?? {}, expected);
	} catch {
		return false;
	}
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `text` with `aliases` appended to canonical tag `canonical` (added as a new
 * entry when absent). One line changes when the entry is a one-line flow list
 * (`four: [oven, baked]`) or a new entry is appended; otherwise the document
 * is re-emitted (comments kept). Checked by parsing it back.
 */
export function withAliases(text: string, canonical: string, aliases: string[]): string {
	const data = readTags(text);
	const current = data[canonical];
	const expected = { ...data, [canonical]: [...(Array.isArray(current) ? current : []), ...aliases] };
	for (const plain of [true, false]) {
		const items = aliases.map((a) => flowScalar(a, plain));
		let out: string | undefined;
		if (Object.hasOwn(data, canonical)) {
			const re = new RegExp(`^(${escapeRe(canonical)}:\\s*\\[)([^\\n]*?)(\\]\\s*(?:#[^\\n]*)?)$`, 'm');
			const m = re.exec(text);
			if (m) out = text.slice(0, m.index) + m[1] + (m[2].trim() ? `${m[2].replace(/\s+$/, '')}, ` : '') + items.join(', ') + m[3] + text.slice(m.index + m[0].length);
		} else {
			// Line the new entry's list up with the entries above it, as the seed does.
			const col = [...text.matchAll(/^[a-z0-9-]+:(\s+)\[/gm)].map((m) => m[0].length - 1).pop();
			const key = `${canonical}:`;
			const line = `${key.padEnd(Math.max(col ?? 0, key.length + 1))}[${items.join(', ')}]`;
			out = `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`;
		}
		if (out !== undefined && reads(out, expected)) return out;
	}
	// Anything else (a block list, `{}` for an empty file): edit the document.
	const doc = parseDocument(text, { version: '1.2' }) as unknown as Document;
	if (!isMap(doc.contents)) doc.contents = doc.createNode({});
	const root = doc.contents as YAMLMap;
	root.flow = false;
	const seq = root.get(canonical, true);
	const node = doc.createNode(isSeq(seq) ? [...(seq.toJSON() as unknown[]), ...aliases] : aliases);
	node.flow = true;
	root.set(canonical, node);
	const out = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
	if (!reads(out, expected)) throw new TagError(`${TAGS_FILE} n’a pas pu être modifié proprement ; rien n’a changé.`);
	return out;
}

// ---------------------------------------------------------------- writing

/** The pending tag as the index has it now, or a TagError when it was settled meanwhile. */
function stillPending(ctx: VaultContext, key: string): PendingTag {
	const p = pendingTags(ctx).find((t) => t.tag === key);
	if (!p) throw new TagError('cette étiquette n’est plus en attente ; rechargez la page.');
	return p;
}

/** The forms to add as aliases so each one maps to `canonical`: the fewest, most used first. */
function aliasesFor(tags: Map<string, string>, canonical: string, forms: string[]): string[] {
	const map = new Map(tags);
	map.set(canonical, canonical);
	const out: string[] = [];
	for (const f of forms) {
		if (tagFor(map, f)) continue;
		const alias = f.normalize('NFC').toLocaleLowerCase('fr');
		out.push(alias);
		map.set(fold(alias), canonical);
	}
	return out;
}

async function commitVocab(ctx: VaultContext, writes: FileWrite[], message: string): Promise<string | undefined> {
	let commit: string | undefined;
	try {
		commit = await writeAndCommit(ctx, writes, message);
	} catch (e) {
		if (!(e instanceof FileWriteError)) throw e;
		throw new TagError(
			e.stage === 'write'
				? `le vocabulaire n’a pas pu être écrit ; rien n’a changé : ${e.message}`
				: `le vocabulaire n’a pas pu être enregistré (git) ; rien n’a changé : ${e.message}`
		);
	}
	try {
		retag(ctx.db, loadVocab(ctx.paths.vocab), tagsHash(ctx.paths.vocab));
	} catch (e) {
		ctx.log(`recipevault: index update failed after commit (vault sync will recover): ${(e as Error).message}`);
	}
	committed(ctx);
	return commit;
}

function guard(ctx: VaultContext, version: string): { tags: string; labels: string } {
	if (tagsVersion(ctx) !== version) throw new TagError('le vocabulaire a changé depuis l’ouverture de la page ; rechargez-la.');
	return { tags: readVaultFile(ctx, TAGS_FILE).text, labels: readVaultFile(ctx, TAG_LABELS_FILE).text };
}

/**
 * "Nouvelle étiquette": pending tag `key` becomes canonical tag `tagSlug(key)`
 * in vocab/tags.yaml, with the written forms the slug would not match as its
 * aliases, and `label` (French) in vocab/tag-labels.yaml. One commit.
 */
export function acceptTag(ctx: VaultContext, key: string, label: string, version: string): Promise<{ commit?: string; tag: string }> {
	return ctx.lock.run(async () => {
		const files = guard(ctx, version);
		const pending = stillPending(ctx, key);
		const slug = pending.slug;
		if (!SLUG_RE.test(slug)) throw new TagError('cette étiquette n’a aucune lettre ou chiffre dont faire un identifiant ; reliez-la à une étiquette existante ou retirez-la.');
		const vocab = loadVocab(ctx.paths.vocab);
		if (vocab.tags.has(slug)) throw new TagError(`« ${slug} » est déjà dans le vocabulaire ; utilisez « C’est comme… ».`);
		const clean = cleanLabel(label);
		if (clean.length > LABEL_MAX) throw new TagError(`le nom est trop long (${LABEL_MAX} caractères au plus).`);
		const writes: FileWrite[] = [{ rel: TAGS_FILE, text: withAliases(files.tags, slug, aliasesFor(vocab.tags, slug, pending.forms)) }];
		if (clean) {
			try {
				writes.push({ rel: TAG_LABELS_FILE, text: withLabel(files.labels, slug, clean, TAG_LABELS_FILE) });
			} catch (e) {
				if (e instanceof FamilyLabelError) throw new TagError(e.message);
				throw e;
			}
		}
		const commit = await commitVocab(ctx, writes, clean ? `tag: new ${slug} → ${clean}` : `tag: new ${slug}`);
		return { commit, tag: slug };
	});
}

/**
 * "C'est comme…": the written forms of pending tag `key` become aliases of
 * canonical tag `canonical` in vocab/tags.yaml. One commit; no recipe changes.
 */
export function mapTag(ctx: VaultContext, key: string, canonical: string, version: string): Promise<{ commit?: string }> {
	return ctx.lock.run(async () => {
		const files = guard(ctx, version);
		const pending = stillPending(ctx, key);
		const data = readTags(files.tags);
		if (!Object.hasOwn(data, canonical)) throw new TagError('choisissez une étiquette du vocabulaire.');
		const vocab = loadVocab(ctx.paths.vocab);
		const aliases = aliasesFor(vocab.tags, canonical, pending.forms);
		if (!aliases.length) return {};
		const commit = await commitVocab(ctx, [{ rel: TAGS_FILE, text: withAliases(files.tags, canonical, aliases) }], `tag: ${key} → ${canonical}`);
		return { commit };
	});
}

/**
 * "Retirer": take pending tag `key` out of every recipe holding it, one
 * commit. `seen` is what the page listed (slug → file hash): the write is
 * refused when a file changed, or when the list of recipes did. A file that
 * fails the checker is not rewritten (plan 04, Q3 A). Each file is rewritten
 * canonically with its status kept and `updated` set, like any app edit.
 */
export function dropTag(
	ctx: VaultContext,
	key: string,
	seen: Record<string, string>,
	opts: { today?: string } = {}
): Promise<{ commit?: string; recipes: number }> {
	return ctx.lock.run(async () => {
		const pending = stillPending(ctx, key);
		const slugs = pending.recipes.map((r) => r.slug).sort();
		if (!same(slugs, Object.keys(seen).sort())) throw new TagError('d’autres recettes portent cette étiquette depuis l’ouverture de la page ; rechargez-la.');
		const vocab = loadVocab(ctx.paths.vocab);
		const writes: { slug: string; title: string; text: string }[] = [];
		for (const slug of slugs) {
			const cur = currentFile(ctx, slug);
			if (!cur) throw new TagError('une des recettes a changé depuis l’ouverture de la page ; rechargez-la.');
			// A broken file first: the index keeps its last good hash, so the
			// hash guard would send her to reload forever (plan 04, Q3 A).
			const file = checkFile(cur.text);
			if (!file.recipe || hasErrors(file.diagnostics)) throw new TagError(`la recette « ${slug} » ne passe pas la validation ; faites-la corriger d’abord.`);
			if (cur.hash !== seen[slug]) throw new TagError('une des recettes a changé depuis l’ouverture de la page ; rechargez-la.');
			const tags = file.recipe.tags.filter((t) => !(pendingKey(t) === key && !tagFor(vocab.tags, t)));
			if (tags.length === file.recipe.tags.length) continue;
			const final: Recipe = { ...file.recipe, tags, updated: opts.today ?? localDate() };
			writes.push({ slug, title: stripMarkers(final.title), text: serialize(final, file.body!) });
		}
		if (!writes.length) return { recipes: 0 };
		const message = `tag: drop ${key}\n\n${writes.map((w) => `edit: ${w.title}`).join('\n')}`;
		let commit: string | undefined;
		try {
			commit = await writeAndCommit(ctx, writes.map((w) => ({ rel: recipePath(w.slug), text: w.text })), message);
		} catch (e) {
			if (!(e instanceof FileWriteError)) throw e;
			throw new TagError(
				e.stage === 'write'
					? `les recettes n’ont pas pu être écrites ; rien n’a changé : ${e.message}`
					: `les recettes n’ont pas pu être enregistrées (git) ; rien n’a changé : ${e.message}`
			);
		}
		try {
			ctx.db.transaction(() => {
				for (const w of writes) indexText(ctx.db, vocab, recipePath(w.slug), w.text);
				refreshFamilies(ctx.db, vocab);
			})();
		} catch (e) {
			ctx.log(`recipevault: index update failed after commit (vault sync will recover): ${(e as Error).message}`);
		}
		committed(ctx);
		return { commit, recipes: writes.length };
	});
}
