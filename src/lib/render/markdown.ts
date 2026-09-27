// Body Markdown → HTML. `html: false`: the body comes from an AI or a web page
// and raw HTML in it must never reach the page. A small plugin styles the
// markers and turns [[slug]] wikilinks into recipe links (dead ones stay text).

import markdownIt, { type MarkdownIt, type StateCore, type StateInline } from 'markdown-it';
import { headingKind } from '../vault/vocab';
import type { SectionKind } from '../vault/types';

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

function create(opts: RenderOptions): MarkdownIt {
	const md = markdownIt({ html: false, linkify: false, typographer: false, breaks: false });
	md.core.ruler.push('recipe_steps', (state: StateCore) => stepLists(state, !!opts.numbered));
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
	return create(opts).renderInline(src);
}
