// Server side of the paste box: checks with the vault's context, saves, logs.

import { checkBatch, checkFile } from '../vault/check';
import { fileSlug } from '../vault/rules/batch';
import type { Diagnostic } from '../vault/types';
import type { App } from './app';
import type { GitAuthor } from './config';
import { withAuthor } from './context';
import { titles } from './index/query';
import { toTasteWarnings, unresolvedDiagnostics } from './index/resolve';
import { checkOptions } from './checkopts';
import { batchCloseRecipes, closeRecipes, duplicateWarnings, sideReader, titlesAlike, VARIANT_CLOSE, type CloseRecipe } from './duplicates';
import { stripMarkers } from '../vault/markers';
import { bodyText } from '../vault/parse';
import { referencedSlugs } from './pages';
import { titleMatches } from './formsave';
import { currentFile, save, vaultEntries, type SaveFile, type SaveResult } from './save';

export interface ServerCheckFile {
	diagnostics: Diagnostic[];
	slug?: string;
	/** Set when the slug is taken: what the person can choose. */
	collision?: { suggested: string; existing?: { title: string; hash: string }; inTrash: boolean };
	/** Titles of the recipes this file links to that exist in the vault. */
	titles: Record<string, string>;
	/** W505: vault recipes with nearly the same ingredients (plan 05, Phase 6), to link and to offer "Mettre en famille". */
	close?: CloseRecipe[];
	/**
	 * The vault recipe "Mettre en famille" puts in the family with this one, in
	 * the same commit (the first same-title recipe, W608, else the closest,
	 * W505): its hash for the stale guard, its family and variant to prefill.
	 */
	pairWith?: PairOffer;
	/**
	 * Every vault recipe the same-dish question is about, each named as a list
	 * names it (title, where it is from): the same title (W608) first, then
	 * nearly the same ingredients (W505), then a title that starts the same
	 * (the form's « Ressemble à », `titleMatches().like`). She picks the one to
	 * group with; `pairWith` is the first.
	 */
	candidates?: PairOffer[];
	/** W505 inside the paste: earlier files of this paste with nearly the same ingredients (not saved yet: named by their place). */
	closeInBatch?: { index: number; title: string; score: number }[];
}

export interface PairOffer {
	slug: string;
	title: string;
	hash: string;
	family: string | null;
	/** The family's name as shown (its label, else as its recipes write it); null when none. */
	familyLabel: string | null;
	/** As read (markers out). */
	variant: string | null;
	/** Where it is from, as a list line says it (« de Tante Aline », « Tiré du Tablier bleu »), '' when the file says nothing. */
	from: string;
	/** What its variant's label is read from (lib/form/family.ts variantShown, variantPrefill). */
	origin: { author: string | null; source_type: string | null; source_title: string | null; title: string };
	/** Why it is asked about: the same title, nearly the same ingredients, a title that starts the same. */
	why: 'title' | 'close' | 'like';
	/** The ingredients in common, weighted (0–1), as /doublons says it (« 67 % en commun »), when known. */
	score?: number;
}

/** At most this many recipes the same-dish question names. */
const MAX_CANDIDATES = 4;

/** Slug a file would be saved under, when its frontmatter reads at all. */
export function slugOf(text: string): string | undefined {
	const fm = checkFile(text).frontmatter;
	return fm ? fileSlug(fm) : undefined;
}

export function serverCheck(app: App, texts: string[]): ServerCheckFile[] {
	const { entries, trash } = vaultEntries(app.ctx);
	const result = checkBatch(
		texts.map((text, i) => ({ name: `recipe ${i + 1}`, text })),
		{ vault: entries, ...checkOptions(app.ctx) }
	);
	const slugs = texts.map(slugOf);
	const taken = new Set([...entries.map((e) => e.slug), ...slugs.filter((s): s is string => !!s)]);
	// Two copies in one paste: each file's own recipe (a batch E103 withholds the batch's), compared with the earlier files.
	const own = result.files.map((f, i) => f.recipe ?? checkFile(texts[i]).recipe ?? null);
	const bodies = texts.map(bodyText);
	const inBatch = batchCloseRecipes(app.ctx, own, slugs, undefined, bodies);
	const side = sideReader(app.ctx);
	return result.files.map((f, i) => {
		const slug = slugs[i];
		const out: ServerCheckFile = { diagnostics: f.diagnostics, slug, titles: {} };
		const batch = inBatch[i];
		const pairWithOf = (title: string, ownSlug: string | undefined) => {
			const m = titleMatches(app.ctx, title, ownSlug);
			const seen = new Set<string>();
			const list: PairOffer[] = [];
			const score = new Map((out.close ?? []).map((c) => [c.slug, c.score]));
			const add = (slug: string, why: PairOffer['why']) => {
				if (seen.has(slug) || list.length >= MAX_CANDIDATES) return;
				seen.add(slug);
				const s = side(slug);
				const x = score.get(slug);
				list.push({
					slug,
					title: s.title,
					hash: s.hash,
					family: s.family,
					familyLabel: s.familyLabel,
					variant: s.variant ? s.variant.trim() : null,
					from: s.from,
					origin: s.origin,
					why,
					...(x !== undefined ? { score: x } : {})
				});
			};
			for (const r of m.same) add(r.slug, 'title');
			// Close ingredients alone make a variant only when nearly all are shared, the titles say the
			// same dish, or the method is the same text (VARIANT_CLOSE): W505 still names the others.
			for (const r of out.close ?? []) if (r.score >= VARIANT_CLOSE || r.method || titlesAlike(stripMarkers(title), stripMarkers(r.title))) add(r.slug, 'close');
			for (const r of m.like) add(r.slug, 'like');
			if (list.length) {
				out.candidates = list;
				out.pairWith = list[0];
			} else {
				delete out.candidates;
				delete out.pairWith;
			}
		};
		if (batch.length) out.closeInBatch = batch.map((b) => ({ index: b.index, title: stripMarkers(own[b.index]!.title), score: b.score }));
		if (f.recipe) {
			out.titles = Object.fromEntries(titles(app.ctx.db, referencedSlugs(f.recipe, '')));
			// A file is never its own duplicate.
			const close = closeRecipes(app.ctx, f.recipe, slug, { body: bodies[i] });
			if (close.length) out.close = close;
			out.diagnostics = [
				...f.diagnostics,
				...unresolvedDiagnostics(app.ctx.db, app.ctx.paths.vocab, f.recipe),
				...toTasteWarnings(app.ctx.db, app.ctx.paths.vocab, f.recipe),
				...duplicateWarnings(close, batch)
			];
		}
		if (!f.recipe && slug && f.diagnostics.every((d) => d.severity !== 'error' || d.code === 'E103')) {
			// Its slug taken (E103, its only error): it may yet be saved under
			// another slug ("Enregistrer comme"), so the close recipes are those of
			// a new file — the recipe there left out (the collision names it), and
			// its settled pairs not applied. Only `close`, which the box shows
			// unless she picks "Remplacer"; no W505 line, which would show either way.
			const recipe = checkFile(texts[i]).recipe;
			const close = recipe ? closeRecipes(app.ctx, recipe, undefined, { exclude: slug, body: bodies[i] }) : [];
			if (close.length) out.close = close;
			// The recipe it collides with is a same-title pair when the titles match ("Enregistrer comme", then "Mettre en famille").
			if (recipe) pairWithOf(recipe.title, undefined);
		}
		if (f.recipe) pairWithOf(f.recipe.title, slug);
		if (slug && f.diagnostics.some((d) => d.code === 'E103')) {
			let n = 2;
			while (taken.has(`${slug}-${n}`)) n++;
			const cur = currentFile(app.ctx, slug);
			const title = entries.find((e) => e.slug === slug)?.title;
			out.collision = {
				suggested: `${slug}-${n}`,
				existing: cur ? { title: title ?? slug, hash: cur.hash } : undefined,
				inTrash: trash.has(slug)
			};
		}
		return out;
	});
}

/** A file of the same attempt that stayed in the box: its codes only, never its content. */
export interface Unsent {
	codes: string[];
	slug?: string;
}

/**
 * Save, then append one paste-log line for the attempt (docs/DATA-FLOW.md):
 * the saved files, plus the ones that stayed in the box as 'rejected'.
 * The commit is `author`'s (the signed-in person), else the config's.
 */
export async function savePaste(app: App, files: SaveFile[], unsent: Unsent[] = [], author?: GitAuthor): Promise<SaveResult> {
	const result = await save(withAuthor(app.ctx, author), files);
	app.pasteLog.append('save', [
		...result.files.map((r, i) => ({
			codes: r.diagnostics.map((d) => d.code),
			outcome: r.status,
			slug: r.status === 'rejected' ? slugOf(files[i].text) : r.slug
		})),
		...unsent.map((u) => ({ codes: u.codes, outcome: 'rejected' as const, slug: u.slug }))
	]);
	return result;
}
