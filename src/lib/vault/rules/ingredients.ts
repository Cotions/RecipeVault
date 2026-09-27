// E200–E216: the ingredient list. Rules from docs/RECIPE-SCHEMA.md, codes from
// docs/VALIDATION.md.

import { stripMarkers } from '../markers';
import { fold } from '../normalize';
import { fmt, parseQuantity } from '../quantity';
import type { Lang } from '../types';
import { ALLOWED_KEYS, COUNT_UNITS, UNITS, findAllQtyUnits, findQtyUnit, isUnit, unitForAlias } from '../vocab';
import { checkKeys, isBlank, isMap, join, show, type RuleContext } from './context';

const UNIT_LIST = `Allowed units: ${UNITS.join(', ')}.`;
const QUEBEC_HINT = 'Quebec abbreviations: tasse/t. → cup, livre → lb, c. à thé → tsp, c. à soupe → tbsp.';

export function checkIngredients(ctx: RuleContext): void {
	const ing = ctx.fm.ingredients;
	const example = '`ingredients:` then `- group: …` with `items:` holding `- { qty: 1, unit: cup, name: farine }` entries';
	if (isBlank(ing) || (Array.isArray(ing) && ing.length === 0)) {
		ctx.report('E200', 'ingredients', '`ingredients` is missing or empty.', `Add ${example}.`);
		return;
	}
	if (!Array.isArray(ing)) {
		ctx.report(
			'E208',
			'ingredients',
			'`ingredients` is not a list of groups.',
			`Write ${example}. A recipe with one component can omit \`group:\`.`
		);
		return;
	}
	const loose = ing.map((g, i) => (isMap(g) && 'items' in g ? -1 : i)).filter((i) => i >= 0);
	if (loose.length === ing.length) {
		ctx.report(
			'E208',
			'ingredients',
			'`ingredients` is a flat list of entries, not groups with `items`.',
			'Wrap the entries in a group: `ingredients:` then `- items:` with the entries indented under it (`group:` is optional for a single component).'
		);
		return;
	}
	for (const i of loose) {
		ctx.report(
			'E208',
			`ingredients[${i}]`,
			'this entry sits directly in `ingredients` instead of inside a group’s `items`.',
			'Move it into the `items:` list of a group.'
		);
	}

	ing.forEach((g, gi) => {
		if (!isMap(g) || !('items' in g)) return;
		const gpath = `ingredients[${gi}]`;
		checkKeys(ctx, g, gpath, ALLOWED_KEYS.group);
		const items = g.items;
		if (!Array.isArray(items) || items.length === 0) {
			ctx.report('E200', join(gpath, 'items'), 'this group has no ingredient entries.', 'List its ingredients under `items:`, or remove the group.');
			return;
		}
		const seen = new Map<string, number>();
		items.forEach((item, ii) => {
			const path = `${gpath}.items[${ii}]`;
			checkItem(ctx, item, path);
			if (isMap(item) && typeof item.name === 'string' && item.name.trim()) {
				const key = fold(stripMarkers(item.name));
				const first = seen.get(key);
				if (first === undefined) seen.set(key, ii);
				else
					ctx.report(
						'E209',
						join(path, 'name'),
						`\`name: ${show(item.name)}\` appears twice in this group (also \`${gpath}.items[${first}]\`).`,
						'Merge the two entries, or move one to another group if they belong to different components.'
					);
			}
		});
	});
}

/** One ingredient entry — also used for object entries of `or`. */
function checkItem(ctx: RuleContext, item: unknown, path: string): void {
	if (typeof item === 'string') {
		ctx.report(
			'E207',
			path,
			`\`${show(item)}\` is a plain string, not an ingredient entry with \`name\`.`,
			`Write it as an entry: \`${entryFromText(item, ctx.lang)}\``
		);
		return;
	}
	if (!isMap(item)) {
		ctx.report('E207', path, 'this ingredient entry is not a `{ … }` entry with a `name`.', 'Write it as `{ qty: …, unit: …, name: … }`.');
		return;
	}
	checkKeys(ctx, item, path, ALLOWED_KEYS.item);

	const name = item.name;
	if (!isBlank(name) && typeof name !== 'string') {
		ctx.report('E207', join(path, 'name'), `\`name: ${show(name)}\` is not text.`, 'Write the name as text, e.g. `name: farine`.');
	} else if (typeof name !== 'string' || name.trim() === '') {
		ctx.report('E207', path, 'ingredient entry has no `name`.', 'Add `name:` — the generic ingredient, e.g. `name: farine`.');
	} else {
		checkNameText(ctx, name, join(path, 'name'), item);
		if (name.includes(',') && isBlank(item.note) && isBlank(item.prep)) {
			const parts = name.split(',').map((p) => p.trim()).filter(Boolean);
			ctx.report(
				'E211',
				join(path, 'name'),
				`\`name: ${show(name)}\` contains a comma — probably several ingredients, or a preparation, in one entry.`,
				`One ingredient per entry: ${parts.map((p) => `\`{ name: ${p} }\``).join(', ')}. If it is one ingredient, move the descriptor to \`prep\` or \`note\`.`
			);
		}
	}

	checkAmount(ctx, item, path);

	if (item.to_taste === true && (!isBlank(item.qty) || !isBlank(item.unit))) {
		ctx.report(
			'E206',
			join(path, 'to_taste'),
			'`to_taste: true` together with a `qty` or `unit`.',
			'Pick one: keep the amount and remove `to_taste`, or remove `qty` and `unit`.'
		);
	}
	if (!isBlank(item.buy_instead) && isBlank(item.recipe)) {
		ctx.report(
			'E212',
			join(path, 'buy_instead'),
			'`buy_instead` is only meaningful with `recipe:`.',
			'Remove `buy_instead`, or add `recipe:` with the sub-recipe slug.'
		);
	}
	if (item.alt !== undefined) checkAlt(ctx, item.alt, join(path, 'alt'));
	if (item.or !== undefined) checkOr(ctx, item.or, join(path, 'or'));
	if (typeof item.note === 'string') checkNote(ctx, item, join(path, 'note'));
}

/**
 * qty / qty_max / unit, as found on ingredient entries and on `yield` objects:
 * E201–E205.
 */
export function checkAmount(ctx: RuleContext, obj: Record<string, unknown>, path: string): void {
	const hasQty = !isBlank(obj.qty);
	const hasUnit = !isBlank(obj.unit);
	let qtyValue: number | undefined;
	if (hasQty) {
		const q = parseQuantity(obj.qty);
		if (q.ok) qtyValue = q.value;
		else
			ctx.report(
				'E204',
				join(path, 'qty'),
				`\`qty: ${show(obj.qty)}\` is not a number or a fraction string${detail(q.reason)}.`,
				q.suggestion
					? `Write \`qty: ${q.suggestion}\`.`
					: 'Use a number (`2`, `0.5`) or a fraction in quotes as written (`"1 1/2"`, `"2/3"`); a range is `qty` plus `qty_max`.'
			);
	}
	if (hasUnit) checkUnit(ctx, obj.unit, join(path, 'unit'));
	if (hasQty && !hasUnit)
		ctx.report(
			'E203',
			path,
			`\`qty: ${show(obj.qty)}\` present but \`unit\` missing.`,
			'Every qty needs a unit. Countable items use `unit: piece`.'
		);
	if (hasUnit && !hasQty)
		ctx.report(
			'E202',
			path,
			`\`unit: ${show(obj.unit)}\` present but \`qty\` missing.`,
			'Add the `qty`, or remove `unit` if the source gives no amount.'
		);
	if (!isBlank(obj.qty_max)) {
		const m = parseQuantity(obj.qty_max);
		if (!hasQty)
			ctx.report('E205', join(path, 'qty_max'), '`qty_max` present without `qty`.', 'A range is `qty` (the low end) plus `qty_max` (the high end).');
		else if (!m.ok)
			ctx.report(
				'E204',
				join(path, 'qty_max'),
				`\`qty_max: ${show(obj.qty_max)}\` is not a number or a fraction string${detail(m.reason)}.`,
				m.suggestion ? `Write \`qty_max: ${m.suggestion}\`.` : 'Use a number or a fraction in quotes, like `qty`.'
			);
		else if (qtyValue !== undefined && m.value <= qtyValue)
			ctx.report(
				'E205',
				join(path, 'qty_max'),
				`\`qty_max: ${show(obj.qty_max)}\` is not greater than \`qty: ${show(obj.qty)}\`.`,
				'`qty` is the low end of the range and `qty_max` the high end; remove `qty_max` if there is no range.'
			);
	}
}

function checkUnit(ctx: RuleContext, unit: unknown, path: string): void {
	if (isUnit(unit)) return;
	const alias = typeof unit === 'string' ? unitForAlias(unit, ctx.lang) : undefined;
	if (alias) {
		ctx.report('E201', path, `\`unit: ${show(unit)}\` is not allowed; \`${unit}\` is written \`${alias}\`.`, `Write \`unit: ${alias}\`.`);
	} else if (alias === null) {
		const choices = ctx.lang === 'fr' ? '`cup` (tasse) or `tbsp`' : '`tbsp` (T) or `tsp` (t)';
		ctx.report(
			'E201',
			path,
			`\`unit: ${show(unit)}\` is not allowed, and is ambiguous in a \`lang: ${ctx.lang}\` recipe.`,
			`Write the unit the source means: ${choices}.`
		);
	} else {
		ctx.report('E201', path, `\`unit: ${show(unit)}\` is not allowed.`, `${UNIT_LIST} ${QUEBEC_HINT} Countable items use \`unit: piece\`; sizes go in \`note\`.`);
	}
}

/** E210: a quantity with a unit inside a name (or a plain-string `or` entry). */
function checkNameText(ctx: RuleContext, name: string, path: string, item?: Record<string, unknown>): void {
	const m = findQtyUnit(name);
	if (!m) return;
	const extra = item ? pick(item, ['note', 'prep']) : '';
	const what = item ? `\`name: ${show(name)}\`` : `\`or\` entry \`${show(name)}\``;
	const how = item ? 'Move it' : 'Write the replacement as an entry';
	ctx.report('E210', path, `${what} contains a quantity.`, `${how}: \`${entryFromText(name, ctx.lang, extra)}\``);
}

/** E216: a quantity and unit in `note`, which belong in qty/unit. */
function checkNote(ctx: RuleContext, item: Record<string, unknown>, path: string): void {
	const note = item.note as string;
	const amounts = findAllQtyUnits(note);
	if (!amounts.length) return;
	const alternative = amounts.some((m) => /(?:^|[\s,;(])(?:ou|or)\s/i.test(note.slice(0, m.start)));
	// One size on a counted or contained item is what `note` is for:
	// `{ qty: 1, unit: can, note: "796 ml" }`.
	if (!alternative && amounts.length === 1 && (COUNT_UNITS as readonly unknown[]).includes(item.unit)) return;
	const m = amounts[0];
	const unit = unitForAlias(m.unitText, ctx.lang) ?? '<unit>';
	const name = typeof item.name === 'string' ? item.name : '…';
	const amount = `qty: ${fmt(m.qty.replace(/\s+/g, ' '))}, unit: ${unit}`;
	const fix = alternative
		? `A replacement with its own amount goes in \`or\`: \`or: [{ ${amount}, name: … }]\`.`
		: amounts.length > 1 && (COUNT_UNITS as readonly unknown[]).includes(item.unit)
			? '`note` may hold one size only; move the other amounts to `qty`/`unit` or `alt`, or into `or` if they are a replacement.'
			: `Move it: \`{ ${amount}, name: ${name} }\`; a second measure of the same amount goes in \`alt: { ${amount} }\`.`;
	ctx.report('E216', path, `\`note: ${show(note)}\` contains a quantity and unit.`, fix);
}

function checkAlt(ctx: RuleContext, alt: unknown, path: string): void {
	const fix = 'Write `alt: { qty: 1, unit: cup }` — only `qty`, `unit` and optionally `qty_max`.';
	if (!isMap(alt)) {
		ctx.report('E214', path, '`alt` is not a `{ qty, unit }` entry.', fix);
		return;
	}
	const extra = Object.keys(alt).filter((k) => !(ALLOWED_KEYS.alt as readonly string[]).includes(k));
	if (extra.length)
		ctx.report('E214', path, `\`alt\` has keys other than \`qty\`, \`qty_max\`, \`unit\`: ${extra.join(', ')}.`, fix);
	if (isBlank(alt.qty) || isBlank(alt.unit)) {
		ctx.report('E214', path, '`alt` needs both `qty` and `unit`.', fix);
		// Still check what is there, without repeating E202/E203.
		if (!isBlank(alt.qty) && !parseQuantity(alt.qty).ok) checkAmount(ctx, { qty: alt.qty, unit: 'g' }, path);
		if (!isBlank(alt.unit)) checkUnit(ctx, alt.unit, join(path, 'unit'));
		return;
	}
	checkAmount(ctx, alt, path);
}

function checkOr(ctx: RuleContext, or: unknown, path: string): void {
	if (!Array.isArray(or)) {
		ctx.report('E215', path, '`or` is not a list.', 'Write `or: [huile]`, or `or: [{ qty: 1, unit: tbsp, name: … }]` when the replacement has its own amount.');
		return;
	}
	or.forEach((entry, i) => {
		const p = join(path, i);
		if (typeof entry === 'string') {
			if (entry.trim() === '') ctx.report('E215', p, 'empty `or` entry.', 'Remove it.');
			else checkNameText(ctx, entry, p);
		} else if (isMap(entry)) {
			checkItem(ctx, entry, p);
		} else {
			ctx.report('E215', p, `\`or\` entry \`${show(entry)}\` is neither a name nor an ingredient entry.`, 'Write a plain name, or `{ qty: …, unit: …, name: … }`.');
		}
	});
}

/** Rewrite '500 g de lait' as '{ qty: 500, unit: ml, name: lait }' — best effort. */
function entryFromText(text: string, lang: Lang, extra = ''): string {
	const m = findQtyUnit(text);
	if (!m) return `{ name: ${text.trim()}${extra} }`;
	const unit = unitForAlias(m.unitText, lang) ?? '<unit>';
	const rest = (text.slice(0, m.start) + ' ' + text.slice(m.end))
		.replace(/^\s*(?:de |d['’]|of )/i, '')
		.replace(/\s+/g, ' ')
		.trim();
	const qty = fmt(m.qty.replace(/\s+/g, ' ').replace(',', '.'));
	return `{ qty: ${qty}, unit: ${unit}, name: ${rest || '…'}${extra} }`;
}

function detail(reason: string): string {
	return reason === 'not a number or a fraction string' ? '' : ` (${reason})`;
}

function pick(item: Record<string, unknown>, keys: string[]): string {
	return keys
		.filter((k) => typeof item[k] === 'string' && (item[k] as string).trim())
		.map((k) => `, ${k}: ${item[k]}`)
		.join('');
}
