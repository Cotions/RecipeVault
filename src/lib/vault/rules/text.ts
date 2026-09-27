// E218: a field of the wrong shape. A text field holds a list, a mapping or a
// boolean — the usual cause is a value starting with an unquoted marker
// (`note: [illisible]`), which YAML reads as a list; the report hook in
// context.ts then gives the quote fix. Or the other way round: a list field
// (`tags`, `season`) or the `media` mapping holds a single value. Fields with a
// code of their own (title E101, name E207, qty E204, …) are not here.

import { scalar } from '../serialize';
import { isBlank, isMap, join, show, type RuleContext } from './context';

const TOP = ['family', 'variant', 'servings_note', 'updated', 'extracted_by'] as const;
const SOURCE = ['author', 'url', 'title', 'note', 'page'] as const;
const ITEM = ['note', 'prep', 'brand', 'recipe', 'item'] as const;

function isText(v: unknown): boolean {
	return v === undefined || v === null || typeof v === 'string' || typeof v === 'number';
}

function check(ctx: RuleContext, v: unknown, path: string): void {
	if (isText(v)) return;
	const key = path.replace(/^.*\./, '');
	const joined =
		Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')
			? `Write it as one text value: \`${key}: "${v.join(', ')}"\`.`
			: 'Write the value as text; put it in double quotes if it contains `[`, `{`, `: ` or `#`.';
	ctx.report('E218', path, `\`${key}: ${show(v)}\` is not text.`, joined);
}

const LIST_EXAMPLE = { tags: '[dessert, quebecois]', season: '[automne, hiver]' } as const;

/** `tags: dessert` → `tags: [dessert]`. */
function notAList(ctx: RuleContext, key: 'tags' | 'season', v: unknown): void {
	const words =
		typeof v === 'string' || typeof v === 'number'
			? String(v)
					.split(',')
					.map((w) => w.trim())
					.filter(Boolean)
			: [];
	const fix = words.length
		? `Write it as a list: \`${key}: [${words.map((w) => scalar(w, true)).join(', ')}]\`.`
		: `Write it as a list: \`${key}: ${LIST_EXAMPLE[key]}\`.`;
	ctx.report('E218', key, `\`${key}: ${show(v)}\` is not a list.`, fix);
}

/** `media: final.jpg` → `media: { final: final.jpg }`. */
function notAMap(ctx: RuleContext, v: unknown): void {
	const file = typeof v === 'string' ? scalar(v, true) : 'final.jpg';
	ctx.report('E218', 'media', `\`media: ${show(v)}\` is not a \`{ final: … }\` entry.`, `Write \`media: { final: ${file} }\`.`);
}

function checkItem(ctx: RuleContext, item: unknown, path: string): void {
	if (!isMap(item)) return;
	for (const k of ITEM) check(ctx, item[k], join(path, k));
	if (Array.isArray(item.or)) item.or.forEach((o, i) => checkItem(ctx, o, join(join(path, 'or'), i)));
}

export function checkTextFields(ctx: RuleContext): void {
	const { fm } = ctx;
	for (const k of TOP) check(ctx, fm[k], k);
	if (!isMap(fm.yield)) check(ctx, fm.yield, 'yield');
	else check(ctx, fm.yield.note, 'yield.note');
	for (const k of ['tags', 'season'] as const) {
		const list = fm[k];
		if (Array.isArray(list)) list.forEach((t, i) => check(ctx, t, join(k, i)));
		else if (!isBlank(list)) notAList(ctx, k, list);
	}
	if (isMap(fm.media)) for (const [k, v] of Object.entries(fm.media)) check(ctx, v, join('media', k));
	else if (!isBlank(fm.media)) notAMap(ctx, fm.media);
	if (isMap(fm.source)) for (const k of SOURCE) check(ctx, fm.source[k], join('source', k));
	if (Array.isArray(fm.ingredients)) {
		fm.ingredients.forEach((g, gi) => {
			if (!isMap(g)) return;
			check(ctx, g.group, `ingredients[${gi}].group`);
			if (Array.isArray(g.items)) g.items.forEach((it, ii) => checkItem(ctx, it, `ingredients[${gi}].items[${ii}]`));
		});
	}
}
