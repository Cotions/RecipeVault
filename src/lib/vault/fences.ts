// Split an AI answer into recipe files. Only ```markdown fences are files; any
// other text (a QUESTIONS section, remarks) is returned as `outside`.

import { normalizeText } from './normalize';

const OPEN_RE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)\s*$/;

export interface SplitPaste {
	files: string[];
	/** Text found outside the recipe fences, trimmed; '' when there is none. */
	outside: string;
}

export function splitPaste(text: string): SplitPaste {
	const lines = normalizeText(text).split('\n');
	const files: string[] = [];
	const outside: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const open = lines[i].match(OPEN_RE);
		if (!open) {
			outside.push(lines[i++]);
			continue;
		}
		const [, fence, info] = open;
		const close = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`);
		let j = i + 1;
		while (j < lines.length && !close.test(lines[j])) j++;
		const content = lines.slice(i + 1, j);
		// A bare fence counts when what it holds starts like a recipe file.
		const firstLine = content.find((l) => l.trim() !== '');
		const isRecipe = /^(markdown|md)$/i.test(info) || (info === '' && firstLine?.trim() === '---');
		if (isRecipe) files.push(tidy(content));
		else outside.push(...lines.slice(i, j + 1));
		i = j + 1;
	}
	if (files.length === 0 && outside.join('\n').trimStart().startsWith('---')) {
		return { files: [tidy(outside)], outside: '' };
	}
	return { files, outside: outside.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
}

/** Drop leading and trailing blank lines; end with exactly one newline. */
function tidy(lines: string[]): string {
	let a = 0;
	let b = lines.length;
	while (a < b && lines[a].trim() === '') a++;
	while (b > a && lines[b - 1].trim() === '') b--;
	return lines.slice(a, b).join('\n') + '\n';
}
