// Line-based body parsing: headings, sections, steps. No Markdown library —
// validation needs only headings and list items.
//
// In a method section every list line is a step: numbered (`1.`, `2)`) or a
// `-` / `*` bullet, mixed freely, in source order (the app renumbers). A list
// line indented to the text of the step above is nested under it, as in
// Markdown, and joins that step instead of starting one.

import { headingKind } from './vocab';
import type { Body, Section, Step } from './types';

/** A piece of body text with the path diagnostics use for it. */
export interface BodyChunk {
	path: string;
	text: string;
}

export interface ParsedBody {
	body: Body;
	/** All body text, each line in exactly one chunk: steps, then other lines per section. */
	chunks: BodyChunk[];
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
// A step line: up to 3 spaces, then `1.` / `1)` or `-` / `*`, then the text.
const STEP_RE = /^(\s{0,3})(?:(\d+)[.)]|[-*])\s+(.*)$/;
// `---`, `* * *`: a thematic break, not a bullet.
const BREAK_RE = /^\s{0,3}([-*])(?:[ \t]*\1){2,}[ \t]*$/;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

/** One piece of a method section, in source order. */
export type MethodBlock =
	| { type: 'heading'; text: string; level: number; line: string }
	/** `lines`: the step's own lines as written (nested list and continuation lines included, blank lines not). */
	| { type: 'step'; number?: number; text: string; subheading?: string; lines: string[] }
	/** Lines that are neither steps nor sub-headings (prose, `---`), blank lines between them kept. */
	| { type: 'text'; lines: string[] };

/**
 * A method section's lines as steps, sub-headings and other text. The one
 * place that decides what a step is: the checker and the form both read it.
 */
export function methodBlocks(lines: string[]): MethodBlock[] {
	const blocks: MethodBlock[] = [];
	let current: (MethodBlock & { type: 'step' }) | null = null;
	// Column where the current step's text starts: a list line indented
	// that far is nested in it (Markdown), not a new step.
	let column = 0;
	let subheading: string | undefined;
	let blank = false;
	for (const line of lines) {
		const h = line.match(HEADING_RE);
		const s = BREAK_RE.test(line) ? null : line.match(STEP_RE);
		const last = blocks[blocks.length - 1];
		if (h) {
			subheading = h[2];
			current = null;
			blocks.push({ type: 'heading', text: h[2], level: h[1].length, line });
		} else if (s && !(current && s[1].length >= column)) {
			current = { type: 'step', text: s[3].trim(), lines: [line] };
			if (s[2] !== undefined) current.number = Number(s[2]);
			if (subheading) current.subheading = subheading;
			column = line.length - s[3].length;
			blocks.push(current);
		} else if (line.trim() === '') {
			if (last?.type === 'text') last.lines.push(line);
			blank = true;
			continue;
		} else if (current && (!blank || /^\s/.test(line))) {
			current.text += ' ' + line.trim();
			current.lines.push(line);
		} else {
			current = null;
			if (last?.type === 'text') last.lines.push(line);
			else blocks.push({ type: 'text', lines: [line] });
		}
		blank = false;
	}
	for (const b of blocks) {
		if (b.type !== 'text') continue;
		while (b.lines.length && b.lines[b.lines.length - 1].trim() === '') b.lines.pop();
	}
	return blocks;
}

export function parseBody(text: string): ParsedBody {
	const lines = text.split('\n');
	const preamble: string[] = [];
	const sections: (Section & { lines: string[] })[] = [];
	let inFence = false;
	for (const line of lines) {
		if (FENCE_RE.test(line)) inFence = !inFence;
		const h = inFence ? null : line.match(HEADING_RE);
		// Level 1–2 headings open sections; deeper ones are sub-headings inside
		// the current section, unless no section is open yet, or the heading is a
		// method heading under an unrecognized one (`## Tarte` then `### Préparation`).
		const current = sections[sections.length - 1];
		const opens =
			!!h && (h[1].length <= 2 || !current || (current.kind === 'other' && headingKind(h[2]) === 'method'));
		if (h && opens) {
			sections.push({ kind: headingKind(h[2]), heading: h[2], level: h[1].length, text: '', lines: [] });
			continue;
		}
		(sections.length ? sections[sections.length - 1].lines : preamble).push(line);
	}

	const chunks: BodyChunk[] = [];
	const steps: Step[] = [];
	const pre = preamble.join('\n').trim();
	if (pre) chunks.push({ path: 'body.preamble', text: pre });

	sections.forEach((section, si) => {
		section.text = section.lines.join('\n').trim();
		const rest: string[] = [];
		if (section.kind === 'method') {
			for (const b of methodBlocks(section.lines)) {
				if (b.type === 'step') {
					const step: Step = { text: b.text, section: si };
					if (b.number !== undefined) step.number = b.number;
					if (b.subheading) step.subheading = b.subheading;
					steps.push(step);
				} else if (b.type === 'heading') rest.push(b.line);
				else rest.push(...b.lines.filter((l) => l.trim() !== ''));
			}
		} else {
			rest.push(...section.lines);
		}
		const other = rest.join('\n').trim();
		if (other) chunks.push({ path: `body.sections[${si}]`, text: other });
	});

	const firstStep = chunks.findIndex((c) => c.path.startsWith('body.sections'));
	const stepChunks = steps.map((s, i) => ({ path: `body.steps[${i}]`, text: s.text }));
	chunks.splice(firstStep === -1 ? chunks.length : firstStep, 0, ...stepChunks);

	return {
		body: {
			preamble: pre,
			sections: sections.map(({ lines: _lines, ...s }) => s),
			steps
		},
		chunks
	};
}
