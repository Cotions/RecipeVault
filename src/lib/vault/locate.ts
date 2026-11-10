// A diagnostic path back to the text it is about: the value as written (to
// quote it beside the explanation) and where it sits in the file (so the paste
// box can select it). Best effort: a path that cannot be followed gives
// nothing, never a wrong place. Browser-safe.

import { isMap, isScalar, isSeq, parseDocument, type Node } from 'yaml';
import { normalizeText } from './normalize';
import type { Body } from './types';

type Token = string | number;

/** `ingredients[0].items[3].unit` → ['ingredients', 0, 'items', 3, 'unit']; undefined when malformed. */
export function pathTokens(path: string): Token[] | undefined {
	const out: Token[] = [];
	const re = /([^.[\]]+)|\[(\d+)\]/g;
	let m: RegExpExecArray | null;
	let consumed = 0;
	while ((m = re.exec(path))) {
		out.push(m[2] !== undefined ? Number(m[2]) : m[1]);
		consumed += m[0].length;
	}
	if (!out.length || consumed + (path.match(/\./g)?.length ?? 0) !== path.length) return undefined;
	return out;
}

/**
 * The value a frontmatter path points at, as written: a string, number or
 * boolean, trimmed to one short line. Undefined for a missing value, a map,
 * a list, or a body path.
 */
export function valueAt(frontmatter: Record<string, unknown> | undefined, path: string | null | undefined): string | undefined {
	if (!frontmatter || !path) return undefined;
	const tokens = pathTokens(path);
	if (!tokens || tokens[0] === 'body') return undefined;
	let node: unknown = frontmatter;
	for (const k of tokens) {
		if (typeof k === 'number' ? !Array.isArray(node) : typeof node !== 'object' || node === null || Array.isArray(node)) return undefined;
		node = (node as Record<string | number, unknown>)[k];
	}
	if (typeof node === 'number' || typeof node === 'boolean') return String(node);
	if (typeof node !== 'string') return undefined;
	const s = node.trim().replace(/\s+/g, ' ');
	if (!s) return undefined;
	return s.length > 40 ? s.slice(0, 39) + '…' : s;
}

export interface Span {
	/** Character offsets in the file text, end excluded. */
	start: number;
	end: number;
}

/**
 * Where a diagnostic path sits in one recipe file (the text the checker read,
 * normalized): the value of a frontmatter path, or the deepest part of it
 * that exists (a missing `unit` selects its ingredient line); a section's
 * heading, a step's first words, the text before the first heading. A
 * whole-file diagnostic (no path) points at nothing.
 */
export function locate(file: string, path: string | null | undefined, body?: Body): Span | null {
	const yaml = yamlOf(file, path);
	if (!yaml) return null;
	const { text, tokens, yamlStart, bodyStart } = yaml;
	if (tokens[0] === 'body') return locateBody(text, bodyStart, tokens, body);
	const walked = walk(yaml.yamlText, tokens);
	const range = walked?.found?.range;
	if (!range) return null;
	// A block map or list ends after its last line break: stop at the value's end.
	return trimSpan(text, { start: yamlStart + range[0], end: yamlStart + range[1] });
}

/**
 * The span of the one scalar a frontmatter path names, quotes included, only
 * when the whole path resolves to it (never the deepest part that exists, as
 * `locate` gives): what a quick fix may overwrite. Null otherwise.
 */
export function scalarAt(file: string, path: string | null | undefined): Span | null {
	const yaml = yamlOf(file, path);
	if (!yaml || yaml.tokens[0] === 'body') return null;
	const walked = walk(yaml.yamlText, yaml.tokens);
	if (!walked || walked.depth !== yaml.tokens.length || !isScalar(walked.found) || !walked.found.range) return null;
	const [start, end] = walked.found.range;
	return trimSpan(yaml.text, { start: yaml.yamlStart + start, end: yaml.yamlStart + end });
}

/**
 * A short value written as YAML: plain when it reads back as the same string
 * in a block or a flow collection (`cup`, `pâte à choux`), else double-quoted.
 */
export function yamlScalar(value: string): string {
	const plain = /^[\p{L}][\p{L}\p{N} '’-]*$/u.test(value) && !/^(true|false|null|yes|no|on|off|~)$/i.test(value) && !/\s$/.test(value);
	return plain ? value : JSON.stringify(value);
}

/** The file's text (normalized), its frontmatter, and where the frontmatter and the body start. */
function yamlOf(file: string, path: string | null | undefined) {
	if (!path) return null;
	const tokens = pathTokens(path);
	if (!tokens) return null;
	const text = normalizeText(file);
	const lines = text.split('\n');
	if (lines[0]?.trimEnd() !== '---') return null;
	const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---');
	if (end === -1) return null;
	const yamlStart = lines[0].length + 1;
	const yamlText = lines.slice(1, end).join('\n');
	const bodyStart = yamlStart + yamlText.length + (end > 1 ? 1 : 0) + lines[end].length + 1;
	return { text, tokens, yamlStart, yamlText, bodyStart };
}

/** Follow a path in the frontmatter as far as it goes: the deepest node found, and how many tokens it took. */
function walk(yamlText: string, tokens: Token[]): { found: Node | null; depth: number } | null {
	const doc = parseDocument(yamlText, { version: '1.2' });
	if (doc.errors.length) return null;
	let node: unknown = doc.contents;
	let found: Node | null = null;
	let depth = 0;
	for (const k of tokens) {
		let next: unknown;
		if (typeof k === 'number' && isSeq(node)) next = node.items[k];
		else if (typeof k === 'string' && isMap(node)) next = node.items.find((p) => isScalar(p.key) && p.key.value === k)?.value;
		if (!next || !(isScalar(next) || isMap(next) || isSeq(next))) break;
		node = next;
		found = next;
		depth++;
	}
	return { found, depth };
}

function locateBody(text: string, bodyStart: number, tokens: Token[], body?: Body): Span | null {
	const [, part, i] = tokens;
	const rest = text.slice(bodyStart);
	const lineAt = (re: RegExp): Span | null => {
		const m = re.exec(rest);
		if (!m) return null;
		const lead = m[0].length - m[0].trimStart().length;
		return { start: bodyStart + m.index + lead, end: bodyStart + m.index + m[0].trimEnd().length };
	};
	if (part === 'preamble') return lineAt(/^[ \t]*\S.*$/m);
	if (part === 'sections' && typeof i === 'number') {
		const heading = body?.sections[i]?.heading;
		if (!heading) return null;
		const esc = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		return lineAt(new RegExp(`^[ \\t]{0,3}#{1,6}[ \\t]+${esc}[ \\t#]*$`, 'm'));
	}
	if (part === 'steps' && typeof i === 'number') {
		// A step's text is its first line once the list mark is gone.
		const first = body?.steps[i]?.text.split('\n')[0].trim();
		if (!first) return null;
		const at = rest.indexOf(first);
		return at === -1 ? null : { start: bodyStart + at, end: bodyStart + at + first.length };
	}
	return null;
}

function trimSpan(text: string, s: Span): Span {
	let { start, end } = s;
	while (end > start && /\s/.test(text[end - 1])) end--;
	while (start < end && /\s/.test(text[start])) start++;
	return { start, end };
}
