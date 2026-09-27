// The fix-request block of docs/VALIDATION.md: pasted back into the AI chat that
// produced a rejected file. Its wording is tuned for an AI reader — keep it exact.

import type { Diagnostic } from './types';

export interface FailedFile {
	/** The rejected file, verbatim. */
	text: string;
	diagnostics: Diagnostic[];
}

export interface FixBlockOptions {
	/**
	 * The format specification (the prompt from docs/AI-TEMPLATE.md), included
	 * only when the errors suggest the AI never had it.
	 */
	spec?: string;
}

const WIDTH = 80;
const INDENT = '         ';

/** Several E2xx at once in one file suggests the AI is not following the format. */
const SPEC_E2XX_THRESHOLD = 3;

export function needsSpec(failed: FailedFile[]): boolean {
	return failed.some(
		(f) =>
			f.diagnostics.some((d) => d.code === 'E001') ||
			f.diagnostics.filter((d) => d.severity === 'error' && /^E2\d\d$/.test(d.code)).length >= SPEC_E2XX_THRESHOLD
	);
}

export function renderFixBlock(failed: FailedFile[], passed: string[], opts: FixBlockOptions = {}): string {
	const many = failed.length > 1;
	const out: string[] = [];
	out.push(many ? `RECIPEVAULT — ${failed.length} FILES REJECTED` : 'RECIPEVAULT — FILE REJECTED', '');
	out.push(
		...wrap(
			many
				? 'Your previous output did not validate. Fix every ERROR below, then return each COMPLETE corrected file inside its own ```markdown fence. Output nothing else. Do not explain the changes. Do not return a partial file or a diff.'
				: 'Your previous output did not validate. Fix every ERROR below, then return the COMPLETE corrected file inside one ```markdown fence. Output nothing else. Do not explain the changes. Do not return a partial file or a diff.',
			'',
			''
		),
		''
	);
	if (passed.length) {
		out.push(...wrap(`Already saved, do not send again: ${passed.join(', ')}.`, '', ''), '');
	}
	if (needsSpec(failed)) {
		if (opts.spec) {
			out.push(
				...wrap('Your output does not follow the recipe format. The full format follows; apply all of it to the whole file.', '', ''),
				'',
				'--- FORMAT ---',
				opts.spec.trimEnd(),
				'--- END FORMAT ---',
				''
			);
		} else {
			out.push(
				...wrap('Your output does not follow the recipe format. Re-read the format instructions given at the start of this chat and apply all of them to the whole file.', '', ''),
				''
			);
		}
	}
	failed.forEach((file, i) => {
		if (many) out.push(`=== FILE ${i + 1} OF ${failed.length} ===`, '');
		const errors = file.diagnostics.filter((d) => d.severity === 'error');
		const warnings = file.diagnostics.filter((d) => d.severity === 'warning');
		if (errors.length) out.push('ERRORS — must fix:', ...errors.flatMap(entry), '');
		if (warnings.length)
			out.push('WARNINGS — fix if you can, the file will save without them:', ...warnings.flatMap(entry), '');
		out.push('--- YOUR FILE ---', file.text.replace(/\n+$/, ''), '--- END FILE ---', '');
	});
	return out.join('\n').replace(/\n+$/, '\n');
}

/** `  [E201] path: message` then the fix on the next, indented line. */
function entry(d: Diagnostic): string[] {
	const head = `[${d.code}] ${d.path ? `${d.path}: ` : ''}${d.message}`;
	const lines = wrap(head, '  ', INDENT);
	if (d.fix) lines.push(...wrap(d.fix, INDENT, INDENT));
	return lines;
}

/** Word-wrap at WIDTH columns without breaking inside a `code span`. */
function wrap(text: string, first: string, rest: string): string[] {
	const words: string[] = [];
	let cur = '';
	let tick = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		// A ``` fence mention is not a code span.
		const run = text.slice(i).match(/^`+/)?.[0].length ?? 0;
		if (run >= 3) {
			cur += text.slice(i, i + run);
			i += run - 1;
			continue;
		}
		if (ch === '`') tick = !tick;
		if (ch === ' ' && !tick) {
			if (cur) words.push(cur);
			cur = '';
		} else cur += ch;
	}
	if (cur) words.push(cur);
	const lines: string[] = [];
	let line = first;
	let empty = true;
	for (const w of words) {
		if (!empty && line.length + 1 + w.length > WIDTH) {
			lines.push(line);
			line = rest + w;
		} else {
			line += (empty ? '' : ' ') + w;
		}
		empty = false;
	}
	lines.push(line);
	return lines;
}
