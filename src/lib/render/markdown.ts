// Body Markdown → HTML. `html: false`: the body comes from an AI or a web page
// and raw HTML in it must never reach the page. A small plugin styles the
// markers and turns [[slug]] wikilinks into recipe links (dead ones stay text).

import markdownIt, { type MarkdownIt, type StateCore, type StateInline, type Token } from 'markdown-it';
import { headingKind } from '../vault/vocab';
import type { SectionKind } from '../vault/types';
import { stepAmounts, type StepScale } from './stepamounts';

export interface RenderOptions {
	/** Title of a recipe slug, or undefined when no such recipe exists. */
	resolve?: (slug: string) => string | undefined;
	/** Link for a recipe slug. */
	href?: (slug: string) => string;
	/**
	 * How the method's steps show: a bullet list (default) or numbered 1…n
	 * across the whole method, whatever the file wrote (`1.`, `-`, `*`).
	 */
	numbered?: boolean;
	/**
	 * The recipe read at another amount (plan 05, Q6 B): each measure written
	 * in a step gets its scaled value beside it (`1 tasse → 2 tasses`), the
	 * original kept. `title` labels the added value. Nothing at factor 1.
	 */
	scale?: StepScale & { title: string };
}

const MARKER_RE = /^\[(?:(\?)|\?:\s*([^\]\s][^\]]*?)\s*|(illisible)|(\+))\]/;
const WIKI_RE = /^\[\[([^\]|\n]+?)(?:\|([^\]\n]+))?\]\]/;

function escape(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export const MARKER_TITLES = {
	uncertain: 'Lecture incertaine',
	'uncertain-alt': 'Lecture incertaine, autre lecture possible :',
	illegible: 'Illisible sur l’original',
	added: 'Ajouté à la transcription, absent de l’original'
};

export function markerHtml(kind: keyof typeof MARKER_TITLES, text: string, alternative?: string): string {
	const title = alternative ? `${MARKER_TITLES[kind]} ${alternative}` : MARKER_TITLES[kind];
	return `<mark class="mk mk-${kind}" title="${escape(title)}">${escape(text)}</mark>`;
}

/**
 * The top-level lists of the method sections are the steps (`parseBody`, same
 * section rules): tagged `steps`, shown as bullets or numbered as asked. Lists
 * in other sections, and lists nested inside a step, stay as written.
 */
function stepLists(state: StateCore, numbered: boolean): void {
	const tokens = state.tokens;
	let kind: SectionKind | null = null;
	let n = 0;
	let inSteps = false;
	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i];
		if (tok.type === 'heading_open' && tok.level === 0) {
			const next = headingKind(tokens[i + 1]?.content ?? '');
			const level = Number(tok.tag.slice(1));
			if (level <= 2 || kind === null || (kind === 'other' && next === 'method')) kind = next;
		} else if (tok.level === 0 && (tok.type === 'bullet_list_open' || tok.type === 'ordered_list_open')) {
			inSteps = kind === 'method';
			if (!inSteps) continue;
			tok.tag = numbered ? 'ol' : 'ul';
			tok.attrs = null;
			tok.attrSet('class', 'steps');
		} else if (tok.level === 0 && (tok.type === 'bullet_list_close' || tok.type === 'ordered_list_close')) {
			if (inSteps) tok.tag = numbered ? 'ol' : 'ul';
			inSteps = false;
		} else if (inSteps && tok.level === 1 && tok.type === 'list_item_open') {
			n++;
			if (numbered) tok.attrSet('value', String(n));
		}
	}
}

/** The scaled value shown after an amount in a step. */
export function stepAmountHtml(scaled: string, title: string): string {
	return `<span class="step-scaled" title="${escape(title)}"> → ${escape(scaled)}</span>`;
}

// Tokens an amount may run across: emphasis, and the markers that qualify a
// word (`[?]`, `[?: …]`, `[+]`). « 1 **tasse** », « **1** tasse », « 1 [?] tasse »
// read as the text shows them. A link, code, a line break or `[illisible]` (the
// number may be cut) ends the run.
const EMPHASIS = new Set(['strong_open', 'strong_close', 'em_open', 'em_close', 's_open', 's_close']);
const joins = (t: Token) => t.type === 'text' || EMPHASIS.has(t.type) || (t.type === 'html_inline' && t.meta?.joins === true);
const isClose = (t: Token) => t.nesting === -1 && EMPHASIS.has(t.type);

/**
 * Mark the amounts of one run of joined tokens: the text is read as one string
 * (the markers as nothing), and each scaled value is added after the amount's
 * last character — after the closing tags of emphasis opened inside the amount
 * (« 1 <strong>tasse</strong> → 2 tasses »). Only text tokens are split and
 * only the escaped `stepAmountHtml` is added: the markup stays as parsed.
 */
function scaleRun(run: Token[], state: StateCore, scale: NonNullable<RenderOptions['scale']>): Token[] {
	const at: number[] = [];
	let joined = '';
	for (const t of run) {
		at.push(joined.length);
		if (t.type === 'text') joined += t.content;
	}
	const found = stepAmounts(joined, scale);
	if (!found.length) return run;
	// Per text token: where to cut, and how many closing tags to pass before the value.
	const cuts = new Map<number, { cut: number; html: string; closes: number }[]>();
	const textAt = (pos: number, end: boolean) =>
		run.findIndex((t, k) => t.type === 'text' && (end ? at[k] < pos && pos <= at[k] + t.content.length : at[k] <= pos && pos < at[k] + t.content.length));
	for (const a of found) {
		const ks = textAt(a.start, false);
		const ke = textAt(a.end, true);
		if (ks < 0 || ke < 0) continue;
		let open = 0;
		for (let k = ks + 1; k < ke; k++) if (EMPHASIS.has(run[k].type)) open = Math.max(0, open + run[k].nesting);
		const cut = a.end - at[ke];
		const list = cuts.get(ke) ?? [];
		list.push({ cut, html: stepAmountHtml(a.scaled, scale.title), closes: cut === run[ke].content.length ? open : 0 });
		cuts.set(ke, list);
	}
	const out: Token[] = [];
	const text = (content: string) => {
		if (!content) return;
		const t = new state.Token('text', '', 0);
		t.content = content;
		out.push(t);
	};
	const html = (content: string) => {
		const t = new state.Token('html_inline', '', 0);
		t.content = content;
		out.push(t);
	};
	let waiting: { html: string; closes: number } | undefined;
	for (const [k, t] of run.entries()) {
		// Only closing tags (and the empty text emphasis leaves) come between an amount and its value.
		if (waiting && !(isClose(t) || (t.type === 'text' && !t.content))) {
			html(waiting.html);
			waiting = undefined;
		}
		const list = cuts.get(k);
		if (!list) {
			out.push(t);
			if (waiting && isClose(t) && --waiting.closes === 0) {
				html(waiting.html);
				waiting = undefined;
			}
			continue;
		}
		let last = 0;
		for (const c of list) {
			text(t.content.slice(last, c.cut));
			last = c.cut;
			if (c.closes) waiting = { html: c.html, closes: c.closes };
			else html(c.html);
		}
		text(t.content.slice(last));
	}
	if (waiting) html(waiting.html);
	return out;
}

/** Mark the amounts in the children of one inline token, run by run. */
function scaleInline(inline: Token, state: StateCore, scale: NonNullable<RenderOptions['scale']>): void {
	const kids = inline.children ?? [];
	const out: Token[] = [];
	for (let i = 0; i < kids.length; ) {
		if (!joins(kids[i])) {
			out.push(kids[i++]);
			continue;
		}
		let j = i;
		while (j < kids.length && joins(kids[j])) j++;
		out.push(...scaleRun(kids.slice(i, j), state, scale));
		i = j;
	}
	inline.children = out;
}

/** The amounts in the steps (the lists `stepLists` tagged), or in every line of an inline render. */
function stepAmountsRule(state: StateCore, scale: NonNullable<RenderOptions['scale']>, inline: boolean): void {
	if (scale.factor === 1) return;
	let depth = 0;
	for (const tok of state.tokens) {
		if (tok.level === 0 && (tok.type === 'bullet_list_open' || tok.type === 'ordered_list_open') && tok.attrGet('class') === 'steps') depth = 1;
		else if (tok.level === 0 && (tok.type === 'bullet_list_close' || tok.type === 'ordered_list_close')) depth = 0;
		else if (tok.type === 'inline' && (inline || depth)) scaleInline(tok, state, scale);
	}
}

function create(opts: RenderOptions, inline = false): MarkdownIt {
	const md = markdownIt({ html: false, linkify: false, typographer: false, breaks: false });
	md.core.ruler.push('recipe_steps', (state: StateCore) => stepLists(state, !!opts.numbered));
	if (opts.scale) {
		const scale = opts.scale;
		md.core.ruler.push('recipe_step_amounts', (state: StateCore) => stepAmountsRule(state, scale, inline));
	}
	md.inline.ruler.before('link', 'recipe_markers', (state: StateInline, silent: boolean) => {
		if (state.src.charCodeAt(state.pos) !== 0x5b /* [ */) return false;
		const rest = state.src.slice(state.pos);
		const wiki = rest.match(WIKI_RE);
		if (wiki) {
			if (!silent) {
				const slug = wiki[1].trim();
				const title = opts.resolve?.(slug);
				const label = wiki[2]?.trim() || title || slug;
				const t = state.push('html_inline', '', 0);
				t.content = title
					? `<a class="wikilink" href="${escape(opts.href?.(slug) ?? `/r/${slug}`)}">${escape(label)}</a>`
					: `<span class="wikilink dead" title="Recette absente">${escape(label)}</span>`;
			}
			state.pos += wiki[0].length;
			return true;
		}
		const m = rest.match(MARKER_RE);
		if (!m) return false;
		if (!silent) {
			const kind = m[1] ? 'uncertain' : m[2] !== undefined ? 'uncertain-alt' : m[3] ? 'illegible' : 'added';
			const t = state.push('html_inline', '', 0);
			t.content = markerHtml(kind, m[0], m[2]);
			// A qualified word's marker does not cut an amount in two (« 1 [?] tasse »); `[illisible]` does.
			t.meta = { joins: kind !== 'illegible' };
		}
		state.pos += m[0].length;
		return true;
	});
	return md;
}

/** Render a recipe body (or any Markdown from a recipe) to safe HTML. */
export function renderMarkdown(src: string, opts: RenderOptions = {}): string {
	return create(opts).render(src);
}

/** Render a single line (a step, a note) without a wrapping paragraph. */
export function renderInline(src: string, opts: RenderOptions = {}): string {
	return create(opts, true).renderInline(src);
}
