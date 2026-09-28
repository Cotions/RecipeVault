// The ingredient registry on disk (ingredients/*.md) → the index (plan 03,
// Phase 1). Same rules as recipes: hash-based, a file that stops passing its
// check keeps its last good rows and is listed with its codes.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lookupKey, singularKey } from '../ingredients/normalize';
import { checkRegistry, parseIngredient } from '../ingredients/registry';
import { displayName, NAME_LANGS, type RegistryEntry } from '../ingredients/types';
import type { Diagnostic } from '../vault/types';
import { getMeta, setMeta, sha256 } from './index/build';
import type { DB } from './index/db';
import type { SyncProblem } from './index/sync';
import { INGREDIENTS, type VaultPaths } from './vault';
import type { VaultVocab } from './vocab';

export const isIngredientFile = (name: string) => name.endsWith('.md') && !name.startsWith('.');
export const ingredientPath = (slug: string) => `${INGREDIENTS}/${slug}.md`;

export interface RegistryReport {
	/** Ingredient files on disk. */
	files: number;
	/** Files (re)read this time. */
	loaded: number;
	removed: number;
	/** False when nothing changed since the last load (the hash matched): no re-resolution needed. */
	changed: boolean;
	/** Files with errors (kept at their last good rows) or warnings. */
	problems: (SyncProblem & { broken: boolean })[];
}

const VOCAB_FILES = ['normalize.yaml', 'allergens.yaml'];

function fileHash(abs: string): string {
	return existsSync(abs) ? sha256(readFileSync(abs)) : '';
}

/** The vocabulary files the registry rows depend on (plural rules, allergen list). */
function vocabPart(paths: VaultPaths): string {
	return sha256(VOCAB_FILES.map((f) => `${f}:${fileHash(join(paths.vocab, f))}`).join('\n'));
}

function listFiles(paths: VaultPaths): { rel: string; stem: string; buf: Buffer; hash: string }[] {
	if (!existsSync(paths.ingredients)) return [];
	return readdirSync(paths.ingredients)
		.filter(isIngredientFile)
		.sort()
		.map((f) => {
			const buf = readFileSync(join(paths.ingredients, f));
			return { rel: `${INGREDIENTS}/${f}`, stem: f.slice(0, -3), buf, hash: sha256(buf) };
		});
}

const slim = (d: Diagnostic) => ({ code: d.code, severity: d.severity, path: d.path, message: d.message, ...(d.fix ? { fix: d.fix } : {}) });

/**
 * Bring the registry tables in line with ingredients/*.md. Skipped when the
 * hash over the files and vocab/normalize.yaml, vocab/allergens.yaml is the
 * one stored in `meta.registry_hash`, unless forced. Call inside a transaction
 * when batching; the caller re-resolves ingredient rows when `changed`.
 */
export function syncRegistry(db: DB, paths: VaultPaths, vocab: VaultVocab, { force = false } = {}): RegistryReport {
	const files = listFiles(paths);
	const vPart = vocabPart(paths);
	const hash = sha256(files.map((f) => `${f.rel}:${f.hash}`).join('\n') + '\n' + vPart);
	const report: RegistryReport = { files: files.length, loaded: 0, removed: 0, changed: false, problems: [] };
	if (!force && getMeta(db, 'registry_hash') === hash) {
		report.problems = registryProblems(db);
		return report;
	}
	report.changed = true;
	// A vocabulary change can change any file's warnings (W809): read them all.
	const all = force || getMeta(db, 'registry_vocab_hash') !== vPart;
	const allergens = vocab.allergens.size ? new Set(vocab.allergens.keys()) : undefined;
	const rowHash = db.prepare('SELECT file_hash FROM registry WHERE file_path = ?').pluck();
	const problemHash = db.prepare('SELECT file_hash FROM registry_problems WHERE file_path = ? AND broken = 1').pluck();
	const present = new Set(files.map((f) => f.rel));

	for (const f of files) {
		if (!all) {
			const broken = problemHash.get(f.rel) as string | undefined;
			if ((rowHash.get(f.rel) === f.hash && broken === undefined) || broken === f.hash) continue;
		}
		report.loaded++;
		const { entry, diagnostics } = parseIngredient(f.buf.toString('utf8'), { fileStem: f.stem, allergens });
		if (entry) upsertEntry(db, entry, f.rel, f.hash, diagnostics);
		else
			db.prepare(
				`INSERT INTO registry_problems (file_path, slug, file_hash, broken, diagnostics) VALUES (?, ?, ?, 1, ?)
				 ON CONFLICT(file_path) DO UPDATE SET slug = excluded.slug, file_hash = excluded.file_hash, broken = 1, diagnostics = excluded.diagnostics`
			).run(f.rel, f.stem, f.hash, JSON.stringify(diagnostics.map(slim)));
	}
	for (const rel of db.prepare('SELECT file_path FROM registry').pluck().all() as string[]) {
		if (present.has(rel)) continue;
		db.prepare('DELETE FROM registry WHERE file_path = ?').run(rel);
		report.removed++;
	}
	for (const rel of db.prepare('SELECT file_path FROM registry_problems').pluck().all() as string[])
		if (!present.has(rel)) db.prepare('DELETE FROM registry_problems WHERE file_path = ?').run(rel);

	rebuildDerived(db, vocab);
	setMeta(db, 'registry_hash', hash);
	setMeta(db, 'registry_vocab_hash', vPart);
	report.problems = registryProblems(db);
	return report;
}

function upsertEntry(db: DB, e: RegistryEntry, rel: string, hash: string, warnings: Diagnostic[]): void {
	db.prepare('DELETE FROM registry WHERE file_path = ? OR slug = ?').run(rel, e.slug);
	db.prepare(
		`INSERT INTO registry (slug, file_path, file_hash, name, category, staple, au_gout, density, default_unit, entry_json, warnings_json, body)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		e.slug,
		rel,
		hash,
		displayName(e),
		e.category,
		e.staple ? 1 : 0,
		e.auGout ? 1 : 0,
		e.density ?? null,
		e.defaultUnit ?? null,
		JSON.stringify(e),
		JSON.stringify(warnings.map(slim)),
		e.body
	);
	db.prepare('DELETE FROM registry_problems WHERE file_path = ?').run(rel);
}

/** Every entry in the index. */
export function registryEntries(db: DB): RegistryEntry[] {
	return (db.prepare('SELECT entry_json FROM registry ORDER BY slug').pluck().all() as string[]).map((j) => JSON.parse(j));
}

/**
 * Names, substitutes and allergens tables from the registry rows, and the
 * cross-file warnings (W808, W810) merged with each file's own.
 */
function rebuildDerived(db: DB, vocab: VaultVocab): void {
	const entries = registryEntries(db);
	for (const t of ['ingredient_names', 'substitutes', 'ingredient_allergens']) db.prepare(`DELETE FROM ${t}`).run();
	const insName = db.prepare('INSERT OR IGNORE INTO ingredient_names (key, skey, slug, lang, name) VALUES (?, ?, ?, ?, ?)');
	const insSub = db.prepare('INSERT OR IGNORE INTO substitutes (slug, substitute) VALUES (?, ?)');
	const insAll = db.prepare('INSERT OR IGNORE INTO ingredient_allergens (slug, allergen) VALUES (?, ?)');
	for (const e of entries) {
		for (const lang of NAME_LANGS)
			for (const n of e.names[lang]) {
				const key = lookupKey(n);
				insName.run(key, singularKey(key, vocab.normalize.plurals[lang]), e.slug, lang, n);
			}
		for (const s of e.substitutes) insSub.run(e.slug, s);
		for (const a of e.allergens) insAll.run(e.slug, a);
	}
	const cross = checkRegistry(entries);
	db.prepare('DELETE FROM registry_problems WHERE broken = 0').run();
	const ins = db.prepare('INSERT OR IGNORE INTO registry_problems (file_path, slug, file_hash, broken, diagnostics) VALUES (?, ?, ?, 0, ?)');
	for (const r of db.prepare('SELECT slug, file_path, file_hash, warnings_json FROM registry').all() as {
		slug: string;
		file_path: string;
		file_hash: string;
		warnings_json: string;
	}[]) {
		const all = [...JSON.parse(r.warnings_json), ...(cross.get(r.slug) ?? []).map(slim)];
		if (all.length) ins.run(r.file_path, r.slug, r.file_hash, JSON.stringify(all));
	}
}

/** Ingredient files with diagnostics, broken ones first. */
export function registryProblems(db: DB): RegistryReport['problems'] {
	return (
		db.prepare('SELECT file_path, broken, diagnostics FROM registry_problems ORDER BY broken DESC, file_path').all() as {
			file_path: string;
			broken: number;
			diagnostics: string;
		}[]
	).map((p) => ({
		file: p.file_path,
		broken: p.broken === 1,
		codes: [...new Set((JSON.parse(p.diagnostics) as { code: string }[]).map((d) => d.code))]
	}));
}
