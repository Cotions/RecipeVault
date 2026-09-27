// Text → frontmatter data + body, or the parse diagnostics E001/E002.

import { parseDocument } from 'yaml';
import { parseBody, type BodyChunk } from './body';
import { normalizeText } from './normalize';
import type { Body, Diagnostic } from './types';

export interface ParsedFile {
	/** The frontmatter as plain data, unvalidated. */
	frontmatter?: Record<string, unknown>;
	body?: Body;
	/** Body text in pieces, each with its diagnostic path. */
	bodyChunks?: BodyChunk[];
	diagnostics: Diagnostic[];
}

const FILE_SHAPE_FIX =
	'Return the complete file: a `---` line, the YAML frontmatter, a closing `---` line, then the Markdown body.';

function e001(message: string): ParsedFile {
	return {
		diagnostics: [{ code: 'E001', severity: 'error', path: null, message, fix: FILE_SHAPE_FIX }]
	};
}

const GENERIC_YAML_FIX =
	'Quote any value containing `: ` or starting with `[`, `{`, `*`, `&`, `!`, `%`, `@` or a backtick; keep the indentation consistent.';

const MARKER_VALUE_RE = /([\w-]+):[ \t]+([^"'{},\n]*?\[(?:\?|illisible|\+)[^\n]*?)(?=\s*[,}]|\s*$)/;

/**
 * A marker in an unquoted value breaks YAML: `[?: other]` reads as a nested
 * `key: value`, and any `[` inside a `{ … }` entry opens a list. Name the value
 * to quote, when the failing line shows one.
 */
function markerQuoteFix(line: string): string | undefined {
	if (!/\[(?:\?|illisible|\+)/.test(line)) return undefined;
	const m = line.match(MARKER_VALUE_RE);
	const example = m ? `\`${m[1]}: "${m[2].trim().replace(/"/g, '\\"')}"\`` : '`name: "beurre [illisible]"`';
	return `A value holding a marker must be in double quotes: ${example}.`;
}

/**
 * Split a recipe file into frontmatter and body and parse both. The frontmatter
 * is parsed as YAML 1.2 — never 1.1, which reads `no` as false and `1:30` as 5400.
 */
export function parseRecipe(text: string): ParsedFile {
	const lines = normalizeText(text).split('\n');
	if (lines.every((l) => l.trim() === '')) return e001('the file is empty.');
	if (/^\s{0,3}(`{3,}|~{3,})/.test(lines[0]))
		return e001('the file is wrapped in a code fence instead of starting with `---`.');
	if (lines[0].trimEnd() !== '---')
		return e001('the file does not start with a `---` line opening the YAML frontmatter.');
	const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---');
	if (end === -1) return e001('the YAML frontmatter has no closing `---` line.');

	const yamlText = lines.slice(1, end).join('\n');
	const doc = parseDocument(yamlText, { version: '1.2', prettyErrors: true, uniqueKeys: true });
	if (doc.errors.length > 0) {
		// The parser counts lines from the first frontmatter line; shift by one
		// for the opening `---` so the position matches the file.
		const err = doc.errors[0];
		const first = err.message
			.split('\n')[0]
			.replace(/:$/, '')
			.replace(/at line (\d+)/, (_, n: string) => `at line ${Number(n) + 1}`);
		const errLine = yamlText.split('\n')[(err.linePos?.[0].line ?? 0) - 1] ?? '';
		const fix = markerQuoteFix(errLine) ?? GENERIC_YAML_FIX;
		return {
			diagnostics: [
				{
					code: 'E002',
					severity: 'error',
					path: null,
					message: `the frontmatter is not valid YAML: ${first}`,
					fix
				}
			]
		};
	}
	const data: unknown = doc.toJS() ?? {};
	if (typeof data !== 'object' || Array.isArray(data)) {
		return {
			diagnostics: [
				{
					code: 'E002',
					severity: 'error',
					path: null,
					message: 'the frontmatter is not a mapping of `key: value` lines.',
					fix: 'Write the frontmatter as `key: value` lines, starting with `schema: 3`.'
				}
			]
		};
	}
	const { body, chunks } = parseBody(lines.slice(end + 1).join('\n'));
	return { frontmatter: data as Record<string, unknown>, body, bodyChunks: chunks, diagnostics: [] };
}

/** The Markdown body of a recipe file: everything after the closing `---`, trimmed. */
export function bodyText(text: string): string {
	const lines = normalizeText(text).split('\n');
	if (lines[0]?.trimEnd() !== '---') return '';
	const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---');
	return end === -1 ? '' : lines.slice(end + 1).join('\n').trim();
}
