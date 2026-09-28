// W302 (preparation in the name), W304 (size in the name), W607 (brand in the
// name): AI-TEMPLATE.md rule 10, "name is the generic ingredient only". The
// words come from the vault's word lists (src/lib/vault/words.ts), passed as
// check options; without a list its check is off.

import { findAtEdge, findInside, nameWords, type CheckWords, type WordMatch } from '../words';
import { isMap, join, show, type RuleContext } from './context';

export function checkNames(ctx: RuleContext): void {
	const words = ctx.opts.words;
	if (!words || !Array.isArray(ctx.fm.ingredients)) return;
	ctx.fm.ingredients.forEach((g, gi) => {
		if (!isMap(g) || !Array.isArray(g.items)) return;
		g.items.forEach((it, ii) => visit(ctx, words, it, `ingredients[${gi}].items[${ii}]`));
	});
}

function visit(ctx: RuleContext, words: CheckWords, item: unknown, path: string): void {
	if (typeof item === 'string') {
		// A plain-name `or` option (a plain-string item is E207 already).
		if (/\.or\[\d+\]$/.test(path)) checkName(ctx, words, item, path, undefined);
		return;
	}
	if (!isMap(item)) return;
	if (typeof item.name === 'string' && item.name.trim()) checkName(ctx, words, item.name, join(path, 'name'), item);
	if (Array.isArray(item.or)) item.or.forEach((o, k) => visit(ctx, words, o, `${path}.or[${k}]`));
}

function checkName(ctx: RuleContext, words: CheckWords, name: string, path: string, item: Record<string, unknown> | undefined): void {
	const n = nameWords(name);
	const what = item ? `\`name: ${show(name)}\`` : `the \`or\` option ${show(name)}`;
	const prep = findAtEdge(n, words.participles);
	if (prep)
		ctx.report(
			'W302',
			path,
			`${what} holds the preparation \`${prep.text}\` — \`name\` is the ingredient only.`,
			fixText(item, prep, 'prep')
		);
	const size = findAtEdge(n, words.descriptors);
	if (size)
		ctx.report(
			'W304',
			path,
			`${what} holds the size \`${size.text}\` — \`name\` is the ingredient only.`,
			fixText(item, size, 'note')
		);
	const brand = findInside(n, words.brands);
	if (brand)
		ctx.report(
			'W607',
			path,
			`${what} holds the brand \`${brand.text}\`.`,
			`${fixText(item, brand, 'brand')} Keep the whole name only when what remains would no longer name the product exactly (as \`fromage Philadelphia\`).`
		);
}

/** "Move it to `prep`: …", with the field appended to what the entry already has. */
function fixText(item: Record<string, unknown> | undefined, m: WordMatch, field: 'prep' | 'note' | 'brand'): string {
	const had = item && typeof item[field] === 'string' && (item[field] as string).trim() ? (item[field] as string).trim() : '';
	const value = had && field !== 'brand' ? `${m.text}, ${had}` : m.text;
	const entry = `name: ${flow(m.rest)}, ${field}: ${flow(value)}`;
	if (!item) return `Write the option as an entry: \`{ ${entry} }\`.`;
	return `Move it to \`${field}\`: \`${entry}\`${had && field !== 'brand' ? ` (added to the existing \`${field}\`)` : ''}.`;
}

/** A value as written in a `{ … }` entry: quoted when YAML would misread it (a comma, a marker, `&`). */
function flow(v: string): string {
	return /^\p{L}[\p{L}\p{N} '’-]*$/u.test(v) ? v : JSON.stringify(v);
}
