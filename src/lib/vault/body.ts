// Line-based body parsing: headings, sections, numbered steps. No Markdown
// library — validation needs only headings and list items.

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
const STEP_RE = /^\s{0,3}(\d+)[.)]\s+(.*)$/;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

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
			let current: Step | null = null;
			let subheading: string | undefined;
			let blank = false;
			for (const line of section.lines) {
				const h = line.match(HEADING_RE);
				const s = line.match(STEP_RE);
				if (h) {
					subheading = h[2];
					current = null;
					rest.push(line);
				} else if (s) {
					current = { number: Number(s[1]), text: s[2].trim() };
					if (subheading) current.subheading = subheading;
					steps.push(current);
				} else if (line.trim() === '') {
					blank = true;
					continue;
				} else if (current && (!blank || /^\s/.test(line))) {
					current.text += ' ' + line.trim();
				} else {
					current = null;
					rest.push(line);
				}
				blank = false;
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
