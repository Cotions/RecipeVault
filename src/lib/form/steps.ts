// A method section ↔ rows (plan 04, Q5 A): one row per step, a heading row
// per sub-heading, and a "texte" row for prose between steps, kept in place.
//
// Reading uses `methodBlocks`, the same split the checker uses. A step's text
// is its lines: continuation lines join the line above with a space (as the
// checker reads them), a nested list keeps one line per item. Writing is the
// canonical form: `1.` numbering, nested lines indented under the step's
// text, blank lines around sub-headings and prose. An unchanged section is
// never rewritten: the model writes its original text back (see model.ts).

import { methodBlocks } from '../vault/body';

export type RowType = 'step' | 'heading' | 'text';

/** A row's content, as written in the file (markers included). */
export interface RawRow {
	type: RowType;
	text: string;
	/** Heading level (3 for `###`); heading rows only. */
	level?: number;
}

const LIST_ITEM = /^(?:[-*+]|\d+[.)])\s+/;

function stepText(lines: string[]): string {
	const out: string[] = [];
	lines.forEach((line, i) => {
		const t = i === 0 ? line.replace(/^\s*(?:\d+[.)]|[-*])\s+/, '').trim() : line.trim();
		if (i === 0 || LIST_ITEM.test(t) || !out.length) out.push(t);
		else out[out.length - 1] += ' ' + t;
	});
	return out.join('\n');
}

/** The rows of a method section's text. */
export function rowsFromText(text: string): RawRow[] {
	return methodBlocks(text.split('\n')).map((b): RawRow => {
		if (b.type === 'heading') return { type: 'heading', text: b.text, level: b.level };
		if (b.type === 'step') return { type: 'step', text: stepText(b.lines) };
		return { type: 'text', text: b.lines.join('\n') };
	});
}

// A prose line the parser would read as something else: a heading or a list
// item (a step). Escaped so it stays prose. A thematic break (`---`) is prose
// to the parser already and stays as written.
const NOT_PROSE = /^(?:#{1,6}\s|(?:[-*+]|\d+[.)])\s)/;
const BREAK = /^([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

function escapeProse(line: string): string {
	const t = line.trimStart();
	if (!NOT_PROSE.test(t) || BREAK.test(t)) return t;
	const m = t.match(/^\d+/);
	return m ? `${m[0]}\\${t.slice(m[0].length)}` : `\\${t}`;
}

/** Canonical method text from rows. Empty rows are left out. */
export function textFromRows(rows: RawRow[]): string {
	const blocks: { type: RowType; lines: string[] }[] = [];
	let n = 0;
	for (const row of rows) {
		const lines = row.text
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);
		if (!lines.length) continue;
		if (row.type === 'step') {
			const prefix = `${++n}. `;
			const pad = ' '.repeat(prefix.length);
			blocks.push({ type: 'step', lines: [prefix + lines[0], ...lines.slice(1).map((l) => pad + l)] });
		} else if (row.type === 'heading') {
			blocks.push({ type: 'heading', lines: [`${'#'.repeat(Math.min(6, Math.max(3, row.level ?? 3)))} ${lines.join(' ')}`] });
		} else {
			// Prose keeps its own blank lines; each line starts at the margin so it
			// is not read as the continuation of the step above.
			const prose = row.text
				.split('\n')
				.map((l) => (l.trim() ? escapeProse(l.trimEnd()) : ''))
				.join('\n')
				.trim();
			blocks.push({ type: 'text', lines: [prose] });
		}
	}
	return blocks
		.map((b, i) => (i === 0 ? '' : b.type === 'step' && blocks[i - 1].type === 'step' ? '\n' : '\n\n') + b.lines.join('\n'))
		.join('');
}

export const sameRows = (a: RawRow[], b: RawRow[]) =>
	a.length === b.length &&
	a.every((r, i) => r.type === b[i].type && r.text === b[i].text && (r.type !== 'heading' || r.level === b[i].level));
