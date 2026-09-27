// `vault sync`: bring the index in line with recipes/*.md (docs/DATA-FLOW.md).
// Hash-based: unchanged files are skipped unless forced. A file that stops
// passing the checker keeps its last good rows, flagged with its codes.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkFile } from '../../vault/check';
import type { Diagnostic } from '../../vault/types';
import { RECIPES, type VaultPaths } from '../vault';
import { loadVocab, type VaultVocab } from '../vocab';
import type { DB } from './db';
import { bodyOf, deleteRecipeRows, getMeta, recordProblem, refreshFamilies, retag, sha256, upsertRecipe } from './build';

export interface SyncProblem {
	file: string;
	codes: string[];
}

export interface SyncReport {
	scanned: number;
	indexed: number;
	unchanged: number;
	removed: number;
	problems: SyncProblem[];
	ms: number;
}

export type FileOutcome = 'indexed' | 'unchanged' | 'problem' | 'removed' | 'absent';

export const isRecipeFile = (name: string) => name.endsWith('.md') && !name.startsWith('.');

/** Relative path of a recipe file: `recipes/<slug>.md`. */
export const recipePath = (slug: string) => `${RECIPES}/${slug}.md`;

/** E113: a file whose slug does not match its name (an outside edit). */
function slugMismatch(slug: string, file: string): Diagnostic {
	return {
		code: 'E113',
		severity: 'error',
		path: 'slug',
		message: `\`slug: ${slug}\` does not match the file name ${file}; the slug is the file name.`,
		fix: `Rename the file to \`${slug}.md\`, or set \`slug\` back to the file name.`
	};
}

/** Index (or flag) one recipe file given its text. */
export function indexText(db: DB, vocab: VaultVocab, relPath: string, text: string, hash = sha256(text)): FileOutcome {
	const stem = relPath.replace(/^.*\//, '').replace(/\.md$/, '');
	const r = checkFile(text);
	if (r.recipe && r.recipe.slug === stem) {
		upsertRecipe(db, vocab, { recipe: r.recipe, body: bodyOf(text), filePath: relPath, hash });
		return 'indexed';
	}
	const diagnostics = r.recipe ? [slugMismatch(r.recipe.slug, relPath)] : r.diagnostics;
	recordProblem(db, relPath, hash, stem, diagnostics);
	return 'problem';
}

/** Re-read one file (after a save or a watcher event). */
export function syncFile(db: DB, paths: VaultPaths, relPath: string, vocab = loadVocab(paths.vocab), force = false): FileOutcome {
	const abs = join(paths.root, relPath);
	if (!existsSync(abs)) {
		const slug = relPath.replace(/^.*\//, '').replace(/\.md$/, '');
		const had = db.prepare('SELECT 1 FROM recipes WHERE file_path = ?').get(relPath);
		deleteRecipeRows(db, slug);
		db.prepare('DELETE FROM problems WHERE file_path = ?').run(relPath);
		return had ? 'removed' : 'absent';
	}
	const buf = readFileSync(abs);
	const hash = sha256(buf);
	if (!force) {
		const row = db.prepare('SELECT file_hash FROM recipes WHERE file_path = ? AND broken_json IS NULL').get(relPath) as
			| { file_hash: string }
			| undefined;
		const problem = db.prepare('SELECT file_hash FROM problems WHERE file_path = ?').get(relPath) as { file_hash: string } | undefined;
		if ((row?.file_hash === hash && !problem) || problem?.file_hash === hash) return 'unchanged';
	}
	return indexText(db, vocab, relPath, buf.toString('utf8'), hash);
}

/** sha256 of vocab/tags.yaml ('' when absent), to notice a change made while the app was down. */
export function tagsHash(vocabDir: string): string {
	const f = join(vocabDir, 'tags.yaml');
	return existsSync(f) ? sha256(readFileSync(f)) : '';
}

export function syncVault(db: DB, paths: VaultPaths, { force = false } = {}): SyncReport {
	const t0 = performance.now();
	const vocab = loadVocab(paths.vocab);
	const files = existsSync(paths.recipes) ? readdirSync(paths.recipes).filter(isRecipeFile).sort() : [];
	const report: SyncReport = { scanned: files.length, indexed: 0, unchanged: 0, removed: 0, problems: [], ms: 0 };
	const present = new Set(files.map((f) => `${RECIPES}/${f}`));
	db.transaction(() => {
		for (const f of files) {
			const outcome = syncFile(db, paths, `${RECIPES}/${f}`, vocab, force);
			if (outcome === 'indexed') report.indexed++;
			else if (outcome === 'unchanged') report.unchanged++;
		}
		const indexed = db.prepare('SELECT slug, file_path FROM recipes').all() as { slug: string; file_path: string }[];
		for (const row of indexed) {
			if (present.has(row.file_path)) continue;
			deleteRecipeRows(db, row.slug);
			report.removed++;
		}
		for (const p of db.prepare('SELECT file_path FROM problems').pluck().all() as string[])
			if (!present.has(p)) db.prepare('DELETE FROM problems WHERE file_path = ?').run(p);
		// vocab/tags.yaml changed while the app was down (a git pull, an editor):
		// unchanged files were skipped above, so recompute every tag row.
		const hash = tagsHash(paths.vocab);
		if (force || getMeta(db, 'tags_hash') !== hash) retag(db, vocab, hash);
		refreshFamilies(db, vocab);
	})();
	const problems = db.prepare('SELECT file_path, diagnostics FROM problems ORDER BY file_path').all() as { file_path: string; diagnostics: string }[];
	report.problems = problems.map((p) => ({
		file: p.file_path,
		codes: [...new Set((JSON.parse(p.diagnostics) as { code: string }[]).map((d) => d.code))]
	}));
	report.ms = Math.round(performance.now() - t0);
	return report;
}
