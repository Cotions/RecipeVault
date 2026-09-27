// Shared plumbing for the rule modules.

import type { BodyChunk } from '../body';
import type { Body, Diagnostic, Lang, Severity } from '../types';
import { suggestKey } from '../vocab';

export interface RuleContext {
	fm: Record<string, unknown>;
	body: Body;
	bodyChunks: BodyChunk[];
	/** The recipe's language, `fr` when absent or invalid. Picks `t`/`T` meanings. */
	lang: Lang;
	report(code: string, path: string | null, message: string, fix?: string, severity?: Severity): void;
}

export type Rule = (ctx: RuleContext) => void;

export function createContext(
	fm: Record<string, unknown>,
	body: Body,
	bodyChunks: BodyChunk[],
	out: Diagnostic[]
): RuleContext {
	return {
		fm,
		body,
		bodyChunks,
		lang: fm.lang === 'en' ? 'en' : 'fr',
		report(code, path, message, fix, severity) {
			const d: Diagnostic = { code, severity: severity ?? severityOf(code), path, message };
			if (fix) d.fix = fix;
			out.push(d);
		}
	};
}

export function severityOf(code: string): Severity {
	return code[0] === 'E' ? 'error' : code[0] === 'W' ? 'warning' : 'info';
}

export function isMap(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Absent, null (a blank `key:`), or an empty string. */
export function isBlank(v: unknown): boolean {
	return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/** A value as it would appear in the file: strings quoted, the rest as YAML flow. */
export function show(v: unknown): string {
	if (typeof v === 'string') return JSON.stringify(v);
	if (v === null || v === undefined) return 'null';
	if (Array.isArray(v)) return `[${v.map(show).join(', ')}]`;
	if (typeof v === 'object')
		return `{ ${Object.entries(v)
			.map(([k, x]) => `${k}: ${show(x)}`)
			.join(', ')} }`;
	return String(v);
}

export function join(path: string, key: string | number): string {
	if (typeof key === 'number') return `${path}[${key}]`;
	return path ? `${path}.${key}` : key;
}

/** W610 for every key of `obj` not in `allowed`, with a did-you-mean. */
export function checkKeys(
	ctx: RuleContext,
	obj: Record<string, unknown>,
	path: string,
	allowed: readonly string[],
	misplaced: Record<string, string> = {}
): void {
	for (const key of Object.keys(obj)) {
		if (allowed.includes(key)) continue;
		const where = join(path, key);
		const moved = misplaced[key];
		const guess = moved ?? suggestKey(key, allowed);
		const known = `Allowed keys${path ? ` in \`${path}\`` : ''}: ${allowed.join(', ')}.`;
		ctx.report(
			'W610',
			where,
			`unknown key \`${key}\`${path ? ` in \`${path}\`` : ''}; its value is ignored.`,
			guess ? `Did you mean \`${guess}\`?` : known
		);
	}
}

/** Every string value in a data tree, with its path. */
export function* strings(v: unknown, path: string): Generator<{ path: string; value: string }> {
	if (typeof v === 'string') yield { path, value: v };
	else if (Array.isArray(v)) for (let i = 0; i < v.length; i++) yield* strings(v[i], join(path, i));
	else if (isMap(v)) for (const [k, x] of Object.entries(v)) yield* strings(x, join(path, k));
}
