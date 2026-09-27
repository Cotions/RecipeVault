// Orchestration: parse → rules → sorted diagnostics → typed recipe.

import { buildRecipe } from './build';
import { splitPaste } from './fences';
import { parseRecipe } from './parse';
import { createContext } from './rules/context';
import { checkBatchRules, type VaultEntry } from './rules/batch';
import { checkBody } from './rules/body';
import { checkIdentity } from './rules/identity';
import { checkIngredients } from './rules/ingredients';
import { checkMarkers, collectMarkers } from './rules/markers';
import { checkSource } from './rules/source';
import { checkTextFields } from './rules/text';
import { checkOven, checkServings, checkTimes } from './rules/times';
import type { Body, Diagnostic, Recipe, Severity } from './types';

export interface CheckResult {
	/** The typed recipe, present only when there is no error. */
	recipe?: Recipe;
	diagnostics: Diagnostic[];
}

/** Also carries the raw frontmatter, which batch rules read even when the file has errors. */
export interface FileCheck extends CheckResult {
	frontmatter?: Record<string, unknown>;
	/** The parsed body, present whenever the frontmatter parsed. */
	body?: Body;
}

const RULES = [checkIdentity, checkSource, checkTimes, checkServings, checkOven, checkIngredients, checkTextFields, checkMarkers, checkBody];

export function checkFile(text: string): FileCheck {
	const parsed = parseRecipe(text);
	if (!parsed.frontmatter || !parsed.body || !parsed.bodyChunks) {
		return { diagnostics: sortDiagnostics(parsed.diagnostics) };
	}
	const diagnostics: Diagnostic[] = [];
	const ctx = createContext(parsed.frontmatter, parsed.body, parsed.bodyChunks, diagnostics);
	for (const rule of RULES) rule(ctx);
	const result: FileCheck = { frontmatter: parsed.frontmatter, body: parsed.body, diagnostics: sortDiagnostics(diagnostics) };
	if (!hasErrors(diagnostics)) result.recipe = buildRecipe(parsed.frontmatter, collectMarkers(ctx));
	return result;
}

/** Check one recipe file. */
export function checkRecipe(text: string): CheckResult {
	const { recipe, diagnostics } = checkFile(text);
	return recipe ? { recipe, diagnostics } : { diagnostics };
}

export function hasErrors(diagnostics: Diagnostic[]): boolean {
	return diagnostics.some((d) => d.severity === 'error');
}

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/**
 * Errors → warnings → info, then by path (numeric indices in numeric order,
 * frontmatter before body), then code.
 */
export function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
	return [...diagnostics].sort(
		(a, b) =>
			RANK[a.severity] - RANK[b.severity] ||
			comparePaths(a.path, b.path) ||
			a.code.localeCompare(b.code)
	);
}

const collator = new Intl.Collator('en', { numeric: true });

function comparePaths(a: string | null, b: string | null): number {
	if (a === b) return 0;
	if (a === null) return -1;
	if (b === null) return 1;
	const bodyA = a.startsWith('body.');
	const bodyB = b.startsWith('body.');
	if (bodyA !== bodyB) return bodyA ? 1 : -1;
	return collator.compare(a, b);
}

export interface BatchFileResult extends CheckResult {
	name: string;
}

export interface BatchResult {
	files: BatchFileResult[];
	/** Diagnostics about the input as a whole, not one file (I702). */
	pasteDiagnostics: Diagnostic[];
	/** Every diagnostic count by code, most frequent first. */
	summary: { code: string; severity: Severity; count: number }[];
}

export interface BatchOptions {
	/** Recipes already in the vault, for E103 / W306 / E213 / W503 / W608. */
	vault?: VaultEntry[];
}

/** Check several files together: single-file rules, then cross-file rules. */
export function checkBatch(files: { name: string; text: string }[], opts: BatchOptions = {}): BatchResult {
	const items = files.map((f) => {
		const r = checkFile(f.text);
		return { name: f.name, frontmatter: r.frontmatter, recipe: r.recipe, diagnostics: r.diagnostics.map((d) => ({ ...d, file: f.name })) };
	});
	checkBatchRules(items, opts.vault ?? []);
	const results: BatchFileResult[] = items.map((it) => {
		const diagnostics = sortDiagnostics(it.diagnostics);
		const out: BatchFileResult = { name: it.name, diagnostics };
		if (it.recipe && !hasErrors(diagnostics)) out.recipe = it.recipe;
		return out;
	});
	return { files: results, pasteDiagnostics: [], summary: summarize(results.flatMap((f) => f.diagnostics)) };
}

/**
 * Check an AI answer pasted whole: every ```markdown fence is a file. Text
 * outside the fences is reported as I702, never as an error.
 */
export function checkPaste(text: string, opts: BatchOptions = {}): BatchResult {
	const { files, outside } = splitPaste(text);
	const result = checkBatch(
		files.length ? files.map((t, i) => ({ name: `recipe ${i + 1}`, text: t })) : [{ name: 'recipe 1', text }],
		opts
	);
	if (files.length && outside) addOutsideText(result, outside);
	return result;
}

/** Record text found outside the recipe fences as I702 on a batch result. */
export function addOutsideText(result: BatchResult, outside: string): void {
	result.pasteDiagnostics.push({
		code: 'I702',
		severity: 'info',
		path: null,
		message: `text found outside the recipe fences — ignored, shown in case the AI asked something:\n${outside}`
	});
	result.summary = summarize([...result.files.flatMap((f) => f.diagnostics), ...result.pasteDiagnostics]);
}

export function summarize(diagnostics: Diagnostic[]): BatchResult['summary'] {
	const counts = new Map<string, { code: string; severity: Severity; count: number }>();
	for (const d of diagnostics) {
		const c = counts.get(d.code) ?? { code: d.code, severity: d.severity, count: 0 };
		c.count++;
		counts.set(d.code, c);
	}
	return [...counts.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}
